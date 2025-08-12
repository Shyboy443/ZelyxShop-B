const mongoose = require("mongoose");
const crypto = require("crypto");

const outlookAccountSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email",
      ],
    },
    displayName: {
      type: String,
      trim: true,
      maxlength: [100, "Display name cannot exceed 100 characters"],
    },
    accessToken: {
      type: String,
      required: true,
      set: function (value) {
        if (value && value.length > 0) {
          // Encrypt the access token
          const cipher = crypto.createCipher(
            "aes-256-cbc",
            process.env.ENCRYPTION_KEY || "default-key"
          );
          let encrypted = cipher.update(value, "utf8", "hex");
          encrypted += cipher.final("hex");
          return encrypted;
        }
        return value;
      },
      get: function (value) {
        if (value && value.length > 0) {
          try {
            // Decrypt the access token
            const decipher = crypto.createDecipher(
              "aes-256-cbc",
              process.env.ENCRYPTION_KEY || "default-key"
            );
            let decrypted = decipher.update(value, "hex", "utf8");
            decrypted += decipher.final("utf8");
            return decrypted;
          } catch (error) {
            console.error("Error decrypting access token:", error);
            return value;
          }
        }
        return value;
      },
    },
    refreshToken: {
      type: String,
      set: function (value) {
        if (value && value.length > 0) {
          // Encrypt the refresh token
          const cipher = crypto.createCipher(
            "aes-256-cbc",
            process.env.ENCRYPTION_KEY || "default-key"
          );
          let encrypted = cipher.update(value, "utf8", "hex");
          encrypted += cipher.final("hex");
          return encrypted;
        }
        return value;
      },
      get: function (value) {
        if (value && value.length > 0) {
          try {
            // Decrypt the refresh token
            const decipher = crypto.createDecipher(
              "aes-256-cbc",
              process.env.ENCRYPTION_KEY || "default-key"
            );
            let decrypted = decipher.update(value, "hex", "utf8");
            decrypted += decipher.final("utf8");
            return decrypted;
          } catch (error) {
            console.error("Error decrypting refresh token:", error);
            return value;
          }
        }
        return value;
      },
    },
    tokenExpiresAt: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastSyncAt: {
      type: Date,
      default: null,
    },
    syncStatus: {
      type: String,
      enum: ["idle", "syncing", "error", "disabled"],
      default: "idle",
    },
    errorMessage: {
      type: String,
      default: null,
    },
    statistics: {
      totalEmailsProcessed: {
        type: Number,
        default: 0,
      },
      totalOrdersFound: {
        type: Number,
        default: 0,
      },
      lastSuccessfulSync: {
        type: Date,
        default: null,
      },
      consecutiveErrors: {
        type: Number,
        default: 0,
      },
    },
    settings: {
      autoSync: {
        type: Boolean,
        default: true,
      },
      syncInterval: {
        type: Number,
        default: 300000, // 5 minutes
        min: [60000, "Minimum sync interval is 1 minute"],
      },
      maxEmailsPerSync: {
        type: Number,
        default: 50,
        min: [1, "Must process at least 1 email"],
        max: [500, "Cannot process more than 500 emails per sync"],
      },
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

// Indexes for efficient querying
outlookAccountSchema.index({ email: 1 });
outlookAccountSchema.index({ isActive: 1 });
outlookAccountSchema.index({ syncStatus: 1 });
outlookAccountSchema.index({ tokenExpiresAt: 1 });

// Check if token is expired
outlookAccountSchema.methods.isTokenExpired = function () {
  return new Date() >= this.tokenExpiresAt;
};

// Update sync statistics
outlookAccountSchema.methods.updateSyncStats = function (
  emailsProcessed,
  ordersFound
) {
  this.statistics.totalEmailsProcessed += emailsProcessed;
  this.statistics.totalOrdersFound += ordersFound;
  this.statistics.lastSuccessfulSync = new Date();
  this.statistics.consecutiveErrors = 0;
  this.lastSyncAt = new Date();
  this.syncStatus = "idle";
  this.errorMessage = null;
  return this.save();
};

// Set sync error
outlookAccountSchema.methods.setSyncError = function (errorMessage) {
  this.syncStatus = "error";
  this.errorMessage = errorMessage;
  this.statistics.consecutiveErrors += 1;
  this.lastSyncAt = new Date();

  // Disable account after 5 consecutive errors
  if (this.statistics.consecutiveErrors >= 5) {
    this.isActive = false;
    this.syncStatus = "disabled";
  }

  return this.save();
};

// Start sync
outlookAccountSchema.methods.startSync = function () {
  this.syncStatus = "syncing";
  this.errorMessage = null;
  return this.save();
};

// Update tokens
outlookAccountSchema.methods.updateTokens = function (
  accessToken,
  refreshToken,
  expiresIn
) {
  this.accessToken = accessToken;
  if (refreshToken) {
    this.refreshToken = refreshToken;
  }
  this.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
  this.statistics.consecutiveErrors = 0;
  if (!this.isActive) {
    this.isActive = true;
    this.syncStatus = "idle";
  }
  return this.save();
};

module.exports = mongoose.model("OutlookAccount", outlookAccountSchema);
