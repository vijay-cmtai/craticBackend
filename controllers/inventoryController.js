// controllers/inventoryController.js

const asyncHandler = require("express-async-handler");
const Diamond = require("../models/diamondModel.js");
const { Readable, Writable } = require("stream"); // ✨ 1. Yahan 'Writable' ko import karein
const axios = require("axios");
const ftp = require("basic-ftp");
const csv = require("csv-parser");
const {
  syncInventoryFromApi,
  processCsvStreamWithMapping,
  convertGoogleSheetsUrl,
} = require("../services/inventoryService.js");

// ... baaki helper functions waise hi rahenge ...
const getUserId = (req, sellerId) => {
  if (req.user && req.user.role === "Admin" && sellerId) return sellerId;
  if (req.user && req.user._id) return req.user._id;
  return null;
};
const getHeaders = (buffer) => {
  return new Promise((resolve, reject) => {
    if (!buffer || buffer.length === 0)
      return reject(new Error("Cannot get headers from an empty file."));
    Readable.from(buffer)
      .pipe(
        csv({
          mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, ""),
        })
      )
      .on("headers", (headers) => resolve(headers))
      .on("error", reject)
      .on("data", () => {});
  });
};
const createBulkOperations = (results, userIdToAssign) => {
  if (!Array.isArray(results) || results.length === 0) return [];
  return results.map((d) => {
    const isAvailable =
      !d.availability || String(d.availability).toUpperCase() === "AVAILABLE";
    if (isAvailable) {
      return {
        updateOne: {
          filter: { stockId: d.stockId, user: userIdToAssign },
          update: {
            $set: { ...d, user: userIdToAssign, availability: "AVAILABLE" },
          },
          upsert: true,
        },
      };
    } else {
      return {
        updateOne: {
          filter: { stockId: d.stockId, user: userIdToAssign },
          update: {
            $set: { availability: String(d.availability).toUpperCase() },
          },
          upsert: false,
        },
      };
    }
  });
};

// ✨ 2. FTP DOWNLOAD FUNCTION KA BUG FIX
const downloadFtpToBuffer = async (client, path) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    // Hum ek custom Writable stream banayenge jo data ko chunks mein collect karega
    const writable = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });

    writable.on("finish", () => resolve(Buffer.concat(chunks)));
    writable.on("error", reject);

    // Ab 'downloadTo' is writable stream par aaram se likh payega
    client.downloadTo(writable, path);
  });
};

// --- CONTROLLERS ---

const addManualDiamond = asyncHandler(async (req, res) => {
  // Yeh pehle se theek hai
  const { stockId, carat, sellerId } = req.body;
  if (!stockId || !carat)
    return res
      .status(400)
      .json({ success: false, message: "Stock ID and Carat are required." });
  const userIdToAssign = getUserId(req, sellerId);
  if (!userIdToAssign)
    return res
      .status(400)
      .json({ success: false, message: "User identification failed." });
  const diamondExists = await Diamond.findOne({
    stockId,
    user: userIdToAssign,
  });
  if (diamondExists)
    return res
      .status(400)
      .json({
        success: false,
        message: "Diamond with this Stock ID already exists.",
      });
  const diamond = await Diamond.create({ ...req.body, user: userIdToAssign });
  res.status(201).json({ success: true, data: diamond });
});

const uploadFromCsv = asyncHandler(async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "No CSV file uploaded." });
    const { mapping, sellerId } = req.body;
    if (!mapping)
      return res
        .status(400)
        .json({ success: false, message: "Field mapping not provided." });
    const userIdToAssign = getUserId(req, sellerId);
    if (!userIdToAssign)
      return res
        .status(400)
        .json({ success: false, message: "User identification failed." });

    // CSV ke liye JSON.parse zaroori hai kyunki FormData se data string mein aata hai
    const userMapping = JSON.parse(mapping);
    const readableStream = Readable.from(req.file.buffer);
    const results = await processCsvStreamWithMapping(
      readableStream,
      userMapping
    );
    const operations = createBulkOperations(results, userIdToAssign);
    if (operations.length === 0)
      return res
        .status(200)
        .json({
          success: true,
          message: "CSV processed, but no valid data found.",
          newDiamondsAdded: 0,
          diamondsUpdated: 0,
        });
    const bulkResult = await Diamond.bulkWrite(operations, { ordered: false });
    if (req.app.get("socketio"))
      req.app
        .get("socketio")
        .emit("inventory-updated", {
          message: "Inventory updated via CSV Upload!",
          newDiamondsAdded: bulkResult.upsertedCount,
          diamondsUpdated: bulkResult.modifiedCount,
        });
    res
      .status(200)
      .json({
        success: true,
        message: "CSV processed successfully.",
        newDiamondsAdded: bulkResult.upsertedCount,
        diamondsUpdated: bulkResult.modifiedCount,
      });
  } catch (error) {
    console.error("CSV Upload Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: `CSV processing failed: ${error.message}`,
      });
  }
});

const syncFromApi = asyncHandler(async (req, res) => {
  try {
    const { apiUrl, mapping, sellerId } = req.body;
    if (!apiUrl || !mapping)
      return res
        .status(400)
        .json({ success: false, message: "apiUrl and mapping are required." });
    const userIdToAssign = getUserId(req, sellerId);
    if (!userIdToAssign)
      return res
        .status(400)
        .json({ success: false, message: "User identification failed." });

    // ✨ 3. API SYNC BUG FIX: Yahan JSON.parse() ki zaroorat nahi hai
    const userMapping = mapping; // 'mapping' pehle se hi ek object hai

    const result = await syncInventoryFromApi(
      apiUrl,
      userMapping,
      userIdToAssign
    );
    if (result.success && req.app.get("socketio"))
      req.app
        .get("socketio")
        .emit("inventory-updated", {
          message: "Inventory updated via API Sync!",
          ...result,
        });
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    console.error("API Sync FATAL Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: `API sync failed unexpectedly: ${error.message}`,
      });
  }
});

const syncFromFtp = asyncHandler(async (req, res) => {
  try {
    const { host, user, password, path, mapping, sellerId } = req.body;
    if (!host || !path || !mapping)
      return res
        .status(400)
        .json({
          success: false,
          message: "Host, Path and Mapping are required.",
        });
    const userIdToAssign = getUserId(req, sellerId);
    if (!userIdToAssign)
      return res
        .status(400)
        .json({ success: false, message: "User identification failed." });

    // ✨ 4. FTP SYNC BUG FIX: Yahan bhi JSON.parse() ki zaroorat nahi hai
    const userMapping = mapping; // 'mapping' pehle se hi ek object hai

    const client = new ftp.Client();
    await client.access({ host, user, password, secure: false });
    const buffer = await downloadFtpToBuffer(client, path); // Yeh ab naye function se kaam karega
    client.close();
    const readableStream = Readable.from(buffer);
    const results = await processCsvStreamWithMapping(
      readableStream,
      userMapping
    );
    const operations = createBulkOperations(results, userIdToAssign);
    if (operations.length === 0)
      return res
        .status(200)
        .json({
          success: true,
          message: "FTP file processed, but no valid data found.",
          newDiamondsAdded: 0,
          diamondsUpdated: 0,
        });
    const bulkResult = await Diamond.bulkWrite(operations, { ordered: false });
    if (req.app.get("socketio"))
      req.app
        .get("socketio")
        .emit("inventory-updated", {
          message: "Inventory updated via FTP Sync!",
          newDiamondsAdded: bulkResult.upsertedCount,
          diamondsUpdated: bulkResult.modifiedCount,
        });
    res
      .status(200)
      .json({
        success: true,
        message: "FTP Sync successful.",
        newDiamondsAdded: bulkResult.upsertedCount,
        diamondsUpdated: bulkResult.modifiedCount,
      });
  } catch (error) {
    console.error("FTP Sync Error:", error);
    res
      .status(500)
      .json({ success: false, message: `FTP failed: ${error.message}` });
  }
});

// Baaki sabhi functions waise hi rahenge, woh pehle se theek hain
const previewCsvHeaders = asyncHandler(async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "No CSV file uploaded." });
    const headers = await getHeaders(req.file.buffer);
    res.status(200).json({ success: true, headers });
  } catch (error) {
    res
      .status(400)
      .json({
        success: false,
        message: `Could not read headers: ${error.message}`,
      });
  }
});
const previewHeadersFromUrl = asyncHandler(async (req, res) => {
  try {
    const { apiUrl } = req.body;
    if (!apiUrl)
      return res
        .status(400)
        .json({ success: false, message: "apiUrl is required." });
    const processedUrl = convertGoogleSheetsUrl(apiUrl);
    const response = await axios.get(processedUrl, { responseType: "text" });
    let headers;
    try {
      const data = JSON.parse(response.data);
      let sampleObject =
        data.data?.[0] || data.diamonds?.[0] || data.results?.[0] || data[0];
      if (sampleObject) headers = Object.keys(sampleObject);
      else throw new Error("JSON data is empty or not in a recognized format.");
    } catch (jsonError) {
      headers = await getHeaders(Buffer.from(response.data));
    }
    if (!headers || headers.length === 0)
      throw new Error("Could not extract any headers from the URL.");
    res.status(200).json({ success: true, headers });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: `Failed to get headers from URL: ${error.message}`,
      });
  }
});
const previewFtpHeaders = asyncHandler(async (req, res) => {
  const { host, user, password, path } = req.body;
  if (!host || !path)
    return res
      .status(400)
      .json({ success: false, message: "Host and Path are required." });
  const client = new ftp.Client();
  try {
    await client.access({ host, user, password, secure: false });
    const buffer = await downloadFtpToBuffer(client, path);
    client.close();
    const headers = await getHeaders(buffer);
    res.status(200).json({ success: true, headers });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: `FTP error: ${error.message}` });
  }
});
const getDiamonds = asyncHandler(async (req, res) => {
  const pageSize = 10;
  const page = Number(req.query.page) || 1;
  const searchTerm = req.query.search
    ? {
        $or: [
          { stockId: { $regex: req.query.search, $options: "i" } },
          { shape: { $regex: req.query.search, $options: "i" } },
        ],
      }
    : {};
  const filter = { ...searchTerm };
  if (req.user) {
    if (req.user.role === "Admin" && req.query.sellerId)
      filter.user = req.query.sellerId;
    else if (req.user.role !== "Admin") filter.user = req.user._id;
  }
  const count = await Diamond.countDocuments(filter);
  const diamonds = await Diamond.find(filter)
    .populate("user", "name")
    .limit(pageSize)
    .skip(pageSize * (page - 1))
    .sort({ createdAt: -1 });
  res.json({ diamonds, page, pages: Math.ceil(count / pageSize), count });
});
const getDiamondById = asyncHandler(async (req, res) => {
  const diamond = await Diamond.findById(req.params.id);
  if (!diamond) return res.status(404).json({ message: "Diamond not found" });
  res.json(diamond);
});
const getDiamondByStockId = asyncHandler(async (req, res) => {
  const diamond = await Diamond.findOne({ stockId: req.params.stockId });
  if (!diamond) return res.status(404).json({ message: "Diamond not found" });
  res.json(diamond);
});
const updateDiamond = asyncHandler(async (req, res) => {
  const diamond = await Diamond.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!diamond) return res.status(404).json({ message: "Diamond not found" });
  res.json(diamond);
});
const deleteDiamond = asyncHandler(async (req, res) => {
  const diamond = await Diamond.findByIdAndDelete(req.params.id);
  if (!diamond) return res.status(404).json({ message: "Diamond not found" });
  res.json({ message: "Diamond removed" });
});
const getSupplierDiamonds = asyncHandler(async (req, res) => {
  const diamonds = await Diamond.find({ user: req.user._id }).sort({
    createdAt: -1,
  });
  res.status(200).json({ success: true, diamonds });
});
const updateDiamondStatus = asyncHandler(async (req, res) => {
  const { availability } = req.body;
  const diamondId = req.params.id;
  if (!availability) {
    res.status(400);
    throw new Error("Availability status is required.");
  }
  const diamond = await Diamond.findById(diamondId);
  if (!diamond) {
    res.status(404);
    throw new Error("Diamond not found.");
  }
  if (diamond.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("User not authorized to update this diamond.");
  }
  diamond.availability = availability;
  const updatedDiamond = await diamond.save();
  res.status(200).json({ success: true, diamond: updatedDiamond });
});

module.exports = {
  uploadFromCsv,
  addManualDiamond,
  getDiamonds,
  getDiamondById,
  updateDiamond,
  deleteDiamond,
  syncFromApi,
  getDiamondByStockId,
  previewCsvHeaders,
  previewHeadersFromUrl,
  previewFtpHeaders,
  syncFromFtp,
  getSupplierDiamonds,
  updateDiamondStatus,
};
