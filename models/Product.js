const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Service title is required"],
      trim: true,
      maxlength: [100, "Title cannot exceed 100 characters"],
    },
    description: {
      type: String,
      required: [true, "Service description is required"],
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },
    images: [
      {
        url: {
          type: String,
          required: true,
        },
        public_id: {
          type: String,
          required: false,
        },
      },
    ],
    price: {
      type: Number,
      required: [true, "Service price is required"],
      min: [0, "Price cannot be negative"],
    },

    features: [
      {
        type: String,
        required: true,
      },
    ],

    availability: {
      type: Number,
      required: [true, "Available accounts quantity is required"],
      min: [0, "Availability cannot be negative"],
      default: 0,
    },
    autoDelivery: {
      type: Boolean,
      default: false,
    },
    deliveryPriority: {
      type: Number,
      default: 5,
      min: [1, "Priority must be at least 1"],
      max: [10, "Priority cannot exceed 10"],
      description: "Delivery priority (1 = highest, 10 = lowest)"
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Service category is required"],
    },
    featured: {
      type: Boolean,
      default: false,
    },
    active: {
      type: Boolean,
      default: true,
    },
    slug: {
      type: String,
      unique: true,
    },
  },
  {
    timestamps: true,
  }
);

// Create slug from title before saving
productSchema.pre("save", function (next) {
  if (this.isModified("title")) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim("-");
  }
  next();
});

// Virtual for formatted price
productSchema.virtual("formattedPrice").get(function () {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
  }).format(this.price);
});

// Ensure virtual fields are serialized
productSchema.set("toJSON", { virtuals: true });
productSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Product", productSchema);
