const axios = require("axios");
const Diamond = require("../models/diamondModel.js");
const csv = require("csv-parser");
const { Readable, Writable } = require("stream");
const ftp = require("basic-ftp");
const valueMapping = require("../config/valueMapping.json");

const safeParseFloat = (value) => {
  if (value === null || value === undefined || String(value).trim() === "")
    return null;
  const num = parseFloat(String(value).replace(/[^0-9.-]+/g, ""));
  return isNaN(num) ? null : num;
};

const convertGoogleSheetsUrl = (url) => {
  if (!url) return "";
  if (url.includes("script.google.com/macros")) return url;
  if (url.includes("docs.google.com/spreadsheets")) {
    const sheetIdMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (sheetIdMatch)
      return `https://docs.google.com/spreadsheets/d/${sheetIdMatch[1]}/export?format=csv`;
  }
  return url;
};

const normalizeRowValues = (row) => {
  const normalizedRow = { ...row };
  for (const header in normalizedRow) {
    const lowerCaseHeader = header.toLowerCase();
    let value = normalizedRow[header];
    if (
      value === null ||
      typeof value === "undefined" ||
      value.toString().trim() === "" ||
      value.toString().trim() === "*"
    )
      continue;
    value = value.toString().trim();
    const headerValueMapping = valueMapping[lowerCaseHeader];
    if (headerValueMapping) {
      const normalizedValue = headerValueMapping[value.toLowerCase()];
      if (normalizedValue !== undefined)
        normalizedRow[header] = normalizedValue;
    }
  }
  return normalizedRow;
};

const processCsvStreamWithMapping = (csvStream, userMapping) => {
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    const invertedMapping = {};
    for (const schemaField in userMapping) {
      if (userMapping[schemaField] && userMapping[schemaField] !== "none") {
        invertedMapping[userMapping[schemaField]] = schemaField;
      }
    }
    const numberFields = [
      "carat",
      "length",
      "width",
      "height",
      "price",
      "depth",
      "table",
    ];
    let rowCount = 0;
    csvStream
      .pipe(
        csv({
          mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, ""),
          skipEmptyLines: true,
        })
      )
      .on("data", (row) => {
        rowCount++;
        try {
          const normalizedRow = normalizeRowValues(row);
          const finalDiamondData = {};
          for (const csvHeader in normalizedRow) {
            const schemaField = invertedMapping[csvHeader.trim()];
            if (schemaField) {
              let value = normalizedRow[csvHeader];
              if (numberFields.includes(schemaField)) {
                const parsedValue = safeParseFloat(value);
                if (parsedValue !== null)
                  finalDiamondData[schemaField] = parsedValue;
              } else if (value !== null && value !== undefined) {
                finalDiamondData[schemaField] = String(value).trim();
              }
            }
          }
          if (finalDiamondData.stockId && finalDiamondData.carat) {
            results.push(finalDiamondData);
          } else {
            if (Object.keys(finalDiamondData).length > 0)
              errors.push({
                row: rowCount,
                message: "Missing stockId or carat after mapping.",
              });
          }
        } catch (err) {
          errors.push({ row: rowCount, message: err.message });
        }
      })
      .on("end", () => {
        if (
          results.length === 0 &&
          rowCount > 0 &&
          errors.length === rowCount
        ) {
          return reject(
            new Error(
              `Processing failed for all ${rowCount} rows. Please check mapping and CSV file.`
            )
          );
        }
        resolve(results);
      })
      .on("error", (err) =>
        reject(new Error(`CSV stream failed: ${err.message}`))
      );
  });
};

const processJsonData = (data, userMapping) => {
  const results = [];
  const errors = [];
  const numberFields = [
    "carat",
    "length",
    "width",
    "height",
    "price",
    "depth",
    "table",
  ];
  let diamondsArray = data;
  if (data.data && Array.isArray(data.data)) diamondsArray = data.data;
  else if (data.diamonds && Array.isArray(data.diamonds))
    diamondsArray = data.diamonds;
  else if (data.result && Array.isArray(data.result))
    diamondsArray = data.result;
  else if (data.results && Array.isArray(data.results))
    diamondsArray = data.results;
  else if (!Array.isArray(data))
    throw new Error("Could not find an array of diamonds in the API response.");
  diamondsArray.forEach((item, index) => {
    try {
      const normalizedItem = normalizeRowValues(item);
      const finalDiamondData = {};
      for (const [schemaField, apiField] of Object.entries(userMapping)) {
        if (!apiField || apiField === "none") continue;
        let value = normalizedItem[apiField];
        if (value !== undefined && value !== null) {
          if (numberFields.includes(schemaField)) {
            const parsedValue = safeParseFloat(value);
            if (parsedValue !== null)
              finalDiamondData[schemaField] = parsedValue;
          } else {
            finalDiamondData[schemaField] = String(value).trim();
          }
        }
      }
      if (finalDiamondData.stockId && finalDiamondData.carat) {
        results.push(finalDiamondData);
      } else {
        if (Object.keys(finalDiamondData).length > 0)
          errors.push({
            row: index + 1,
            message: "Missing stockId or carat after mapping.",
          });
      }
    } catch (err) {
      errors.push({ row: index + 1, message: err.message });
    }
  });
  if (results.length === 0 && errors.length > 0)
    throw new Error(
      `Processing failed for all JSON rows. Sample error: ${errors[0].message}`
    );
  return results;
};

const performDatabaseSync = async (diamondsToProcess, userIdToAssign) => {
  const existingDbStockIds = new Set(
    (
      await Diamond.find(
        { user: userIdToAssign, availability: { $ne: "SOLD" } },
        "stockId"
      ).lean()
    ).map((d) => d.stockId)
  );
  const newFileStockIds = new Set(diamondsToProcess.map((d) => d.stockId));
  const operations = diamondsToProcess.map((d) => {
    const AVAILABLE_STATUSES = ["AVAILABLE", "GA"];
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
  let bulkResult = { upsertedCount: 0, modifiedCount: 0 };
  if (operations.length > 0) {
    bulkResult = await Diamond.bulkWrite(operations, { ordered: false });
  }
  const stockIdsToRemove = [...existingDbStockIds].filter(
    (id) => !newFileStockIds.has(id)
  );
  let archivedCount = 0;
  if (stockIdsToRemove.length > 0) {
    const { modifiedCount } = await Diamond.updateMany(
      {
        user: userIdToAssign,
        stockId: { $in: stockIdsToRemove },
      },
      { $set: { availability: "ARCHIVED" } }
    );
    archivedCount = modifiedCount;
  }
  return {
    newDiamondsAdded: bulkResult.upsertedCount,
    diamondsUpdated: bulkResult.modifiedCount,
    diamondsArchived: archivedCount,
  };
};

const syncInventoryFromApi = async (rawApiUrl, userMapping, userIdToAssign) => {
  try {
    const apiUrl = convertGoogleSheetsUrl(rawApiUrl);
    const response = await axios.get(apiUrl, {
      responseType: "text",
      timeout: 300000,
    });
    if (response.status !== 200)
      throw new Error(`API returned status ${response.status}`);
    if (!response.data || response.data.length === 0) {
      const { modifiedCount } = await Diamond.updateMany(
        {
          user: userIdToAssign,
          availability: "AVAILABLE",
        },
        { $set: { availability: "ARCHIVED" } }
      );
      return {
        success: true,
        message: "Feed was empty. Archived all available listings.",
        diamondsArchived: modifiedCount,
      };
    }
    let diamondsToProcess = [];
    try {
      const jsonData = JSON.parse(response.data);
      diamondsToProcess = processJsonData(jsonData, userMapping);
    } catch (error) {
      const readableStream = Readable.from([response.data]);
      diamondsToProcess = await processCsvStreamWithMapping(
        readableStream,
        userMapping
      );
    }
    const syncResult = await performDatabaseSync(
      diamondsToProcess,
      userIdToAssign
    );
    return {
      success: true,
      message: "API sync completed successfully.",
      ...syncResult,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message || "An unexpected error occurred.",
    };
  }
};

const syncInventoryFromFtp = async (ftpCreds, userMapping, userIdToAssign) => {
  const client = new ftp.Client();
  try {
    await client.access({
      host: ftpCreds.host,
      user: ftpCreds.user,
      password: ftpCreds.password,
      secure: false,
    });
    const writable = new Writable({
      write(chunk, _, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    const chunks = [];
    await client.downloadTo(writable, ftpCreds.path);
    const buffer = Buffer.concat(chunks);
    const readableStream = Readable.from(buffer);
    const diamondsToProcess = await processCsvStreamWithMapping(
      readableStream,
      userMapping
    );
    const syncResult = await performDatabaseSync(
      diamondsToProcess,
      userIdToAssign
    );
    return {
      success: true,
      message: "FTP sync completed successfully.",
      ...syncResult,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message || "An unexpected FTP error occurred.",
    };
  } finally {
    if (!client.closed) {
      client.close();
    }
  }
};

module.exports = {
  syncInventoryFromApi,
  syncInventoryFromFtp,
  processCsvStreamWithMapping,
  processJsonData,
  convertGoogleSheetsUrl,
  safeParseFloat,
};
