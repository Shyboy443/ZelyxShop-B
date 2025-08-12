const mongoose = require("mongoose");

const deliveryLogSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    orderNumber: {
      type: String,
      required: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    productTitle: {
      type: String,
      required: true,
    },
    eventType: {
      type: String,
      enum: [
        "delivery_started",
        "delivery_success",
        "delivery_failed",
        "email_sent",
        "email_failed",
        "inventory_allocated",
        "insufficient_inventory",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["success", "error", "warning", "info"],
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    customerEmail: {
      type: String,
      required: true,
    },
    quantity: {
      type: Number,
      default: 1,
    },
    inventoryUsed: {
      type: Number,
      default: 0,
    },
    errorCode: {
      type: String,
    },
    processingTime: {
      type: Number, // in milliseconds
      default: 0,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    isResolved: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying
deliveryLogSchema.index({ orderId: 1, createdAt: -1 });
deliveryLogSchema.index({ eventType: 1, createdAt: -1 });
deliveryLogSchema.index({ status: 1, createdAt: -1 });
deliveryLogSchema.index({ customerEmail: 1, createdAt: -1 });
deliveryLogSchema.index({ productId: 1, createdAt: -1 });
deliveryLogSchema.index({ isResolved: 1, status: 1 });

// Static methods for logging
deliveryLogSchema.statics.logDeliveryEvent = async function (data) {
  try {
    const log = new this(data);
    await log.save();
    return log;
  } catch (error) {
    console.error("Failed to create delivery log:", error);
    return null;
  }
};

deliveryLogSchema.statics.getDeliveryLogs = async function (
  filters = {},
  options = {}
) {
  const {
    orderId,
    eventType,
    status,
    customerEmail,
    productId,
    startDate,
    endDate,
    isResolved,
  } = filters;

  const { page = 1, limit = 50, sort = { createdAt: -1 } } = options;

  const query = {};

  if (orderId) query.orderId = orderId;
  if (eventType) query.eventType = eventType;
  if (status) query.status = status;
  if (customerEmail) query.customerEmail = customerEmail;
  if (productId) query.productId = productId;
  if (isResolved !== undefined) query.isResolved = isResolved;

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const skip = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    this.find(query)
      .populate("orderId", "orderNumber customer")
      .populate("productId", "title")
      .sort(sort)
      .skip(skip)
      .limit(limit),
    this.countDocuments(query),
  ]);

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

deliveryLogSchema.statics.getDeliveryStats = async function (
  timeframe = "24h"
) {
  const now = new Date();
  let startDate;

  switch (timeframe) {
    case "1h":
      startDate = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case "24h":
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "7d":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  const stats = await this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        avgProcessingTime: { $avg: "$processingTime" },
      },
    },
  ]);

  const eventStats = await this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: "$eventType",
        count: { $sum: 1 },
      },
    },
  ]);

  const errorLogs = await this.find({
    status: "error",
    isResolved: false,
    createdAt: { $gte: startDate },
  })
    .limit(10)
    .sort({ createdAt: -1 });

  return {
    timeframe,
    statusStats: stats,
    eventStats,
    unresolvedErrors: errorLogs.length,
    recentErrors: errorLogs,
  };
};

deliveryLogSchema.statics.markErrorResolved = async function (
  logId,
  resolvedBy
) {
  return this.findByIdAndUpdate(
    logId,
    {
      isResolved: true,
      resolvedAt: new Date(),
      resolvedBy,
    },
    { new: true }
  );
};

module.exports = mongoose.model("DeliveryLog", deliveryLogSchema);
