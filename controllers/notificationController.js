const asyncHandler = require("express-async-handler");
const Notification = require("../models/notificationModel");

/**
 * @desc    Get all notifications for logged-in user
 * @route   GET /api/notifications
 * @access  Private
 */
const getNotifications = asyncHandler(async (req, res) => {
  console.log("\n--- [LOG] Fetching notifications API called ---");

  if (!req.user || !req.user._id) {
    console.error(
      "  > [ERROR] User not logged in. Auth token missing or invalid."
    );
    return res.status(401).json({ success: false, message: "Not authorized" });
  }

  const loggedInUserId = req.user._id;
  console.log(`  > Searching for notifications for User ID: ${loggedInUserId}`);

  const notifications = await Notification.find({ user: loggedInUserId }).sort({
    createdAt: -1,
  });

  const unreadCount = await Notification.countDocuments({
    user: loggedInUserId,
    isRead: false,
  });

  console.log(`  > Found ${notifications.length} notifications for this user.`);
  console.log(`  > Unread count: ${unreadCount}`);

  res.status(200).json({
    success: true,
    notifications,
    unreadCount,
  });
});

/**
 * @desc    Mark a single notification as read
 * @route   PUT /api/notifications/:id/read
 * @access  Private
 */
const markNotificationAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);

  if (!notification) {
    res.status(404);
    throw new Error("Notification not found");
  }

  if (notification.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Not authorized to update this notification");
  }

  notification.isRead = true;
  const updatedNotification = await notification.save();

  res.status(200).json({
    success: true,
    notification: updatedNotification,
  });
});

/**
 * @desc    Mark all notifications as read
 * @route   PUT /api/notifications/read-all
 * @access  Private
 */
const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { user: req.user._id, isRead: false },
    { $set: { isRead: true } }
  );

  console.log(`  > Marked ${result.modifiedCount} notifications as read`);

  res.status(200).json({
    success: true,
    message: "All notifications marked as read.",
    modifiedCount: result.modifiedCount,
  });
});

module.exports = {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};
