const mongoose = require("mongoose");

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    apiUrl: { type: String },
    ftpInfo: {
      host: String,
      user: String,
      pass: String,
      path: String,
    },
    mapping: { type: Map, of: String, required: true },
    isActive: { type: Boolean, default: true },
    lastSyncDate: Date,
    lastSyncStatus: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Supplier", supplierSchema);
