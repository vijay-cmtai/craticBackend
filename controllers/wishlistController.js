const User = require("../models/userModel");

// Wishlist get karna
exports.getWishlist = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate({
      path: "wishlist",
      model: "Diamond",
      select: "stockId shape carat color clarity price imageLink",
    });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(user.wishlist);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Wishlist me add karna
exports.addToWishlist = async (req, res) => {
  const { diamondId } = req.body;
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $addToSet: { wishlist: diamondId } },
      { new: true }
    );
    res
      .status(200)
      .json({ message: "Added to wishlist", wishlist: user.wishlist });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Wishlist se remove karna
exports.removeFromWishlist = async (req, res) => {
  const { diamondId } = req.params;
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $pull: { wishlist: diamondId } },
      { new: true }
    );
    res
      .status(200)
      .json({ message: "Removed from wishlist", wishlist: user.wishlist });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
