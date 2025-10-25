const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    items: [
      {
        diamond: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Diamond",
          required: true,
        },
        priceAtOrder: { type: Number, required: true },
      },
    ],
    totalAmount: { type: Number, required: true, default: 0 },
    orderStatus: {
      type: String,
      required: true,
      enum: [
        "Pending Payment",
        "Processing",
        "Shipped",
        "Completed",
        "Cancelled",
        "Failed",
      ],
      default: "Pending Payment",
    },
    paymentInfo: {
      razorpay_order_id: { type: String },
      razorpay_payment_id: { type: String },
      razorpay_signature: { type: String },
      payment_status: {
        type: String,
        enum: ["Pending", "Paid", "Failed", "Refunded"],
        default: "Pending",
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);
