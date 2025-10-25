const express = require("express");
const router = express.Router();
const { protect, admin } = require("../middleware/authMiddleware.js");
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

router.route("/").get(getDiamonds);
router.route("/add-manual").post(protect, addManualDiamond);
router.route("/upload-csv").post(protect, uploadFromCsv);
router.route("/sync-api").post(protect, syncFromApi);
router.route("/sync-ftp").post(protect, syncFromFtp);

router.route("/my-inventory").get(protect, getSupplierDiamonds);
router.route("/:id/status").put(protect, updateDiamondStatus);

router.route("/preview-csv-headers").post(protect, previewCsvHeaders);
router.route("/preview-headers-url").post(protect, previewHeadersFromUrl);
router.route("/preview-ftp-headers").post(protect, previewFtpHeaders);

router.route("/stock/:stockId").get(getDiamondByStockId);

router
  .route("/:id")
  .get(getDiamondById)
  .put(protect, updateDiamond)
  .delete(protect, deleteDiamond);

module.exports = router;
