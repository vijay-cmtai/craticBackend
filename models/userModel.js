const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Schema = mongoose.Schema; // Schema ko import karein

const userSchema = new mongoose.Schema(
  {
    // --- Common Fields for All Roles ---
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
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

    // --- ✅✅ CART & WISHLIST FIELDS (Yahan add kiya gaya hai) ✅✅ ---
    cart: [
      {
        type: Schema.Types.ObjectId,
        ref: "Diamond", // Yeh aapke 'Diamond' model ko refer karega
      },
    ],
    wishlist: [
      {
        type: Schema.Types.ObjectId,
        ref: "Diamond", // Yeh bhi 'Diamond' model ko refer karega
      },
    ],
    // -----------------------------------------------------------

    // --- Business-Specific Fields (for Buyer/Supplier) ---
    companyName: { type: String },
    tradingName: { type: String },
    businessType: { type: String },
    companyCountry: { type: String },
    companyWebsite: { type: String },
    companyAddress: { type: String },
    corporateIdentityNumber: { type: String },
    references: { type: String },

    // --- Document Uploaded via Cloudinary ---
    businessDocument: {
      public_id: { type: String },
      url: { type: String },
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

module.exports = mongoose.model("User", userSchema);
