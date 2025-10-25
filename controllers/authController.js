// controllers/authController.js

const User = require("../models/userModel");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const cloudinary = require("../config/cloudinary").cloudinary;

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "30d",
  });
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
exports.register = asyncHandler(async (req, res) => {
  const { role, name, email, password, ...businessData } = req.body;

  if (!name || !email || !password || !role) {
    res.status(400);
    throw new Error("Name, email, password, and role are required.");
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    res.status(400);
    throw new Error("An account with this email already exists or is pending approval.");
  }

  const userData = { name, email, password, role, status: role === "Admin" ? "Approved" : "Pending", ...businessData };

  if (req.file) {
    userData.businessDocument = { public_id: req.file.filename, url: req.file.path };
  }

  const newUser = new User(userData);
  await newUser.save();

  const message = role === "Admin" ? "Admin registered successfully!" : "Registration request submitted. Waiting for admin approval.";
  res.status(201).json({ message });
});

// @desc    Authenticate a user & get token
// @route   POST /api/auth/login
// @access  Public
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (!user) {
    res.status(401);
    throw new Error("Invalid credentials");
  }

  if (user.status !== "Approved") {
    res.status(403);
    throw new Error(`Your account is currently ${user.status}. Please wait for admin approval.`);
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    res.status(401);
    throw new Error("Invalid credentials");
  }

  res.json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    companyName: user.companyName,
    token: generateToken(user._id),
  });
});

// @desc    Get current logged-in user's data
// @route   GET /api/auth/me
// @access  Private
exports.getMe = asyncHandler(async (req, res) => {
  res.status(200).json(req.user);
});

// @desc    Get all users (for Admin)
// @route   GET /api/auth/all
// @access  Private/Admin
exports.getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find({}).select("-password").sort({ createdAt: -1 });
  res.status(200).json(users);
});

// ✅✅ YEH NAYA FUNCTION HAI ✅✅
// @desc    Get single user details by ID (for Admin)
// @route   GET /api/auth/admin/:id
// @access  Private/Admin
exports.getUserDetailsById = asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id).select("-password");
  
    if (!user) {
      res.status(404);
      throw new Error("User not found");
    }
  
    res.status(200).json(user);
});

// @desc    Update user profile or status
// @route   PUT /api/auth/:id
// @access  Private
exports.updateUser = asyncHandler(async (req, res) => {
  const userIdToUpdate = req.params.id;

  if (req.user.id !== userIdToUpdate && req.user.role !== "Admin") {
    res.status(403);
    throw new Error("Not authorized to update this user.");
  }

  const user = await User.findById(userIdToUpdate);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  const updateData = { ...req.body };
  if (req.file) {
    if (user.businessDocument && user.businessDocument.public_id) {
      await cloudinary.uploader.destroy(user.businessDocument.public_id);
    }
    updateData.businessDocument = { public_id: req.file.filename, url: req.file.path };
  }

  const updatedUser = await User.findByIdAndUpdate(userIdToUpdate, updateData, {
    new: true,
    runValidators: true,
  }).select("-password");

  res.status(200).json(updatedUser);
});

// @desc    Delete a user
// @route   DELETE /api/auth/:id
// @access  Private
exports.deleteUser = asyncHandler(async (req, res) => {
  const userIdToDelete = req.params.id;

  if (req.user.id !== userIdToDelete && req.user.role !== "Admin") {
    res.status(403);
    throw new Error("Not authorized to delete this user.");
  }

  const user = await User.findById(userIdToDelete);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (user.businessDocument && user.businessDocument.public_id) {
    await cloudinary.uploader.destroy(user.businessDocument.public_id);
  }

  await user.deleteOne();
  res.status(200).json({ message: "User deleted successfully", userId: userIdToDelete });
});