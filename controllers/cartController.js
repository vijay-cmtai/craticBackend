const User = require("../models/userModel");

// Cart ke items populate karke get karna
exports.getCart = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate({
      path: "cart",
      model: "Diamond",
      select: "stockId shape carat color clarity price imageLink",
    });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(user.cart);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Cart me item add karna
exports.addToCart = async (req, res) => {
  const { diamondId } = req.body;
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $addToSet: { cart: diamondId } },
      { new: true }
    );
    res.status(200).json({ message: "Added to cart", cart: user.cart });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Cart se item remove karna
exports.removeFromCart = async (req, res) => {
  const { diamondId } = req.params;
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $pull: { cart: diamondId } },
      { new: true }
    );
    res.status(200).json({ message: "Removed from cart", cart: user.cart });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Wishlist se cart me move karna
exports.moveFromWishlistToCart = async (req, res) => {
  const { diamondId } = req.body;
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        $pull: { wishlist: diamondId },
        $addToSet: { cart: diamondId },
      },
      { new: true }
    );
    res
      .status(200)
      .json({
        message: "Moved to cart",
        cart: user.cart,
        wishlist: user.wishlist,
      });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
