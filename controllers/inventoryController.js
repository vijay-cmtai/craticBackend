const asyncHandler = require("express-async-handler");
const Diamond = require("../models/diamondModel.js");
const { Readable } = require("stream");
const axios = require("axios");
const ftp = require("basic-ftp");
const csv = require("csv-parser");
const {
  syncInventoryFromApi,
  processCsvStreamWithMapping,
  convertGoogleSheetsUrl,
} = require("../services/inventoryService.js");

const getUserId = (req, sellerId) => {
  if (req.user && req.user.role === "Admin" && sellerId) return sellerId;
  if (req.user && req.user._id) return req.user._id;
  return null;
};

const getHeaders = (buffer) => {
  return new Promise((resolve, reject) => {
    Readable.from(buffer)
      .pipe(
        csv({
          mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, ""),
        })
      )
      .on("headers", (headers) => resolve(headers))
      .on("error", reject);
  });
};

const addManualDiamond = asyncHandler(async (req, res) => {
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
    return res.status(400).json({
      success: false,
      message: "Diamond with this Stock ID already exists.",
    });
  const diamond = await Diamond.create({ ...req.body, user: userIdToAssign });
  res.status(201).json({ success: true, data: diamond });
});

const uploadFromCsv = asyncHandler(async (req, res) => {
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

  const userMapping = JSON.parse(mapping);
  const readableStream = Readable.from(req.file.buffer);
  const results = await processCsvStreamWithMapping(
    readableStream,
    userMapping
  );

  const operations = results.map((d) => {
    const isAvailable = !d.availability || d.availability === "AVAILABLE";
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
          update: { $set: { availability: "SOLD" } },
          upsert: false,
        },
      };
    }
  });

  const bulkResult = await Diamond.bulkWrite(operations, { ordered: false });
  if (req.app.get("socketio"))
    req.app.get("socketio").emit("inventory-updated", {
      message: "Inventory updated via CSV Upload!",
      newDiamondsAdded: bulkResult.upsertedCount,
      diamondsUpdated: bulkResult.modifiedCount,
    });
  res.status(200).json({
    success: true,
    message: "CSV processed successfully.",
    newDiamondsAdded: bulkResult.upsertedCount,
    diamondsUpdated: bulkResult.modifiedCount,
  });
});

const syncFromApi = asyncHandler(async (req, res) => {
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

  const userMapping = JSON.parse(mapping);
  const result = await syncInventoryFromApi(
    apiUrl,
    userMapping,
    userIdToAssign
  );

  if (result.success && req.app.get("socketio"))
    req.app.get("socketio").emit("inventory-updated", {
      message: "Inventory updated via API Sync!",
      ...result,
    });
  res.status(result.success ? 200 : 500).json(result);
});

const syncFromFtp = asyncHandler(async (req, res) => {
  const { host, user, password, path, mapping, sellerId } = req.body;
  if (!host || !user || !password || !path || !mapping)
    return res.status(400).json({
      success: false,
      message: "All FTP credentials and mapping are required.",
    });
  const userIdToAssign = getUserId(req, sellerId);
  if (!userIdToAssign)
    return res
      .status(400)
      .json({ success: false, message: "User identification failed." });

  const client = new ftp.Client();
  try {
    await client.access({ host, user, password, secure: false });
    const buffer = await client.downloadToBuffer(path);
    client.close();

    const readableStream = Readable.from(buffer);
    const userMapping = JSON.parse(mapping);
    const results = await processCsvStreamWithMapping(
      readableStream,
      userMapping
    );

    const operations = results.map((d) => {
      const isAvailable = !d.availability || d.availability === "AVAILABLE";
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
            update: { $set: { availability: "SOLD" } },
            upsert: false,
          },
        };
      }
    });

    const bulkResult = await Diamond.bulkWrite(operations, { ordered: false });

    if (req.app.get("socketio"))
      req.app.get("socketio").emit("inventory-updated", {
        message: "Inventory updated via FTP Sync!",
        newDiamondsAdded: bulkResult.upsertedCount,
        diamondsUpdated: bulkResult.modifiedCount,
      });
    res.status(200).json({
      success: true,
      message: "FTP Sync successful.",
      newDiamondsAdded: bulkResult.upsertedCount,
      diamondsUpdated: bulkResult.modifiedCount,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: `FTP failed: ${error.message}` });
  } finally {
    if (!client.closed) client.close();
  }
});

const previewCsvHeaders = asyncHandler(async (req, res) => {
  if (!req.file)
    return res
      .status(400)
      .json({ success: false, message: "No CSV file uploaded." });
  const headers = await getHeaders(req.file.buffer);
  res.status(200).json({ success: true, headers });
});

const previewHeadersFromUrl = asyncHandler(async (req, res) => {
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
    headers = Object.keys(sampleObject);
  } catch (jsonError) {
    headers = await getHeaders(Buffer.from(response.data));
  }
  if (!headers || headers.length === 0)
    throw new Error("Could not extract any headers.");
  res.status(200).json({ success: true, headers });
});

const previewFtpHeaders = asyncHandler(async (req, res) => {
  const { host, user, password, path } = req.body;
  if (!host || !user || !password || !path)
    return res
      .status(400)
      .json({ success: false, message: "All FTP credentials are required." });
  const client = new ftp.Client();
  try {
    await client.access({ host, user, password, secure: false });
    const buffer = await client.downloadToBuffer(path);
    client.close();
    const headers = await getHeaders(buffer);
    res.status(200).json({ success: true, headers });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: `FTP error: ${error.message}` });
  } finally {
    if (!client.closed) client.close();
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

const previewFromApi = asyncHandler(async (req, res) => {
  res.status(501).json({ message: "Not implemented" });
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
  previewFromApi,
  getSupplierDiamonds,
  updateDiamondStatus,
};
