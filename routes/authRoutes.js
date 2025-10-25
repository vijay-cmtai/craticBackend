const express = require("express");
const router = express.Router();
const {
  register,
  login,
  getMe,
  updateUser,
  deleteUser,
  getAllUsers,
  getUserDetailsById,
  verifyOtp,
  forgotPassword,
  resetPassword,
} = require("../controllers/authController");
const upload = require("../middleware/uploadMiddleware");
const { protect, isAdmin } = require("../middleware/authMiddleware");

router.post("/register", upload.single("businessDocument"), register);
router.post("/verify-otp", verifyOtp);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);

router.get("/me", protect, getMe);
router.put("/:id", protect, upload.single("businessDocument"), updateUser);
router.delete("/:id", protect, deleteUser);

router.get("/all", protect, isAdmin, getAllUsers);
router.get("/admin/:id", protect, isAdmin, getUserDetailsById);

module.exports = router;
