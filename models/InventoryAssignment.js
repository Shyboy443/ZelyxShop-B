const mongoose = require("mongoose");

const inventoryAssignmentSchema = new mongoose.Schema(
  {
    inventory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      required: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    orderNumber: {
      type: String,
      required: true,
    },
    customerEmail: {
      type: String,
      required: true,
    },
    customerName: {
      type: String,
      required: true,
    },
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["active", "expired", "revoked"],
      default: "active",
    },
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
inventoryAssignmentSchema.index({ inventory: 1, assignedAt: -1 });
inventoryAssignmentSchema.index({ order: 1 });
inventoryAssignmentSchema.index({ customerEmail: 1 });

module.exports = mongoose.model(
  "InventoryAssignment",
  inventoryAssignmentSchema
);
