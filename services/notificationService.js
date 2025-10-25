const Notification = require("../models/notificationModel");

const createNotification = async (userId, message, link = null) => {
  try {
    if (!userId || !message) {
      throw new Error("User ID and message are required.");
    }
    const notification = new Notification({ user: userId, message, link });
    await notification.save();
    console.log(`Notification created for user ${userId}: "${message}"`);
    return notification;
  } catch (error) {
    console.error("Error creating notification:", error);
  }
};

module.exports = { createNotification };
