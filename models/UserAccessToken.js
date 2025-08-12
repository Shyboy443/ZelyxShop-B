const mongoose = require("mongoose");
const crypto = require("crypto");

const userAccessTokenSchema = new mongoose.Schema(
  {
    tokenName: {
      type: String,
      trim: true,
      maxlength: [100, "Token name cannot exceed 100 characters"],
    },
    token: {
      type: String,
      required: false,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    usageCount: {
      type: Number,
      default: 0,
    },
    maxUsage: {
      type: Number,
      default: null, // null means unlimited
    },
    lastUsed: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null, // null means no expiration
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.Mixed, // Can be ObjectId or string (for system)
      ref: "AdminUser",
    },
    ipWhitelist: {
      type: [String],
      default: [],
    },
    rateLimit: {
      requestsPerMinute: {
        type: Number,
        default: 60,
      },
      requestsPerHour: {
        type: Number,
        default: 1000,
      },
    },
    retrievedOTPs: [
      {
        otp: {
          type: String,
          required: true,
        },
        timestamp: {
          type: Date,
          required: true,
        },
        service: {
          type: String,
          required: false,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Generate secure token before saving
userAccessTokenSchema.pre("save", function (next) {
  if (this.isNew && !this.token) {
    this.token = "uat_" + crypto.randomBytes(32).toString("hex");
  }
  next();
});

// Check if token is expired
userAccessTokenSchema.methods.isExpired = function () {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
};

// Check if token has reached usage limit
userAccessTokenSchema.methods.hasReachedLimit = function () {
  if (!this.maxUsage) return false;
  return this.usageCount >= this.maxUsage;
};

// Increment usage count
userAccessTokenSchema.methods.incrementUsage = function () {
  this.usageCount += 1;
  this.lastUsed = new Date();
  return this.save();
};

// Check if IP is whitelisted
userAccessTokenSchema.methods.isIpAllowed = function (ip) {
  if (this.ipWhitelist.length === 0) return true;
  return this.ipWhitelist.includes(ip);
};

// Check if OTP has already been retrieved
userAccessTokenSchema.methods.hasRetrievedOTP = function (otp) {
  return this.retrievedOTPs.some((retrievedOTP) => retrievedOTP.otp === otp);
};

// Add OTP to retrieved list
userAccessTokenSchema.methods.addRetrievedOTP = function (
  otp,
  service,
  timestamp
) {
  // Clean up old OTPs (older than 1 hour) to prevent array from growing indefinitely
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  this.retrievedOTPs = this.retrievedOTPs.filter(
    (retrievedOTP) => retrievedOTP.timestamp > oneHourAgo
  );

  // Add new OTP
  this.retrievedOTPs.push({
    otp: otp,
    timestamp: timestamp || new Date(),
    service: service,
  });

  return this.save();
};

module.exports = mongoose.model("UserAccessToken", userAccessTokenSchema);
