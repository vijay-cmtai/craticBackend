const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware.js");
const {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} = require("../controllers/notificationController.js");

router.route("/").get(protect, getNotifications);
router.route("/read-all").put(protect, markAllNotificationsAsRead);
router.route("/:id/read").put(protect, markNotificationAsRead);

module.exports = router;
