const asyncHandler = require("express-async-handler");
const Order = require("../models/orderModel");
const Diamond = require("../models/diamondModel");
const User = require("../models/userModel");
const getSupplierDashboardData = asyncHandler(async (req, res) => {
  const supplierId = req.user._id; 
  const today = new Date();
  const startOfToday = new Date(today.setHours(0, 0, 0, 0));
  const startOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOfLastMonth = new Date(
    today.getFullYear(),
    today.getMonth() - 1,
    1
  );
  const endOfLastMonth = new Date(startOfThisMonth - 1);

  const [
    revenueThisMonth,
    revenueLastMonth,
    ordersToday,
    productsInStock,
    recentOrdersData,
    monthlySalesData,
    bestSellersData,
  ] = await Promise.all([
    // Total Revenue this month
    Order.aggregate([
      {
        $match: {
          userId: supplierId,
          createdAt: { $gte: startOfThisMonth },
          orderStatus: "Completed",
        },
      },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
    // Total Revenue last month
    Order.aggregate([
      {
        $match: {
          userId: supplierId,
          createdAt: { $gte: startOfLastMonth, $lt: startOfThisMonth },
          orderStatus: "Completed",
        },
      },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
    // New Orders today
    Order.countDocuments({
      userId: supplierId,
      createdAt: { $gte: startOfToday },
    }),
    Diamond.countDocuments({ user: supplierId, availability: "AVAILABLE" }),
    // Recent Orders (last 5)
    Order.find({ userId: supplierId })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("userId", "name"), 
    Order.aggregate([
      {
        $match: {
          userId: supplierId,
          createdAt: {
            $gte: new Date(new Date().setMonth(today.getMonth() - 6)),
          },
          orderStatus: "Completed",
        },
      },
      {
        $group: {
          _id: {
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" },
          },
          revenue: { $sum: "$totalAmount" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
      {
        $project: {
          _id: 0,
          month: {
            $arrayElemAt: [
              [
                "",
                "Jan",
                "Feb",
                "Mar",
                "Apr",
                "May",
                "Jun",
                "Jul",
                "Aug",
                "Sep",
                "Oct",
                "Nov",
                "Dec",
              ],
              "$_id.month",
            ],
          },
          revenue: "$revenue",
        },
      },
    ]),
    // Best Selling Products (Top 3)
    Order.aggregate([
      { $match: { userId: supplierId } },
      { $unwind: "$items" },
      { $group: { _id: "$items.diamond", sales: { $sum: 1 } } },
      { $sort: { sales: -1 } },
      { $limit: 3 },
      {
        $lookup: {
          from: "diamonds", // the name of the diamonds collection in MongoDB
          localField: "_id",
          foreignField: "_id",
          as: "diamondDetails",
        },
      },
      { $unwind: "$diamondDetails" },
      {
        $project: {
          _id: 0,
          name: {
            $concat: [
              { $toString: "$diamondDetails.carat" },
              "ct ",
              "$diamondDetails.shape",
              " Diamond",
            ],
          },
          image: "$diamondDetails.imageLink", // Assuming you have an imageLink
          sales: "$sales",
        },
      },
    ]),
  ]);
  const currentRevenue = revenueThisMonth[0]?.total || 0;
  const previousRevenue = revenueLastMonth[0]?.total || 0;
  let revenueChange = 0;
  if (previousRevenue > 0) {
    revenueChange =
      ((currentRevenue - previousRevenue) / previousRevenue) * 100;
  } else if (currentRevenue > 0) {
    revenueChange = 100; // If last month was 0, any revenue is a 100% increase
  }

  const formattedRecentOrders = recentOrdersData.map((order) => ({
    id: order._id.toString().slice(-6).toUpperCase(), // Short ID for display
    customer: order.userId?.name || "Unknown Customer",
    amount: order.totalAmount,
    status: order.orderStatus,
  }));

  res.status(200).json({
    stats: {
      totalRevenue: {
        value: `$${currentRevenue.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`,
        change: `${revenueChange.toFixed(1)}% this month`,
      },
      newOrders: {
        value: `+${ordersToday}`,
        change: "today",
      },
      productsInStock: {
        value: productsInStock.toString(),
        change: "available now",
      },
      newCustomers: {
        value: "+0", // Placeholder
        change: "this month",
      },
    },
    salesOverview: monthlySalesData,
    bestSellers: bestSellersData.map((item) => ({
      ...item,
      image: item.image || "/placeholder-diamond.jpg",
    })), // Add fallback image
    recentOrders: formattedRecentOrders,
  });
});

module.exports = {
  getSupplierDashboardData,
};
