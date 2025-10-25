// 📁 routes/cartRoutes.js (Corrected Code)

const express = require("express");
const router = express.Router();
const {
  getCart,
  addToCart,
  removeFromCart,
  moveFromWishlistToCart,
} = require("../controllers/cartController");
const { protect } = require("../middleware/authMiddleware");
router.use(protect);
router.get("/", getCart);
router.post("/add", addToCart);
router.post("/move-from-wishlist", moveFromWishlistToCart);
router.delete("/remove/:diamondId", removeFromCart);

module.exports = router;