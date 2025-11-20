const asyncHandler = require("express-async-handler");
const Diamond = require("../models/diamondModel.js");
const User = require("../models/userModel.js");
const { Readable, Writable } = require("stream");
const axios = require("axios");
const ftp = require("basic-ftp");
const csv = require("csv-parser");
const {
  syncInventoryFromApi,
  syncInventoryFromFtp,
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
  const AVAILABLE_STATUSES = ["AVAILABLE", "GA"];
  return results.map((d) => {
    const isAvailable =
      !d.availability ||
      AVAILABLE_STATUSES.includes(String(d.availability).toUpperCase());
    const finalAvailability = isAvailable
      ? "AVAILABLE"
      : String(d.availability).toUpperCase();
    return {
      updateOne: {
        filter: { stockId: d.stockId, user: userIdToAssign },
        update: {
          $set: { ...d, user: userIdToAssign, availability: finalAvailability },
        },
        upsert: true,
      },
    };
  });
};

const downloadFtpToBuffer = (client, path) => {
  return new Promise(async (resolve, reject) => {
    const chunks = [];
    const writable = new Writable({
      write(chunk, _, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    writable.on("error", reject);
    try {
      await client.downloadTo(writable, path);
      resolve(Buffer.concat(chunks));
    } catch (err) {
      reject(err);
    }
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
    return res.status(409).json({
      success: false,
      message: "A diamond with this Stock ID already exists for this supplier.",
    });
  const diamond = await Diamond.create({ ...req.body, user: userIdToAssign });
  res.status(201).json({ success: true, data: diamond });
});

const uploadFromCsv = asyncHandler(async (req, res) => {
  const userIdToAssign = getUserId(req, req.body.sellerId);
  if (!userIdToAssign)
    return res
      .status(400)
      .json({ success: false, message: "User identification failed." });

  try {
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "No CSV file uploaded." });
    const { mapping } = req.body;
    if (!mapping)
      return res
        .status(400)
        .json({ success: false, message: "Field mapping not provided." });

    const existingDbStockIds = new Set(
      (
        await Diamond.find(
          { user: userIdToAssign, availability: { $ne: "SOLD" } },
          "stockId"
        ).lean()
      ).map((d) => d.stockId)
    );
    const userMapping = JSON.parse(mapping);
    const readableStream = Readable.from(req.file.buffer);
    const results = await processCsvStreamWithMapping(
      readableStream,
      userMapping
    );
    const newFileStockIds = new Set(results.map((d) => d.stockId));
    const operations = createBulkOperations(results, userIdToAssign);

    let bulkResult = { upsertedCount: 0, modifiedCount: 0 };
    if (operations.length > 0) {
      bulkResult = await Diamond.bulkWrite(operations, { ordered: false });
    }

    const stockIdsToRemove = [...existingDbStockIds].filter(
      (id) => !newFileStockIds.has(id)
    );
    let removedCount = 0;
    if (stockIdsToRemove.length > 0) {
      const { deletedCount } = await Diamond.deleteMany({
        user: userIdToAssign,
        stockId: { $in: stockIdsToRemove },
      });
      removedCount = deletedCount;
    }

    const responsePayload = {
      message: "Inventory synced via CSV Upload!",
      newDiamondsAdded: bulkResult.upsertedCount,
      diamondsUpdated: bulkResult.modifiedCount,
      diamondsRemoved: removedCount,
    };

    if (req.app.get("socketio"))
      req.app.get("socketio").emit("inventory-updated", responsePayload);
    res.status(200).json({ success: true, ...responsePayload });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `CSV processing failed: ${error.message}`,
    });
  }
});

const syncFromApi = asyncHandler(async (req, res) => {
  try {
    const { apiUrl, mapping, sellerId, enableAutoSync } = req.body;

    if (!apiUrl || !mapping) {
      return res
        .status(400)
        .json({ success: false, message: "apiUrl and mapping are required." });
    }

    const userIdToAssign = getUserId(req, sellerId);
    if (!userIdToAssign) {
      return res
        .status(400)
        .json({ success: false, message: "User identification failed." });
    }

    const result = await syncInventoryFromApi(
      apiUrl,
      JSON.parse(mapping),
      userIdToAssign
    );

    if (result.success) {
      const user = await User.findById(userIdToAssign);
      if (user) {
        user.apiSync.apiUrl = apiUrl;
        user.apiSync.apiMapping = JSON.parse(mapping);
        user.apiSync.enabled = enableAutoSync === true;
        await user.save();
      }

      if (req.app.get("socketio")) {
        req.app.get("socketio").emit("inventory-updated", {
          message: "Inventory updated via API Sync!",
          ...result,
        });
      }
    }

    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `API sync failed unexpectedly: ${error.message}`,
    });
  }
});

const syncFromFtp = asyncHandler(async (req, res) => {
  const { host, user, password, path, mapping, sellerId, enableAutoSync } =
    req.body;
  const userIdToAssign = getUserId(req, sellerId);
  if (!userIdToAssign)
    return res
      .status(400)
      .json({ success: false, message: "User identification failed." });
  if (!host || !path || !mapping)
    return res.status(400).json({
      success: false,
      message: "Host, Path and Mapping are required.",
    });

  try {
    const ftpCreds = { host, user, password, path };
    const userMapping = JSON.parse(mapping);
    const result = await syncInventoryFromFtp(
      ftpCreds,
      userMapping,
      userIdToAssign
    );

    if (result.success) {
      const supplier = await User.findById(userIdToAssign);
      if (supplier) {
        supplier.ftpSync.enabled = enableAutoSync === true;
        supplier.ftpSync.host = host;
        supplier.ftpSync.user = user;
        supplier.ftpSync.password = password;
        supplier.ftpSync.path = path;
        supplier.ftpSync.ftpMapping = userMapping;
        await supplier.save();
      }
      if (req.app.get("socketio"))
        req.app.get("socketio").emit("inventory-updated", result);
    }

    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `FTP sync controller failed: ${error.message}`,
    });
  }
});

const previewCsvHeaders = asyncHandler(async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "No CSV file uploaded." });
    const headers = await getHeaders(req.file.buffer);
    res.status(200).json({ success: true, headers });
  } catch (error) {
    res.status(400).json({
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
    res.status(500).json({
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
    const headers = await getHeaders(buffer);
    res.status(200).json({ success: true, headers });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: `FTP error: ${error.message}` });
  } finally {
    if (!client.closed) {
      client.close();
    }
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
    if (req.user.role === "Admin") {
      if (req.query.sellerId && req.query.sellerId !== "undefined" && req.query.sellerId !== "null") {
        filter.user = req.query.sellerId;
      }
      
    } 
    else if (req.user.role === "Supplier") {
      filter.user = req.user._id;
    }
  }
  const count = await Diamond.countDocuments(filter);
  const diamonds = await Diamond.find(filter)
    .populate("user", "name companyName")
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
  if (!diamond) return res.status(404).json({ message: "Diamond removed" });
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
