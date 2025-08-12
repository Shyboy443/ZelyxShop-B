const mongoose = require("mongoose");
const crypto = require("crypto");

const outlookConfigSchema = new mongoose.Schema(
  {
    clientId: {
      type: String,
      required: [true, "Client ID is required"],
      trim: true,
    },
    clientSecret: {
      type: String,
      required: [true, "Client Secret is required"],
      set: function (value) {
        if (value && value.length > 0) {
          // Encrypt the client secret
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
            // Decrypt the client secret
            const decipher = crypto.createDecipher(
              "aes-256-cbc",
              process.env.ENCRYPTION_KEY || "default-key"
            );
            let decrypted = decipher.update(value, "hex", "utf8");
            decrypted += decipher.final("utf8");
            return decrypted;
          } catch (error) {
            console.error("Error decrypting client secret:", error);
            return value;
          }
        }
        return value;
      },
    },
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      trim: true,
    },
    redirectUri: {
      type: String,
      required: [true, "Redirect URI is required"],
      trim: true,
      validate: {
        validator: function (v) {
          return /^https?:\/\/.+/.test(v);
        },
        message: "Redirect URI must be a valid URL",
      },
    },
    scopes: {
      type: [String],
      default: [
        "https://graph.microsoft.com/Mail.Read",
        "https://graph.microsoft.com/Mail.Send",
      ],
    },
    isEnabled: {
      type: Boolean,
      default: false,
    },
    emailSearchKeywords: {
      type: [String],
      default: ["payment", "receipt", "order", "purchase"],
    },
    maxEmailsToScan: {
      type: Number,
      default: 50,
      min: [1, "Must scan at least 1 email"],
      max: [1000, "Cannot scan more than 1000 emails"],
    },
    scanInterval: {
      type: Number,
      default: 300000, // 5 minutes in milliseconds
      min: [60000, "Minimum scan interval is 1 minute"],
    },
    lastScanAt: {
      type: Date,
      default: null,
    },
    scanStatus: {
      type: String,
      enum: ["idle", "scanning", "error"],
      default: "idle",
    },
    errorMessage: {
      type: String,
      default: null,
    },
    statistics: {
      totalEmailsScanned: {
        type: Number,
        default: 0,
      },
      totalOrdersFound: {
        type: Number,
        default: 0,
      },
      lastSuccessfulScan: {
        type: Date,
        default: null,
      },
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

// Index for efficient querying
outlookConfigSchema.index({ isEnabled: 1 });
outlookConfigSchema.index({ lastScanAt: 1 });

// Method to update scan statistics
outlookConfigSchema.methods.updateScanStats = function (
  emailsScanned,
  ordersFound
) {
  this.statistics.totalEmailsScanned += emailsScanned;
  this.statistics.totalOrdersFound += ordersFound;
  this.statistics.lastSuccessfulScan = new Date();
  this.lastScanAt = new Date();
  this.scanStatus = "idle";
  this.errorMessage = null;
  return this.save();
};

// Method to set scan error
outlookConfigSchema.methods.setScanError = function (errorMessage) {
  this.scanStatus = "error";
  this.errorMessage = errorMessage;
  this.lastScanAt = new Date();
  return this.save();
};

// Method to start scan
outlookConfigSchema.methods.startScan = function () {
  this.scanStatus = "scanning";
  this.errorMessage = null;
  return this.save();
};

module.exports = mongoose.model("OutlookConfig", outlookConfigSchema);
