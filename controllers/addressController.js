// controllers/addressController.js (NEW FILE)

const asyncHandler = require("express-async-handler");
const Address = require("../models/addressModel.js");

const addAddress = asyncHandler(async (req, res) => {
  const {
    addressLine1,
    city,
    state,
    postalCode,
    country,
    addressType,
    isDefault,
  } = req.body;

  if (!addressLine1 || !city || !state || !postalCode || !country) {
    res.status(400);
    throw new Error("Please fill all required address fields");
  }

  if (isDefault) {
    await Address.updateMany({ user: req.user._id }, { isDefault: false });
  }

  const address = new Address({
    user: req.user._id,
    addressLine1,
    addressLine2: req.body.addressLine2 || "",
    city,
    state,
    postalCode,
    country,
    addressType,
    isDefault,
  });

  const createdAddress = await address.save();
  console.log(
    `Address created with ID: ${createdAddress._id} for user ID: ${req.user._id}`
  );
  res.status(201).json(createdAddress);
});

const getUserAddresses = asyncHandler(async (req, res) => {
  const addresses = await Address.find({ user: req.user._id });
  console.log(
    `Fetched ${addresses.length} addresses for user ID: ${req.user._id}`
  );
  res.json(addresses);
});

const updateAddress = asyncHandler(async (req, res) => {
  const address = await Address.findById(req.params.addressId);

  if (!address) {
    res.status(404);
    throw new Error("Address not found");
  }

  if (address.user.toString() !== req.user._id.toString()) {
    res.status(401);
    throw new Error("User not authorized to update this address");
  }

  if (req.body.isDefault === true && !address.isDefault) {
    await Address.updateMany({ user: req.user._id }, { isDefault: false });
  }

  address.addressLine1 = req.body.addressLine1 || address.addressLine1;
  address.addressLine2 = req.body.addressLine2 || address.addressLine2;
  address.city = req.body.city || address.city;
  address.state = req.body.state || address.state;
  address.postalCode = req.body.postalCode || address.postalCode;
  address.country = req.body.country || address.country;
  address.addressType = req.body.addressType || address.addressType;
  address.isDefault =
    req.body.isDefault !== undefined ? req.body.isDefault : address.isDefault;

  const updatedAddress = await address.save();
  console.log(`Address updated with ID: ${updatedAddress._id}`);
  res.json(updatedAddress);
});

const deleteAddress = asyncHandler(async (req, res) => {
  const address = await Address.findById(req.params.addressId);

  if (!address) {
    res.status(404);
    throw new Error("Address not found");
  }

  if (address.user.toString() !== req.user._id.toString()) {
    res.status(401);
    throw new Error("User not authorized to delete this address");
  }

  await address.deleteOne();
  console.log(`Address deleted with ID: ${req.params.addressId}`);
  res.json({ message: "Address removed successfully" });
});

const setDefaultAddress = asyncHandler(async (req, res) => {
  const addressToSetDefault = await Address.findById(req.params.addressId);

  if (
    !addressToSetDefault ||
    addressToSetDefault.user.toString() !== req.user._id.toString()
  ) {
    res.status(404);
    throw new Error("Address not found or not authorized");
  }

  await Address.updateMany({ user: req.user._id }, { isDefault: false });

  addressToSetDefault.isDefault = true;
  await addressToSetDefault.save();

  console.log(
    `Address ${req.params.addressId} set as default for user: ${req.user._id}`
  );
  res.json({ message: "Default address updated" });
});

module.exports = {
  addAddress,
  getUserAddresses,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
};
