// models/userModel.js

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const Schema = mongoose.Schema;

const userSchema = new mongoose.Schema(
  {
    // --- Common Fields for All Roles ---
    name: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["Admin", "Buyer", "Supplier"],
      required: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      required: true,
      default: "Pending",
    },
    // --- CART & WISHLIST FIELDS ---
    // Note: Isse 'Diamond' karein, jo aapka product model hai
    cart: [{ type: Schema.Types.ObjectId, ref: "Diamond" }],
    wishlist: [{ type: Schema.Types.ObjectId, ref: "Diamond" }],

    // --- Business-Specific Fields ---
    companyName: { type: String },
    tradingName: { type: String },
    businessType: { type: String },
    companyCountry: { type: String },
    companyWebsite: { type: String },
    companyAddress: { type: String },
    corporateIdentityNumber: { type: String },
    references: { type: String },

    // --- Document Upload ---
    businessDocument: { public_id: { type: String }, url: { type: String } },

    // --- OTP & PASSWORD RESET ---
    isVerified: { type: Boolean, default: true },
    otp: String,
    otpExpires: Date,
    resetPasswordToken: String,
    resetPasswordExpires: Date,

    // ✨✨✨ YEH NAYE FIELDS ADD KIYE GAYE HAIN ✨✨✨
    apiSync: {
      enabled: { type: Boolean, default:true }, // Sync on/off karne ke liye
      apiUrl: { type: String, trim: true },
      apiMapping: { type: Map, of: String },
      lastSyncStatus: { type: String },
      lastSyncDate: { type: Date },
    },
  },
  { timestamps: true }
);

// Password ko save karne se pehle hash karein
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Password reset token generate karne ke liye method
userSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(20).toString("hex");
  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");
  this.resetPasswordExpires = Date.now() + 10 * 60 * 1000;
  return resetToken;
};

module.exports = mongoose.model("User", userSchema);
