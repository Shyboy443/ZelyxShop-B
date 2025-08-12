const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  image: {
    type: String,
  },
  serviceType: {
    type: String,
    required: true,
  },
  duration: {
    type: String,
    required: true,
  },
  accountCredentials: {
    type: String,
    maxlength: [1000, "Account credentials cannot exceed 1000 characters"],
  },
  features: [
    {
      type: String,
    },
  ],
  autoDelivery: {
    type: Boolean,
    default: false,
  },
  deliveryStatus: {
    type: String,
    enum: ["pending", "delivered", "failed"],
    default: "pending",
  },
  delivered: {
    type: Boolean,
    default: false,
  },
  deliveredAt: Date,
  credentials: {
    type: String,
    maxlength: [2000, "Credentials cannot exceed 2000 characters"],
  },
});

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
    },
    customer: {
      firstName: {
        type: String,
        trim: true,
      },
      lastName: {
        type: String,
        trim: true,
      },
      email: {
        type: String,
        required: [true, "Customer email is required"],
        lowercase: true,
        match: [
          /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
          "Please enter a valid email",
        ],
      },
      phone: {
        type: String,
        required: [true, "Customer phone is required"],
        trim: true,
      },
    },
    items: [orderItemSchema],
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    tax: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      enum: ["LKR", "USD"],
      default: "LKR",
    },
    exchangeRate: {
      type: Number,
      default: 1,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "processing", "delivered", "cancelled"],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "confirmed", "failed", "refunded", "declined"],
      default: "pending",
    },

    paymentMethod: {
      type: String,
      enum: [
        "credit_card",
        "debit_card",
        "paypal",
        "bank_transfer",
        "cash_on_delivery",
        "crypto",
        "bank_deposit",
      ],
      default: "credit_card",
    },
    paymentInfo: {
      transactionId: {
        type: String,
        sparse: true,
      },
      paymentIntentId: {
        type: String,
        sparse: true,
      },
      paidAt: {
        type: Date,
      },
      failedAt: {
        type: Date,
      },
      failureReason: {
        type: String,
        maxlength: [500, "Failure reason cannot exceed 500 characters"],
      },
      amount: {
        type: Number,
        min: 0,
      },
      method: {
        type: String,
        enum: ["stripe", "paypal", "manual"],
      },
      refundId: {
        type: String,
        sparse: true,
      },
      refundedAt: {
        type: Date,
      },
      refundAmount: {
        type: Number,
        min: 0,
      },
    },
    paymentConfirmed: {
      type: Boolean,
      default: false,
    },
    receipt: {
      type: String,
      default: null,
    },
    receiptVerification: {
      verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AdminUser",
      },
      verifiedAt: {
        type: Date,
      },
      adminName: {
        type: String,
      },
      status: {
        type: String,
        enum: ["pending", "approved", "declined"],
        default: "pending",
      },
      declinedAt: {
        type: Date,
      },
      declineReason: {
        type: String,
        maxlength: [500, "Decline reason cannot exceed 500 characters"],
      },
      appealCount: {
        type: Number,
        default: 0,
      },
      lastAppealAt: {
        type: Date,
      },
    },
    notes: {
      type: String,
      maxlength: [500, "Notes cannot exceed 500 characters"],
    },
    deliveryInfo: {
      deliveredAt: Date,
      notes: {
        type: String,
        maxlength: [1000, "Delivery notes cannot exceed 1000 characters"],
      },
      method: {
        type: String,
        enum: ["auto", "manual"],
        default: "auto",
      },
    },
    autoDeliveryEnabled: {
      type: Boolean,
      default: true,
      description:
        "Controls whether auto-delivery should be attempted for this order",
    },
    deliveredInventory: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Inventory",
      },
    ],
    paymentTimeout: {
      expiresAt: {
        type: Date,
        default: function () {
          // Set payment timeout to 6 hours from creation for bank deposits
          if (this.paymentMethod === "bank_deposit") {
            return new Date(Date.now() + 6 * 60 * 60 * 1000); // 6 hours
          }
          return null;
        },
      },
      isExpired: {
        type: Boolean,
        default: false,
      },
      notificationSent: {
        type: Boolean,
        default: false,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Import secure ID generator
const { generateUniqueOrderNumber } = require("../utils/idGenerator");

// Generate order number before saving
orderSchema.pre("save", async function (next) {
  try {
    if (this.isNew) {
      this.orderNumber = await generateUniqueOrderNumber();
    }

    // Auto-progress status to processing when payment is confirmed
    if (this.paymentStatus === "confirmed" && this.status === "pending") {
      this.status = "confirmed";
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Virtual for formatted total
orderSchema.virtual("formattedTotal").get(function () {
  const formatter = new Intl.NumberFormat(
    this.currency === "USD" ? "en-US" : "en-LK",
    {
      style: "currency",
      currency: this.currency,
    }
  );
  return formatter.format(this.total);
});

// Ensure virtual fields are serialized
orderSchema.set("toJSON", { virtuals: true });
orderSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Order", orderSchema);
