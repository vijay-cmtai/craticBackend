// routes/addressRoutes.js (NEW FILE)
const express = require("express");
const router = express.Router();
const {
  addAddress,
  getUserAddresses,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} = require("../controllers/addressController.js");

const { protect } = require("../middleware/authMiddleware.js");

router.route("/").post(protect, addAddress).get(protect, getUserAddresses);

router
  .route("/:addressId")
  .put(protect, updateAddress)
  .delete(protect, deleteAddress);

router.route("/default/:addressId").put(protect, setDefaultAddress);

module.exports = router;
