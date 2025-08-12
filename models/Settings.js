const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    taxRate: {
      type: Number,
      default: 0,
      min: [0, "Tax rate cannot be negative"],
      max: [100, "Tax rate cannot exceed 100%"],
    },
    taxEnabled: {
      type: Boolean,
      default: false,
    },

    // Outlook Email Integration Settings
    outlookClientId: {
      type: String,
      default: "",
      trim: true,
    },
    outlookClientSecret: {
      type: String,
      default: "",
      trim: true,
    },
    outlookTenantId: {
      type: String,
      default: "",
      trim: true,
    },
    outlookRedirectUri: {
      type: String,
      default: "",
      trim: true,
    },
    outlookEnabled: {
      type: Boolean,
      default: false,
    },
    outlookSearchKeywords: {
      type: [String],
      default: ["payment", "receipt", "order", "purchase"],
    },
    outlookMaxEmailsToScan: {
      type: Number,
      default: 50,
      min: [1, "Must scan at least 1 email"],
      max: [1000, "Cannot scan more than 1000 emails"],
    },
    shippingEnabled: {
      type: Boolean,
      default: false,
    },
    freeShippingThreshold: {
      type: Number,
      default: 0,
      min: [0, "Free shipping threshold cannot be negative"],
    },
    shippingRate: {
      type: Number,
      default: 0,
      min: [0, "Shipping rate cannot be negative"],
    },
    currency: {
      type: String,
      enum: ["LKR", "USD"],
      default: "LKR",
    },
    deliveryMessage: {
      type: String,
      default:
        "Digital goods will be sent to your email address after payment confirmation.",
    },
  },
  {
    timestamps: true,
  }
);

// Ensure only one settings document exists
settingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

settingsSchema.statics.updateSettings = async function (updates) {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create(updates);
  } else {
    Object.assign(settings, updates);
    await settings.save();
  }
  return settings;
};

module.exports = mongoose.model("Settings", settingsSchema);
