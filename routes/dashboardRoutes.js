const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware.js");
const {
  getSupplierDashboardData,
} = require("../controllers/dashboardController.js");

router.route("/supplier").get(protect, getSupplierDashboardData);

module.exports = router;
