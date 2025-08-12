const mongoose = require("mongoose");

const inventorySchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product reference is required"],
    },
    accountCredentials: {
      type: String,
      required: [true, "Account credentials are required"],
      maxlength: [1000, "Account credentials cannot exceed 1000 characters"],
    },
    username: {
      type: String,
      maxlength: [100, "Username cannot exceed 100 characters"],
    },
    password: {
      type: String,
      maxlength: [100, "Password cannot exceed 100 characters"],
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    usedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    assignmentCount: {
      type: Number,
      default: 0,
    },
    maxAssignments: {
      type: Number,
      default: 1,
    },
    notes: {
      type: String,
      maxlength: [500, "Notes cannot exceed 500 characters"],
    },
    status: {
      type: String,
      enum: ["available", "reserved", "delivered", "expired"],
      default: "available",
    },
    expirationDate: {
      type: Date,
      default: null,
    },
    allowUpdatesAfterExpiry: {
      type: Boolean,
      default: true,
      description: "Whether to allow credential updates after expiration date",
    },
    originalDeliveryDate: {
      type: Date,
      default: null,
      description: "Original delivery date for tracking subscription duration",
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
inventorySchema.index({ product: 1, status: 1 });
inventorySchema.index({ isUsed: 1, status: 1 });

// Virtual for availability check
inventorySchema.virtual("isAvailable").get(function () {
  return (
    this.status === "available" &&
    this.assignmentCount < this.maxAssignments &&
    (!this.expirationDate || this.expirationDate > new Date())
  );
});

// Virtual for expiry check
inventorySchema.virtual("isExpired").get(function () {
  if (!this.expirationDate) return false;
  return new Date() > this.expirationDate;
});

// Virtual for update eligibility
inventorySchema.virtual("canReceiveUpdates").get(function () {
  if (!this.isExpired) return true;
  return this.allowUpdatesAfterExpiry;
});

// Ensure virtual fields are serialized
inventorySchema.set("toJSON", { virtuals: true });
inventorySchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Inventory", inventorySchema);
