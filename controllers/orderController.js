const asyncHandler = require("express-async-handler");
const Order = require("../models/orderModel");
const User = require("../models/userModel");
const Diamond = require("../models/diamondModel");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const Notification = require("../models/notificationModel");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

exports.createOrderAndInitiatePayment = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).populate({
    path: "cart",
    model: "Diamond",
  });

  if (!user || user.cart.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Your cart is empty.",
    });
  }

  const itemsWithPrice = user.cart.map((item) => ({
    diamond: item._id,
    priceAtOrder: item.price,
  }));

  const totalAmount = itemsWithPrice.reduce(
    (sum, item) => sum + item.priceAtOrder,
    0
  );

  const razorpayOrder = await razorpay.orders.create({
    amount: Math.round(totalAmount * 100),
    currency: "INR",
    receipt: `receipt_${new Date().getTime()}`,
  });

  const order = await Order.create({
    userId: user._id,
    items: itemsWithPrice,
    totalAmount,
    paymentInfo: { razorpay_order_id: razorpayOrder.id },
  });

  user.cart = [];
  await user.save();

  res.status(201).json({
    success: true,
    order,
    razorpayOrder,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  });
});

exports.verifyPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    req.body;

  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body.toString())
    .digest("hex");

  const isAuthentic = expectedSignature === razorpay_signature;

  const order = await Order.findOne({
    "paymentInfo.razorpay_order_id": razorpay_order_id,
  }).populate({
    path: "items.diamond",
    model: "Diamond",
    populate: {
      path: "user",
      model: "User",
    },
  });

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found.",
    });
  }

  if (isAuthentic) {
    order.paymentInfo = {
      ...order.paymentInfo,
      razorpay_payment_id,
      razorpay_signature,
      payment_status: "Paid",
    };
    order.orderStatus = "Processing";
    await order.save();

    console.log("\n--- [LOG] Payment Verified. Creating Notifications... ---");

    for (const item of order.items) {
      if (item.diamond && item.diamond.user) {
        const sellerId = item.diamond.user._id;
        console.log(`  > Creating notification for Seller [${sellerId}]`);

        await Diamond.findByIdAndUpdate(item.diamond._id, {
          availability: "SOLD",
        });

        const notificationMessage = `Your diamond (Stock ID: ${
          item.diamond.stockId
        }) has been sold in order #${order._id.toString().slice(-6)}.`;

        await Notification.create({
          user: sellerId,
          message: notificationMessage,
          link: `/orders/${order._id}`,
        });

        console.log(
          `  > ✅ Notification created successfully for Seller [${sellerId}]`
        );
      } else {
        console.error("  > [ERROR] Seller not found for a diamond.");
      }
    }

    res.status(200).json({
      success: true,
      message: "Payment verified successfully.",
      orderId: order._id,
    });
  } else {
    order.paymentInfo.payment_status = "Failed";
    order.orderStatus = "Failed";
    await order.save();

    res.status(400).json({
      success: false,
      message: "Payment verification failed.",
    });
  }
});

exports.cancelOrderAndRefund = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found.",
    });
  }

  if (order.userId.toString() !== req.user.id && req.user.role !== "Admin") {
    return res.status(403).json({
      success: false,
      message: "Not authorized.",
    });
  }

  if (
    order.orderStatus === "Cancelled" ||
    order.paymentInfo.payment_status === "Refunded"
  ) {
    return res.status(400).json({
      success: false,
      message: "Order is already cancelled or refunded.",
    });
  }

  if (order.paymentInfo.payment_status !== "Paid") {
    order.orderStatus = "Cancelled";
    await order.save();
    return res.status(200).json({
      success: true,
      message: "Order cancelled successfully.",
    });
  }

  const refund = await razorpay.payments.refund(
    order.paymentInfo.razorpay_payment_id,
    { amount: Math.round(order.totalAmount * 100) }
  );

  order.orderStatus = "Cancelled";
  order.paymentInfo.payment_status = "Refunded";
  await order.save();

  res.status(200).json({
    success: true,
    message: "Order cancelled and refund initiated.",
    refundDetails: refund,
  });
});

exports.getSingleOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate("userId", "name email")
    .populate("items.diamond");

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found",
    });
  }

  if (
    order.userId._id.toString() !== req.user.id &&
    req.user.role !== "Admin"
  ) {
    return res.status(403).json({
      success: false,
      message: "Not authorized.",
    });
  }

  res.status(200).json({ success: true, order });
});

exports.getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ userId: req.user.id })
    .populate("items.diamond", "stockId shape")
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, orders });
});

exports.getSellerOrders = asyncHandler(async (req, res) => {
  const sellerDiamonds = await Diamond.find({ user: req.user.id }).select(
    "_id"
  );
  const sellerDiamondIds = sellerDiamonds.map((d) => d._id);

  if (sellerDiamondIds.length === 0) {
    return res.status(200).json({ success: true, orders: [] });
  }

  const orders = await Order.find({
    "items.diamond": { $in: sellerDiamondIds },
  })
    .populate("userId", "name email")
    .populate("items.diamond")
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, orders });
});

exports.getAllOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({})
    .populate("userId", "name email")
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    totalOrders: orders.length,
    orders,
  });
});

exports.updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const order = await Order.findById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found",
    });
  }

  order.orderStatus = status;
  await order.save({ validateBeforeSave: true });

  res.status(200).json({
    success: true,
    message: `Order status updated to ${status}`,
    order,
  });
});

exports.deleteOrder = asyncHandler(async (req, res) => {
  const order = await Order.findByIdAndDelete(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found",
    });
  }

  res.status(200).json({
    success: true,
    message: "Order deleted successfully",
  });
});
