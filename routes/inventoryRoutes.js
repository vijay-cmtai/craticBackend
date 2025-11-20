// routes/inventoryRoutes.js

const express = require("express");
const router = express.Router();
const {
  protect,
  isAdmin,
  optionalProtect,
} = require("../middleware/authMiddleware.js");

// ✨ 1. Sahi middleware ko import karein
const upload = require("../middleware/csvUploadMiddleware.js");

const {
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
} = require("../controllers/inventoryController.js");

// --- ROUTES ---
router.route("/").get(optionalProtect, getDiamonds);
router.route("/add-manual").post(protect, addManualDiamond);

// ✨ 2. CSV upload route par middleware lagayein
// Yeh line 'csvFile' naam ki file ko req.file mein daal degi
router
  .route("/upload-csv")
  .post(protect, upload.single("csvFile"), uploadFromCsv);

router.route("/sync-api").post(protect, syncFromApi);
router.route("/sync-ftp").post(protect, syncFromFtp);

router.route("/my-inventory").get(protect, getSupplierDiamonds);
router.route("/:id/status").put(protect, updateDiamondStatus);

// ✨ 3. CSV preview route par bhi middleware lagana zaroori hai
router
  .route("/preview-csv-headers")
  .post(protect, upload.single("csvFile"), previewCsvHeaders);

router.route("/preview-headers-url").post(protect, previewHeadersFromUrl);
router.route("/preview-ftp-headers").post(protect, previewFtpHeaders);

router.route("/stock/:stockId").get(getDiamondByStockId);

router
  .route("/:id")
  .get(getDiamondById)
  .put(protect, updateDiamond)
  .delete(protect, deleteDiamond);

module.exports = router;
