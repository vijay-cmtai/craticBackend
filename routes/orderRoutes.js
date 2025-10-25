const express = require("express");
const router = express.Router();
const { protect, isAdmin } = require("../middleware/authMiddleware.js");
const {
  createOrderAndInitiatePayment,
  verifyPayment,
  cancelOrderAndRefund,
  getSingleOrder,
  getMyOrders,
  getSellerOrders,
  getAllOrders,
  updateOrderStatus,
  deleteOrder,
} = require("../controllers/orderController.js");

router
  .route("/")
  .post(protect, createOrderAndInitiatePayment)
  .get(protect, isAdmin, getAllOrders);
router.route("/verify-payment").post(protect, verifyPayment);
router.route("/my-orders").get(protect, getMyOrders);
router.route("/seller-orders").get(protect, getSellerOrders);
router
  .route("/:id")
  .get(protect, getSingleOrder)
  .delete(protect, isAdmin, deleteOrder);
router.route("/:id/cancel").post(protect, cancelOrderAndRefund);
router.route("/:id/status").put(protect, isAdmin, updateOrderStatus);

module.exports = router;
