const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const AdminUser = require("../models/AdminUser");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Order = require("../models/Order");
const Inventory = require("../models/Inventory");
const InventoryAssignment = require("../models/InventoryAssignment");
const Settings = require("../models/Settings");
const DeliveryLog = require("../models/DeliveryLog");
const UserAccessToken = require("../models/UserAccessToken");

const AutoDeliveryService = require("../services/autoDeliveryService");
const NotificationService = require("../services/notificationService");
const PaymentTimeoutService = require("../services/paymentTimeoutService");
const CustomerNotificationService = require("../services/customerNotificationService");

const { protect, authorize } = require("../middlewares/auth");
const {
  validateProduct,
  validateCategory,
} = require("../middlewares/validation");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const createDefaultAdmin = require("../utils/createAdmin");

// Import sub-routes
const accessTokenRoutes = require("./accessTokens");
const outlookAccountRoutes = require("./outlookAccounts");
const emailVerificationRoutes = require("./emailVerification");

// Use sub-routes
router.use("/access-tokens", accessTokenRoutes);
router.use("/outlook-accounts", outlookAccountRoutes);
router.use("/email-verification", emailVerificationRoutes);

// Configure multer for file uploads
const upload = multer({ dest: "uploads/receipts/" });

// @desc    Reset admin users (delete all and create default)
// @route   POST /api/admin/reset-admins
// @access  Private (Super Admin)
router.post(
  "/reset-admins",
  protect,
  authorize("super_admin"),
  async (req, res) => {
    try {
      await AdminUser.deleteMany({});
      await createDefaultAdmin();
      res.json({ success: true, message: "Admin users reset successfully" });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error resetting admins",
        error: error.message,
      });
    }
  }
);

// @desc    Get pending receipt verifications
// @route   GET /api/admin/receipts/pending
// @access  Private (Admin)
router.get("/receipts/pending", protect, async (req, res) => {
  try {
    const pendingOrders = await Order.find({
      paymentMethod: "bank_deposit",
      receipt: { $ne: null },
      paymentStatus: "pending",
    })
      .populate("items.product", "title price")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: pendingOrders,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching pending receipts",
      error: error.message,
    });
  }
});

// @desc    Get receipt verification history
// @route   GET /api/admin/receipts/history
// @access  Private (Admin)
router.get("/receipts/history", protect, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const verifiedOrders = await Order.find({
      paymentMethod: "bank_deposit",
      receipt: { $ne: null },
      paymentStatus: "confirmed",
    })
      .populate("items.product", "title price")
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Order.countDocuments({
      paymentMethod: "bank_deposit",
      receipt: { $ne: null },
      paymentStatus: "confirmed",
    });

    res.json({
      success: true,
      data: verifiedOrders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching verification history",
      error: error.message,
    });
  }
});

// @desc    Admin login (No Security - Always Success)
// @route   POST /api/admin/login
// @access  Public
router.post("/login", async (req, res) => {
  try {
    // Always return success regardless of credentials
    const userData = {
      id: "507f1f77bcf86cd799439011",
      email: "admin@gmail.com",
      firstName: "Admin",
      lastName: "User",
      role: "super_admin",
      lastLogin: new Date(),
    };

    // Create a proper JWT token
    const jwt = require("jsonwebtoken");
    const token = jwt.sign(
      { id: userData.id },
      process.env.JWT_SECRET || "fallback_secret",
      { expiresIn: "30d" }
    );

    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user: userData,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error during login",
      error: error.message,
    });
  }
});

// @desc    Get admin profile
// @route   GET /api/admin/profile
// @access  Private (Admin)
router.get("/profile", protect, (req, res) => {
  res.json({
    success: true,
    data: req.user,
  });
});

// @desc    Get dashboard stats
// @route   GET /api/admin/dashboard
// @access  Private (Admin)
router.get("/dashboard", protect, async (req, res) => {
  try {
    const [
      totalProducts,
      totalCategories,
      totalOrders,
      recentOrders,
      orderStatusCounts,
    ] = await Promise.all([
      Product.countDocuments({ active: true }),
      Category.countDocuments({ active: true }),
      Order.countDocuments(),
      Order.find()
        .populate("items.product", "title")
        .sort({ createdAt: -1 })
        .limit(5),
      // Get order counts by status
      Order.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    // Calculate total revenue from paid and confirmed orders
    const revenueData = await Order.aggregate([
      {
        $match: {
          paymentStatus: { $in: ["paid", "confirmed"] },
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$total" },
          paidOrders: { $sum: 1 },
        },
      },
    ]);

    const totalRevenue =
      revenueData.length > 0 ? revenueData[0].totalRevenue : 0;

    // Process order status counts
    const statusCounts = orderStatusCounts.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    const pendingOrders =
      (statusCounts.pending || 0) + (statusCounts.confirmed || 0);
    const completedOrders = statusCounts.delivered || 0;
    const processingOrders = statusCounts.processing || 0;
    const shippedOrders = statusCounts.shipped || 0;
    const cancelledOrders = statusCounts.cancelled || 0;

    // Get low stock products
    const lowStockProducts = await Product.find({
      active: true,
      availability: { $lte: 5 },
    })
      .select("title availability")
      .limit(10);

    res.json({
      success: true,
      data: {
        stats: {
          totalProducts,
          totalCategories,
          totalOrders,
          totalRevenue,
          pendingOrders,
          completedOrders,
          processingOrders,
          shippedOrders,
          cancelledOrders,
        },
        recentOrders,
        lowStockProducts,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching dashboard data",
      error: error.message,
    });
  }
});

// ===== PRODUCT MANAGEMENT =====

// @desc    Get all products (Admin)
// @route   GET /api/admin/products
// @access  Private (Admin)
router.get("/products", protect, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      category,
      status = "all",
    } = req.query;

    let query = {};

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    if (category) {
      query.category = category;
    }

    if (status !== "all") {
      query.active = status === "active";
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const products = await Product.find(query)
      .populate("category", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get assignment counts for auto-delivery products
    const productsWithAssignments = await Promise.all(
      products.map(async (product) => {
        const productObj = product.toObject();

        if (product.autoDelivery) {
          // Get available assignment capacity for auto-delivery products using the same logic as autoDeliveryService
          const inventoryResult = await Inventory.aggregate([
            {
              $match: {
                product: product._id,
                status: "available",
              },
            },
            {
              $lookup: {
                from: "inventoryassignments",
                localField: "_id",
                foreignField: "inventory",
                as: "assignments",
              },
            },
            {
              $addFields: {
                activeAssignments: {
                  $size: {
                    $filter: {
                      input: "$assignments",
                      cond: { $eq: ["$$this.status", "active"] },
                    },
                  },
                },
                remainingAssignments: {
                  $subtract: [
                    { $ifNull: ["$maxAssignments", 1] },
                    {
                      $size: {
                        $filter: {
                          input: "$assignments",
                          cond: { $eq: ["$$this.status", "active"] },
                        },
                      },
                    },
                  ],
                },
              },
            },
            {
              $match: {
                $expr: {
                  $gt: ["$remainingAssignments", 0],
                },
              },
            },
            {
              $group: {
                _id: null,
                availableCount: { $sum: "$remainingAssignments" },
                totalMaxAssignments: {
                  $sum: { $ifNull: ["$maxAssignments", 1] },
                },
              },
            },
          ]);

          const inventoryData = inventoryResult[0] || {
            availableCount: 0,
            totalMaxAssignments: 0,
          };
          productObj.availableCount = Math.max(0, inventoryData.availableCount); // Ensure non-negative
          productObj.maxAssignments = inventoryData.totalMaxAssignments;
        }

        return productObj;
      })
    );

    const total = await Product.countDocuments(query);

    res.json({
      success: true,
      data: {
        products: productsWithAssignments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching products",
      error: error.message,
    });
  }
});

// @desc    Get single product (Admin)
// @route   GET /api/admin/products/:id
// @access  Private (Admin)
router.get("/products/:id", protect, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate(
      "category",
      "name slug"
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching product",
      error: error.message,
    });
  }
});

// @desc    Create product
// @route   POST /api/admin/products
// @access  Private (Admin)
router.post("/products", protect, validateProduct, async (req, res) => {
  try {
    const product = new Product(req.body);
    await product.save();
    await product.populate("category", "name");

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error creating product",
      error: error.message,
    });
  }
});

// @desc    Update product
// @route   PUT /api/admin/products/:id
// @access  Private (Admin)
router.put("/products/:id", protect, validateProduct, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).populate("category", "name");

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({
      success: true,
      message: "Product updated successfully",
      data: product,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating product",
      error: error.message,
    });
  }
});

// @desc    Update product auto-delivery setting and priority
// @route   PATCH /api/admin/products/:id
// @access  Private (Admin)
router.patch("/products/:id", protect, async (req, res) => {
  try {
    const { autoDelivery, deliveryPriority } = req.body;

    const updateData = {};

    if (autoDelivery !== undefined) {
      if (typeof autoDelivery !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "autoDelivery must be a boolean value",
        });
      }
      updateData.autoDelivery = autoDelivery;
    }

    if (deliveryPriority !== undefined) {
      const priority = parseInt(deliveryPriority);
      if (isNaN(priority) || priority < 1 || priority > 10) {
        return res.status(400).json({
          success: false,
          message: "deliveryPriority must be a number between 1 and 10",
        });
      }
      updateData.deliveryPriority = priority;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update",
      });
    }

    const product = await Product.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).populate("category", "name");

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({
      success: true,
      message: `Auto-delivery ${
        autoDelivery ? "enabled" : "disabled"
      } successfully`,
      data: product,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating auto-delivery setting",
      error: error.message,
    });
  }
});

// @desc    Delete product
// @route   DELETE /api/admin/products/:id
// @access  Private (Admin)
router.delete("/products/:id", protect, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting product",
      error: error.message,
    });
  }
});

// ===== CATEGORY MANAGEMENT =====

// @desc    Get all categories (Admin)
// @route   GET /api/admin/categories
// @access  Private (Admin)
router.get("/categories", protect, async (req, res) => {
  try {
    const categories = await Category.find().sort({ sortOrder: 1, name: 1 });

    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching categories",
      error: error.message,
    });
  }
});

// @desc    Create category
// @route   POST /api/admin/categories
// @access  Private (Admin)
router.post("/categories", protect, validateCategory, async (req, res) => {
  try {
    const category = new Category(req.body);
    await category.save();

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: category,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error creating category",
      error: error.message,
    });
  }
});

// @desc    Update category
// @route   PUT /api/admin/categories/:id
// @access  Private (Admin)
router.put("/categories/:id", protect, validateCategory, async (req, res) => {
  try {
    const category = await Category.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    res.json({
      success: true,
      message: "Category updated successfully",
      data: category,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating category",
      error: error.message,
    });
  }
});

// @desc    Delete category
// @route   DELETE /api/admin/categories/:id
// @access  Private (Admin)
router.delete("/categories/:id", protect, async (req, res) => {
  try {
    // Check if category has products
    const productCount = await Product.countDocuments({
      category: req.params.id,
    });

    if (productCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category. It has ${productCount} products associated with it.`,
      });
    }

    const category = await Category.findByIdAndDelete(req.params.id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    res.json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting category",
      error: error.message,
    });
  }
});

// @desc    Initialize/Update categories with new structure
// @route   POST /api/admin/categories/initialize
// @access  Private (Admin)
router.post("/categories/initialize", protect, async (req, res) => {
  try {
    const newCategories = [
      {
        name: "AI & Machine Learning",
        description:
          "ChatGPT, Perplexity, Claude, and other AI-powered services",
        serviceProvider: "OpenAI, Anthropic, Perplexity",
        popularityScore: 98,
        sortOrder: 1,
        icon: "smart_toy",
      },
      {
        name: "Creative & Design Tools",
        description:
          "Adobe Creative Suite, Canva Pro, Figma, and design software",
        serviceProvider: "Adobe, Canva, Figma",
        popularityScore: 95,
        sortOrder: 2,
        icon: "palette",
      },
      {
        name: "Video & Photo Editing",
        description:
          "CapCut Pro, Adobe Premiere, Photoshop, and video editing tools",
        serviceProvider: "ByteDance, Adobe",
        popularityScore: 92,
        sortOrder: 3,
        icon: "video_library",
      },
      {
        name: "Streaming & Entertainment",
        description:
          "Netflix, Disney+, Spotify, YouTube Premium, and entertainment platforms",
        serviceProvider: "Netflix, Disney, Spotify, Google",
        popularityScore: 90,
        sortOrder: 4,
        icon: "play_circle",
      },
      {
        name: "Engineering & CAD",
        description:
          "Autodesk AutoCAD, SolidWorks, Fusion 360, and engineering software",
        serviceProvider: "Autodesk, Dassault Systèmes",
        popularityScore: 85,
        sortOrder: 5,
        icon: "engineering",
      },
      {
        name: "Stock Media & Assets",
        description:
          "Freepik Premium, Shutterstock, Getty Images, and stock resources",
        serviceProvider: "Freepik, Shutterstock, Getty Images",
        popularityScore: 88,
        sortOrder: 6,
        icon: "image",
      },
      {
        name: "Productivity & Office",
        description:
          "Microsoft Office 365, Google Workspace, Notion, and productivity tools",
        serviceProvider: "Microsoft, Google, Notion",
        popularityScore: 87,
        sortOrder: 7,
        icon: "work",
      },
      {
        name: "Cloud Storage & Backup",
        description:
          "Google Drive, Dropbox, OneDrive, and cloud storage solutions",
        serviceProvider: "Google, Dropbox, Microsoft",
        popularityScore: 82,
        sortOrder: 8,
        icon: "cloud",
      },
      {
        name: "Security & Privacy",
        description: "VPN services, password managers, and security software",
        serviceProvider: "NordVPN, ExpressVPN, 1Password",
        popularityScore: 80,
        sortOrder: 9,
        icon: "security",
      },
      {
        name: "Gaming & Entertainment",
        description:
          "Steam, Epic Games, Xbox Game Pass, and gaming subscriptions",
        serviceProvider: "Valve, Epic Games, Microsoft",
        popularityScore: 85,
        sortOrder: 10,
        icon: "sports_esports",
      },
      {
        name: "Learning & Education",
        description: "Coursera, Udemy, MasterClass, and educational platforms",
        serviceProvider: "Coursera, Udemy, MasterClass",
        popularityScore: 78,
        sortOrder: 11,
        icon: "school",
      },
      {
        name: "Development Tools",
        description:
          "GitHub Pro, JetBrains, Visual Studio, and developer tools",
        serviceProvider: "GitHub, JetBrains, Microsoft",
        popularityScore: 83,
        sortOrder: 12,
        icon: "code",
      },
    ];

    const results = {
      created: [],
      updated: [],
      skipped: [],
    };

    for (const categoryData of newCategories) {
      try {
        // Check if category exists by name
        const existingCategory = await Category.findOne({
          name: categoryData.name,
        });

        if (existingCategory) {
          // Update existing category
          const updatedCategory = await Category.findByIdAndUpdate(
            existingCategory._id,
            categoryData,
            { new: true, runValidators: true }
          );
          results.updated.push(updatedCategory.name);
        } else {
          // Create new category
          const category = new Category(categoryData);
          const savedCategory = await category.save();
          results.created.push(savedCategory.name);
        }
      } catch (error) {
        if (error.code === 11000) {
          results.skipped.push(categoryData.name);
        } else {
          throw error;
        }
      }
    }

    res.json({
      success: true,
      message: "Categories initialized successfully",
      data: results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error initializing categories",
      error: error.message,
    });
  }
});

// ===== ORDER MANAGEMENT =====

// @desc    Get all orders (Admin)
// @route   GET /api/admin/orders
// @access  Private (Admin)
router.get("/orders", protect, async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;

    let query = {};

    if (status && status !== "all") {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: "i" } },
        { "customer.firstName": { $regex: search, $options: "i" } },
        { "customer.lastName": { $regex: search, $options: "i" } },
        { "customer.email": { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const orders = await Order.find(query)
      .populate("items.product", "title")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching orders",
      error: error.message,
    });
  }
});

// @desc    Get single order details
// @route   GET /api/admin/orders/:id
// @access  Private (Admin)
router.get("/orders/:id", protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("items.product", "title price autoDelivery")
      .populate({
        path: "deliveredInventory",
        populate: {
          path: "product",
          select: "title",
        },
      });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching order details",
      error: error.message,
    });
  }
});

// @desc    Confirm payment for order with receipt verification
// @route   PUT /api/admin/orders/:id/confirm-payment
// @access  Private (Admin)
router.put("/orders/:id/confirm-payment", protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.paymentMethod !== "bank_deposit") {
      return res.status(400).json({
        success: false,
        message: "This order does not use bank deposit",
      });
    }

    if (!order.receipt) {
      return res.status(400).json({
        success: false,
        message: "No receipt found for this order",
      });
    }

    // Verify receipt exists and update order
    try {
      const receiptPath = path.join(__dirname, "..", order.receipt);

      // Check if receipt file exists
      if (!fs.existsSync(receiptPath)) {
        return res.status(400).json({
          success: false,
          message: "Receipt file not found on server",
        });
      }

      // Update order with payment confirmation
      order.paymentConfirmed = true;
      order.paymentStatus = "confirmed"; // This will trigger deliveryId generation in pre-save
      order.paymentInfo.paidAt = new Date();
      order.paymentInfo.method = "manual";
      order.receiptVerification = {
        verifiedBy: req.user.id,
        verifiedAt: new Date(),
        adminName: `${req.user.firstName} ${req.user.lastName}`,
        status: "approved",
      };

      await order.save();

      console.log(`Payment confirmed for order ${order.orderNumber}`);

      // Send payment confirmation email to customer
      try {
        await CustomerNotificationService.sendPaymentConfirmationEmail(order);
        console.log(
          `Payment confirmation email sent for order ${order.orderNumber}`
        );
      } catch (emailError) {
        console.error("Failed to send payment confirmation email:", emailError);
        // Don't fail the payment confirmation if email fails
      }

      // Trigger auto-delivery if applicable
      try {
        const deliveryResult = await AutoDeliveryService.processAutoDelivery(
          order._id
        );
        console.log("Auto-delivery processed:", deliveryResult);

        // Send order status update notification to customer
        if (deliveryResult.success) {
          try {
            await CustomerNotificationService.sendOrderStatusUpdateEmail(
              order,
              {
                status: "processing",
                message:
                  "Your payment has been confirmed and your order is now being processed by our auto-delivery system.",
              }
            );
          } catch (emailError) {
            console.error(
              "Failed to send processing status email:",
              emailError
            );
          }
        }
      } catch (deliveryError) {
        console.error("Auto-delivery failed:", deliveryError);
        // Keep order in confirmed status if delivery fails
      }

      res.json({
        success: true,
        message: "Payment confirmed and receipt verified successfully",
        data: order,
      });
    } catch (verificationError) {
      console.error("Receipt verification error:", verificationError);
      return res.status(500).json({
        success: false,
        message: "Failed to verify receipt",
        error: verificationError.message,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error confirming payment",
      error: error.message,
    });
  }
});

// @desc    Decline payment receipt
// @route   PUT /api/admin/orders/:id/decline-payment
// @access  Private (Admin)
router.put("/orders/:id/decline-payment", protect, async (req, res) => {
  try {
    const { declineReason } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.paymentMethod !== "bank_deposit") {
      return res.status(400).json({
        success: false,
        message: "This order does not use bank deposit",
      });
    }

    if (!order.receipt) {
      return res.status(400).json({
        success: false,
        message: "No receipt found for this order",
      });
    }

    if (!declineReason || declineReason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Decline reason is required",
      });
    }

    // Update order with payment decline
    order.paymentStatus = "declined";
    order.paymentConfirmed = false;
    order.receiptVerification = {
      verifiedBy: req.user.id,
      verifiedAt: new Date(),
      adminName: `${req.user.firstName} ${req.user.lastName}`,
      status: "declined",
      declinedAt: new Date(),
      declineReason: declineReason.trim(),
    };

    await order.save();

    console.log(`Payment declined for order ${order.orderNumber}`);

    // Send payment decline notification to customer
    try {
      await CustomerNotificationService.sendPaymentDeclineEmail(
        order,
        declineReason
      );
      console.log(`Payment decline email sent for order ${order.orderNumber}`);
    } catch (emailError) {
      console.error("Failed to send payment decline email:", emailError);
      // Don't fail the decline process if email fails
    }

    res.json({
      success: true,
      message: "Payment declined successfully",
      data: order,
    });
  } catch (error) {
    console.error("Error declining payment:", error);
    res.status(500).json({
      success: false,
      message: "Error declining payment",
      error: error.message,
    });
  }
});

// @desc    Get available inventory for order delivery
// @route   GET /api/admin/orders/:id/available-inventory
// @access  Private (Admin)
router.get("/orders/:id/available-inventory", protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate("items.product");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Get all unique products from the order
    const productIds = [
      ...new Set(order.items.map((item) => item.product._id.toString())),
    ];

    // Get available inventory for these products using assignment-based logic
    const availableInventory = await Inventory.aggregate([
      {
        $match: {
          product: {
            $in: productIds.map((id) => new mongoose.Types.ObjectId(id)),
          },
          status: "available",
        },
      },
      {
        $lookup: {
          from: "inventoryassignments",
          localField: "_id",
          foreignField: "inventory",
          as: "assignments",
        },
      },
      {
        $addFields: {
          activeAssignments: {
            $size: {
              $filter: {
                input: "$assignments",
                cond: { $eq: ["$$this.status", "active"] },
              },
            },
          },
        },
      },
      {
        $match: {
          $expr: {
            $lt: ["$activeAssignments", { $ifNull: ["$maxAssignments", 1] }],
          },
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "product",
        },
      },
      {
        $unwind: "$product",
      },
      {
        $project: {
          _id: 1,
          accountCredentials: 1,
          notes: 1,
          createdAt: 1,
          maxAssignments: 1,
          activeAssignments: 1,
          "product._id": 1,
          "product.title": 1,
          "product.price": 1,
          "product.images": 1,
        },
      },
    ]);

    // Group inventory by product
    const inventoryByProduct = {};
    availableInventory.forEach((item) => {
      const productId = item.product._id.toString();
      if (!inventoryByProduct[productId]) {
        inventoryByProduct[productId] = {
          product: item.product,
          inventory: [],
        };
      }
      inventoryByProduct[productId].inventory.push({
        _id: item._id,
        accountCredentials: item.accountCredentials,
        notes: item.notes,
        createdAt: item.createdAt,
        maxAssignments: item.maxAssignments,
        activeAssignments: item.activeAssignments,
      });
    });

    res.json({
      success: true,
      data: {
        order: {
          _id: order._id,
          orderNumber: order.orderNumber,
          items: order.items,
        },
        inventoryByProduct,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching available inventory",
      error: error.message,
    });
  }
});

// @desc    Update order status with inventory assignment
// @route   PUT /api/admin/orders/:id/status
// @access  Private (Admin)
router.put("/orders/:id/status", protect, async (req, res) => {
  try {
    const { status, paymentStatus, inventoryAssignments } = req.body;

    const updateData = {};
    if (status) updateData.status = status;
    if (paymentStatus) updateData.paymentStatus = paymentStatus;

    // If status is being changed to 'delivered', handle inventory assignment
    if (status === "delivered") {
      updateData["deliveryInfo.deliveredAt"] = new Date();
      updateData["deliveryInfo.method"] = "manual";

      // If inventory assignments are provided, update inventory items
      if (inventoryAssignments && Array.isArray(inventoryAssignments)) {
        const inventoryIds = [];

        for (const assignment of inventoryAssignments) {
          const { inventoryId, orderItemIndex } = assignment;
          inventoryIds.push(inventoryId);

          // Update inventory item using assignment count system
          const inventory = await Inventory.findById(inventoryId);
          if (!inventory) {
            throw new Error(`Inventory item ${inventoryId} not found`);
          }

          // Increment assignment count
          const newAssignmentCount = (inventory.assignmentCount || 0) + 1;
          const updateFields = {
            assignmentCount: newAssignmentCount,
            deliveredAt: new Date(),
          };

          // Only mark as used and delivered if assignment count reaches max
          if (newAssignmentCount >= inventory.maxAssignments) {
            updateFields.isUsed = true;
            updateFields.status = "delivered";
          }

          updateFields.usedBy = req.params.id;

          await Inventory.findByIdAndUpdate(inventoryId, updateFields);

          // Create InventoryAssignment record
          const order = await Order.findById(req.params.id);
          await InventoryAssignment.create({
            inventory: inventoryId,
            order: req.params.id,
            orderNumber: order.orderNumber,
            customerEmail: order.customerInfo.email,
            customerName: order.customerInfo.name,
            assignedAt: new Date(),
            status: "delivered",
            notes: "Manual delivery by admin",
          });

          // Update order item with inventory reference
          if (orderItemIndex !== undefined) {
            updateData[`items.${orderItemIndex}.inventoryId`] = inventoryId;
            updateData[`items.${orderItemIndex}.delivered`] = true;
            updateData[`items.${orderItemIndex}.deliveredAt`] = new Date();
          }
        }

        // Add delivered inventory to order
        updateData.deliveredInventory = inventoryIds;
      }
    }

    if (status === "delivered" && req.body.manualDelivery) {
  const tempOrder = await Order.findById(req.params.id);
  if (!tempOrder) {
    return res.status(404).json({
      success: false,
      message: "Order not found",
    });
  }
  updateData.manualDelivery = req.body.manualDelivery;
  tempOrder.items.forEach((item, index) => {
    updateData[`items.${index}.deliveryStatus`] = "delivered";
    updateData[`items.${index}.delivered`] = true;
    updateData[`items.${index}.deliveredAt`] = new Date();
  });
}
const order = await Order.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("items.product", "title autoDelivery")
      .populate({
        path: "deliveredInventory",
        populate: {
          path: "product",
          select: "title",
        },
      });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Send delivery notification to customer if status changed to delivered
    if (status === "delivered") {
      try {
        // Get order with inventory details for notification
        const orderWithInventory = await Order.findById(order._id)
          .populate("items.product", "title")
          .lean();

        // Get inventory details for delivered items
        const deliveredInventory = [];
        if (inventoryAssignments) {
          for (const assignment of inventoryAssignments) {
            const inventory = await Inventory.findById(assignment.inventoryId)
              .populate("product", "title")
              .lean();
            if (inventory) {
              deliveredInventory.push(inventory);
            }
          }
        }

        // Send customer notification with delivery details
        await CustomerNotificationService.sendOrderDeliveryEmail(
          orderWithInventory,
          deliveredInventory
        );
      } catch (notificationError) {
        console.error(
          "Failed to send delivery notification:",
          notificationError
        );
        // Don't fail the status update if notification fails
      }
    }

    // Trigger auto-delivery if payment status changed to 'paid' (for non-manual deliveries)
    if (paymentStatus === "paid" && status !== "delivered") {
      try {
        const deliveryResult = await AutoDeliveryService.processAutoDelivery(
          order._id
        );
        console.log("Auto-delivery processed:", deliveryResult);
      } catch (deliveryError) {
        console.error("Auto-delivery failed:", deliveryError);
        // Don't fail the status update if auto-delivery fails
      }
    }

    res.json({
      success: true,
      message: "Order status updated successfully",
      data: order,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating order status",
      error: error.message,
    });
  }
});

// @desc    Terminate/Cancel an order
// @route   PUT /api/admin/orders/:id/terminate
// @access  Private (Admin)
router.put("/orders/:id/terminate", protect, async (req, res) => {
  try {
    const { reason } = req.body;

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Only allow termination of pending/unpaid orders
    if (order.paymentStatus !== "pending" || order.status === "delivered") {
      return res.status(400).json({
        success: false,
        message: "Cannot terminate paid or delivered orders",
      });
    }

    order.status = "cancelled";
    order.paymentStatus = "failed";
    order.paymentInfo.failedAt = new Date();
    order.paymentInfo.failureReason = reason || "Order terminated by admin";

    await order.save();

    res.json({
      success: true,
      message: "Order terminated successfully",
      data: order,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error terminating order",
      error: error.message,
    });
  }
});

// @desc    Get order timeout information
// @route   GET /api/admin/orders/:id/timeout
// @access  Private (Admin)
router.get("/orders/:id/timeout", protect, async (req, res) => {
  try {
    const timeRemaining = await PaymentTimeoutService.getTimeRemaining(
      req.params.id
    );

    if (!timeRemaining) {
      return res.status(404).json({
        success: false,
        message: "Order not found or no timeout set",
      });
    }

    res.json({
      success: true,
      data: timeRemaining,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error getting timeout information",
      error: error.message,
    });
  }
});

// @desc    Get unpaid orders
// @route   GET /api/admin/orders/unpaid
// @access  Private (Admin)
router.get("/orders/unpaid", protect, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const unpaidOrders = await Order.find({
      paymentStatus: "pending",
      status: { $ne: "cancelled" },
    })
      .populate("items.product", "title price")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Order.countDocuments({
      paymentStatus: "pending",
      status: { $ne: "cancelled" },
    });

    // Add timeout information for each order
    const ordersWithTimeout = await Promise.all(
      unpaidOrders.map(async (order) => {
        const orderObj = order.toObject();
        if (
          order.paymentMethod === "bank_deposit" &&
          order.paymentTimeout?.expiresAt
        ) {
          const timeRemaining = await PaymentTimeoutService.getTimeRemaining(
            order._id
          );
          orderObj.timeRemaining = timeRemaining;
        }
        return orderObj;
      })
    );

    res.json({
      success: true,
      data: ordersWithTimeout,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching unpaid orders",
      error: error.message,
    });
  }
});

// ===== INVENTORY MANAGEMENT =====

// @desc    Get inventory items
// @route   GET /api/admin/inventory
// @access  Private (Admin)
router.get("/inventory", protect, async (req, res) => {
  try {
    const { page = 1, limit = 10, product, status = "all" } = req.query;

    // Validate product ID format
    if (product && !mongoose.Types.ObjectId.isValid(product)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    let query = {};

    if (product) {
      query.product = product;
    }

    if (status !== "all") {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let inventory = await Inventory.aggregate([
      { $match: query },
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "product",
          pipeline: [
            { $match: { active: true } },
            { $project: { title: 1, price: 1 } },
          ],
        },
      },
      {
        $lookup: {
          from: "inventoryassignments",
          localField: "_id",
          foreignField: "inventory",
          as: "assignments",
          pipeline: [
            { $match: { status: "active" } },
            {
              $project: {
                customerEmail: 1,
                customerName: 1,
                assignedAt: 1,
                orderNumber: 1,
              },
            },
          ],
        },
      },
      {
        $addFields: {
          product: { $arrayElemAt: ["$product", 0] },
          assignmentCount: { $size: "$assignments" },
          assignments: "$assignments",
          maxAssignments: { $ifNull: ["$maxAssignments", 1] },
        },
      },
      { $match: { product: { $ne: null } } },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
    ]);

    // Get total count with the same filtering
    const totalResult = await Inventory.aggregate([
      { $match: query },
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "product",
          pipeline: [{ $match: { active: true } }],
        },
      },
      { $match: { product: { $ne: [] } } },
      { $count: "total" },
    ]);

    const total = totalResult.length > 0 ? totalResult[0].total : 0;

    // Get inventory stats
    const stats = await Inventory.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const statsObj = stats.reduce((acc, stat) => {
      acc[stat._id] = stat.count;
      return acc;
    }, {});

    res.json({
      success: true,
      data: inventory,
      stats: statsObj,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching inventory:", error);

    res.status(500).json({
      success: false,
      message: "Error fetching inventory",
      error: error.message,
    });
  }
});

// @desc    Add inventory item
// @route   POST /api/admin/inventory
// @access  Private (Admin)
router.post("/inventory", protect, async (req, res) => {
  try {
    const { product, accountCredentials, notes, maxAssignments } = req.body;

    if (!product || !accountCredentials) {
      return res.status(400).json({
        success: false,
        message: "Product and account credentials are required",
        errorCode: "MISSING_REQUIRED_FIELDS",
      });
    }

    // Validate maxAssignments if provided
    if (maxAssignments && (maxAssignments < 1 || maxAssignments > 100)) {
      return res.status(400).json({
        success: false,
        message: "Max assignments must be between 1 and 100",
        errorCode: "INVALID_MAX_ASSIGNMENTS",
      });
    }

    // Validate product existence with error handling
    const productExists = await Product.findById(product).catch(() => {
      return res.status(500).json({
        success: false,
        message: "Database error while verifying product",
        errorCode: "DB_VALIDATION_ERROR",
      });
    });

    if (!productExists) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
        errorCode: "INVALID_PRODUCT_ID",
      });
    }

    // Validate product ID exists
    const existingProduct = await Product.findById(product);
    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const inventory = new Inventory({
      product,
      accountCredentials,
      notes,
      maxAssignments: maxAssignments || 1, // Default to 1 if not provided
    });

    await inventory.save();
    await inventory.populate("product", "title price");

    res.status(201).json({
      success: true,
      message: "Inventory item added successfully",
      data: inventory,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error adding inventory item",
      error: error.message,
    });
  }
});

// @desc    Get expired inventory items
// @route   GET /api/admin/inventory/expired
// @access  Private (Admin)
router.get("/inventory/expired", protect, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const currentDate = new Date();
    const expiredInventory = await Inventory.find({
      expirationDate: { $lt: currentDate },
      status: { $ne: "expired" },
    })
      .populate("product", "title price")
      .sort({ expirationDate: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Inventory.countDocuments({
      expirationDate: { $lt: currentDate },
      status: { $ne: "expired" },
    });

    res.json({
      success: true,
      data: expiredInventory,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching expired inventory:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching expired inventory",
      error: error.message,
    });
  }
});

// @desc    Update inventory assignment settings
// @route   PUT /api/admin/inventory/:id/assignment-settings
// @access  Private (Admin)
router.put("/inventory/:id/assignment-settings", protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { maxAssignments } = req.body;

    if (!maxAssignments || maxAssignments < 1) {
      return res.status(400).json({
        success: false,
        message: "Maximum assignments must be at least 1",
      });
    }

    const inventory = await Inventory.findById(id);
    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: "Inventory item not found",
      });
    }

    inventory.maxAssignments = maxAssignments;
    await inventory.save();

    res.json({
      success: true,
      message: "Assignment settings updated successfully",
      data: inventory,
    });
  } catch (error) {
    console.error("Error updating assignment settings:", error);
    res.status(500).json({
      success: false,
      message: "Error updating assignment settings",
      error: error.message,
    });
  }
});

// @desc    Assign inventory item to order
// @route   POST /api/admin/inventory/:id/assign
// @access  Private (Admin)
router.post("/inventory/:id/assign", protect, async (req, res) => {
  try {
    const { orderId, notes } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    const inventory = await Inventory.findById(req.params.id);
    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: "Inventory item not found",
      });
    }

    // Check if inventory is available for assignment
    const currentAssignments = inventory.assignmentCount || 0;
    if (currentAssignments >= inventory.maxAssignments) {
      return res.status(400).json({
        success: false,
        message: "Inventory item has reached maximum assignments",
      });
    }

    // Increment assignment count
    const newAssignmentCount = currentAssignments + 1;
    const updateFields = {
      assignmentCount: newAssignmentCount,
      deliveredAt: new Date(),
      usedBy: orderId,
    };

    // Add notes if provided
    if (notes) {
      updateFields.notes = notes;
    }

    // Only mark as used and delivered if assignment count reaches max
    if (newAssignmentCount >= inventory.maxAssignments) {
      updateFields.isUsed = true;
      updateFields.status = "delivered";
    }

    const updatedInventory = await Inventory.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true, runValidators: true }
    ).populate("product", "title");

    // Create InventoryAssignment record
    const order = await Order.findById(orderId);
    if (order) {
      await InventoryAssignment.create({
        inventory: req.params.id,
        order: orderId,
        orderNumber: order.orderNumber,
        customerEmail: order.customerInfo.email,
        customerName: order.customerInfo.name,
        assignedAt: new Date(),
        status: "assigned",
        notes: notes || "Manual assignment by admin",
      });
    }

    res.json({
      success: true,
      message: "Inventory item assigned successfully",
      data: updatedInventory,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error assigning inventory item",
      error: error.message,
    });
  }
});

// @desc    Get inventory assignment history
// @route   GET /api/admin/inventory/:id/assignments
// @access  Private (Admin)
router.get("/inventory/:id/assignments", protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const assignments = await InventoryAssignment.find({ inventory: id })
      .populate("order", "orderNumber")
      .sort({ assignedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await InventoryAssignment.countDocuments({ inventory: id });

    res.json({
      success: true,
      data: assignments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching assignment history:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching assignment history",
      error: error.message,
    });
  }
});

// @desc    Bulk update inventory expiration settings
// @route   PUT /api/admin/inventory/bulk-expiration
// @access  Private (Admin)
router.put("/inventory/bulk-expiration", protect, async (req, res) => {
  try {
    const { inventoryIds, expirationDate, allowUpdatesAfterExpiry } = req.body;

    if (
      !inventoryIds ||
      !Array.isArray(inventoryIds) ||
      inventoryIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid inventory IDs",
      });
    }

    const updateData = {};
    if (expirationDate !== undefined)
      updateData.expirationDate = expirationDate;
    if (allowUpdatesAfterExpiry !== undefined)
      updateData.allowUpdatesAfterExpiry = allowUpdatesAfterExpiry;

    const result = await Inventory.updateMany(
      { _id: { $in: inventoryIds } },
      updateData
    );

    res.json({
      success: true,
      message: `Updated ${result.modifiedCount} inventory items`,
      data: {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      },
    });
  } catch (error) {
    console.error("Error bulk updating inventory expiration:", error);
    res.status(500).json({
      success: false,
      message: "Error updating inventory expiration settings",
      error: error.message,
    });
  }
});

// @desc    Set expiration date based on delivery date and duration
// @route   PUT /api/admin/inventory/:id/set-expiration
// @access  Private (Admin)
router.put("/inventory/:id/set-expiration", protect, async (req, res) => {
  try {
    const { durationDays, allowUpdatesAfterExpiry = false } = req.body;

    const inventory = await Inventory.findById(req.params.id);
    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: "Inventory item not found",
      });
    }

    // Use delivery date or current date as base
    const baseDate =
      inventory.deliveredAt || inventory.originalDeliveryDate || new Date();
    const expirationDate = new Date(baseDate);
    expirationDate.setDate(expirationDate.getDate() + parseInt(durationDays));

    const updatedInventory = await Inventory.findByIdAndUpdate(
      req.params.id,
      {
        expirationDate,
        allowUpdatesAfterExpiry,
        originalDeliveryDate:
          inventory.originalDeliveryDate || inventory.deliveredAt || new Date(),
      },
      { new: true, runValidators: true }
    ).populate("product", "title price");

    res.json({
      success: true,
      message: "Expiration date set successfully",
      data: updatedInventory,
    });
  } catch (error) {
    console.error("Error setting expiration date:", error);
    res.status(500).json({
      success: false,
      message: "Error setting expiration date",
      error: error.message,
    });
  }
});

// @desc    Update inventory item
// @route   PUT /api/admin/inventory/:id
// @access  Private (Admin)
router.put("/inventory/:id", protect, async (req, res) => {
  try {
    const {
      accountCredentials,
      notes,
      status,
      expirationDate,
      allowUpdatesAfterExpiry,
      maxAssignments,
    } = req.body;

    // First, get the current inventory item to check expiration status
    const currentInventory = await Inventory.findById(req.params.id);
    if (!currentInventory) {
      return res.status(404).json({
        success: false,
        message: "Inventory item not found",
      });
    }

    // Check if the item is expired and updates are not allowed
    const isExpired =
      currentInventory.expirationDate &&
      new Date() > currentInventory.expirationDate;
    if (
      isExpired &&
      !currentInventory.allowUpdatesAfterExpiry &&
      accountCredentials
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Cannot update credentials for expired inventory item. Updates are disabled for this expired product.",
        data: {
          isExpired: true,
          expirationDate: currentInventory.expirationDate,
          allowUpdatesAfterExpiry: currentInventory.allowUpdatesAfterExpiry,
        },
      });
    }

    // Validate maxAssignments if provided
    if (maxAssignments !== undefined) {
      if (maxAssignments < 1 || maxAssignments > 100) {
        return res.status(400).json({
          success: false,
          message: "Maximum assignments must be between 1 and 100",
        });
      }
    }

    const updateData = {};
    if (accountCredentials) updateData.accountCredentials = accountCredentials;
    if (notes !== undefined) updateData.notes = notes;
    if (status) updateData.status = status;
    if (expirationDate !== undefined)
      updateData.expirationDate = expirationDate;
    if (allowUpdatesAfterExpiry !== undefined)
      updateData.allowUpdatesAfterExpiry = allowUpdatesAfterExpiry;
    if (maxAssignments !== undefined)
      updateData.maxAssignments = maxAssignments;

    const inventory = await Inventory.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate("product", "title price");

    res.json({
      success: true,
      message: "Inventory item updated successfully",
      data: inventory,
    });
  } catch (error) {
    console.error("Error updating inventory item:", error);
    res.status(500).json({
      success: false,
      message: "Error updating inventory item",
      error: error.message,
    });
  }
});

// @desc    Delete inventory item
// @route   DELETE /api/admin/inventory/:id
// @access  Private (Admin)
router.delete("/inventory/:id", protect, async (req, res) => {
  try {
    const inventory = await Inventory.findByIdAndDelete(req.params.id);

    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: "Inventory item not found",
      });
    }

    res.json({
      success: true,
      message: "Inventory item deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting inventory item",
      error: error.message,
    });
  }
});

// @desc    Get products with auto-delivery settings
// @route   GET /api/admin/auto-delivery
// @access  Private (Admin)
router.get("/auto-delivery", protect, async (req, res) => {
  try {
    const products = await Product.find({ active: true })
      .select("title autoDelivery")
      .sort({ title: 1 });

    res.json({
      success: true,
      data: products,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching auto-delivery settings",
      error: error.message,
    });
  }
});

// @desc    Update product auto-delivery setting
// @route   PUT /api/admin/auto-delivery/:id
// @access  Private (Admin)
router.put("/auto-delivery/:id", protect, async (req, res) => {
  try {
    const { autoDelivery } = req.body;

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { autoDelivery: autoDelivery === true },
      { new: true, runValidators: true }
    ).select("title autoDelivery");

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({
      success: true,
      message: "Auto-delivery setting updated successfully",
      data: product,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating auto-delivery setting",
      error: error.message,
    });
  }
});

// @desc    Process pending auto-deliveries
// @route   POST /api/admin/process-deliveries
// @access  Private (Admin)
router.post("/process-deliveries", protect, async (req, res) => {
  try {
    const results = await AutoDeliveryService.checkPendingDeliveries();

    res.json({
      success: true,
      message: "Pending deliveries processed successfully",
      data: results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error processing pending deliveries",
      error: error.message,
    });
  }
});

// @desc    Get delivery status for order
// @route   GET /api/admin/orders/:id/delivery-status
// @access  Private (Admin)
router.get("/orders/:id/delivery-status", protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("items.product", "title autoDelivery")
      .select("orderNumber items paymentStatus status");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const deliveryStatus = order.items.map((item) => ({
      productId: item.product._id,
      productTitle: item.product.title,
      autoDelivery: item.product.autoDelivery || item.autoDelivery,
      delivered: item.delivered,
      deliveryStatus:
        item.deliveryStatus || (item.delivered ? "delivered" : "pending"),
      deliveredAt: item.deliveredAt,
      hasCredentials: !!item.accountCredentials || !!item.credentials,
      credentials: item.credentials,
    }));

    res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        paymentStatus: order.paymentStatus,
        status: order.status,
        items: deliveryStatus,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching delivery status",
      error: error.message,
    });
  }
});

// ===== DELIVERY MANAGEMENT =====

// @desc    Get delivery statistics
// @route   GET /api/admin/delivery-stats
// @access  Private (Admin)
router.get("/delivery-stats", protect, async (req, res) => {
  try {
    const stats = await AutoDeliveryService.getDeliveryStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching delivery statistics",
      error: error.message,
    });
  }
});

// @desc    Manually trigger auto-delivery for specific order
// @route   POST /api/admin/orders/:id/trigger-delivery
// @access  Private (Admin)
router.post("/orders/:id/trigger-delivery", protect, async (req, res) => {
  try {
    const result = await AutoDeliveryService.processAutoDelivery(req.params.id);

    res.json({
      success: true,
      message: "Auto-delivery triggered successfully",
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error triggering auto-delivery",
      error: error.message,
    });
  }
});

// @desc    Assign credentials to order item
// @route   PUT /api/admin/orders/:id/assign-credentials
// @access  Private (Admin)
router.put("/orders/:id/assign-credentials", protect, async (req, res) => {
  try {
    const { itemId, credentialsId } = req.body;

    if (!itemId || !credentialsId) {
      return res.status(400).json({
        success: false,
        message: "Item ID and credentials ID are required",
      });
    }

    // Find the order
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Find the inventory item
    const inventory = await Inventory.findById(credentialsId);
    if (!inventory || !inventory.isAvailable) {
      return res.status(400).json({
        success: false,
        message: "Credentials not available",
      });
    }

    // Find the order item
    const orderItem = order.items.id(itemId);
    if (!orderItem) {
      return res.status(404).json({
        success: false,
        message: "Order item not found",
      });
    }

    // Assign credentials to order item
    orderItem.accountCredentials = inventory.accountCredentials;
    orderItem.delivered = true;
    orderItem.deliveredAt = new Date();

    // Update inventory using assignment count system
    const newAssignmentCount = (inventory.assignmentCount || 0) + 1;
    inventory.assignmentCount = newAssignmentCount;
    inventory.usedBy = order.customer.email;
    inventory.deliveredAt = new Date();

    // Only mark as used and delivered if assignment count reaches max
    if (newAssignmentCount >= inventory.maxAssignments) {
      inventory.isUsed = true;
      inventory.status = "delivered";
    }

    await Promise.all([order.save(), inventory.save()]);

    res.json({
      success: true,
      message: "Credentials assigned successfully",
      data: order,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error assigning credentials",
      error: error.message,
    });
  }
});

// @desc    Toggle auto-delivery for an order
// @route   PUT /api/admin/orders/:id/auto-delivery
// @access  Private (Admin)
router.put("/orders/:id/auto-delivery", protect, async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "'enabled' field is required and must be a boolean",
      });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Don't allow changing auto-delivery for already delivered orders
    if (order.status === "delivered") {
      return res.status(400).json({
        success: false,
        message: "Cannot change auto-delivery settings for delivered orders",
      });
    }

    const previousState = order.autoDeliveryEnabled;
    order.autoDeliveryEnabled = enabled;
    await order.save();

    // If auto-delivery was just enabled and payment is confirmed, trigger auto-delivery
    if (
      enabled &&
      !previousState &&
      (order.paymentStatus === "confirmed" || order.paymentStatus === "paid") &&
      order.status !== "delivered"
    ) {
      try {
        const deliveryResult = await AutoDeliveryService.processAutoDelivery(
          order._id
        );
        console.log("Auto-delivery triggered after enabling:", deliveryResult);
      } catch (deliveryError) {
        console.error("Auto-delivery failed after enabling:", deliveryError);
        // Don't fail the setting update if auto-delivery fails
      }
    }

    res.json({
      success: true,
      message: `Auto-delivery ${enabled ? "enabled" : "disabled"} for order ${
        order.orderNumber
      }`,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        autoDeliveryEnabled: order.autoDeliveryEnabled,
        previousState,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating auto-delivery settings",
      error: error.message,
    });
  }
});

// @desc    Get auto-delivery status for an order
// @route   GET /api/admin/orders/:id/auto-delivery
// @access  Private (Admin)
router.get("/orders/:id/auto-delivery", protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("items.product", "title autoDelivery")
      .select("orderNumber autoDeliveryEnabled status paymentStatus items");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Check which items have auto-delivery enabled at product level
    const autoDeliveryItems = order.items.filter(
      (item) => item.product?.autoDelivery
    );
    const manualDeliveryItems = order.items.filter(
      (item) => !item.product?.autoDelivery
    );

    res.json({
      success: true,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        autoDeliveryEnabled: order.autoDeliveryEnabled,
        status: order.status,
        paymentStatus: order.paymentStatus,
        canChangeAutoDelivery: order.status !== "delivered",
        itemsBreakdown: {
          autoDeliveryItems: autoDeliveryItems.length,
          manualDeliveryItems: manualDeliveryItems.length,
          total: order.items.length,
        },
        items: order.items.map((item) => ({
          _id: item._id,
          productTitle: item.product?.title || item.title,
          productAutoDelivery: item.product?.autoDelivery || false,
          deliveryStatus: item.deliveryStatus,
          delivered: item.delivered,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error getting auto-delivery status",
      error: error.message,
    });
  }
});

// @desc    Manual delivery for order
// @route   POST /api/admin/orders/:id/manual-delivery
// @access  Private (Admin)
router.post("/orders/:id/manual-delivery", protect, async (req, res) => {
  try {
    const { credentials, notes } = req.body;

    if (!credentials || Object.keys(credentials).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Credentials are required",
      });
    }

    // Find the order
    const order = await Order.findById(req.params.id).populate(
      "items.product",
      "title"
    );
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Process each credential assignment
    for (const [itemId, credentialsId] of Object.entries(credentials)) {
      const orderItem = order.items.id(itemId);
      const inventory = await Inventory.findById(credentialsId);

      if (orderItem && inventory && inventory.isAvailable) {
        orderItem.accountCredentials = inventory.accountCredentials;
        orderItem.delivered = true;
        orderItem.deliveredAt = new Date();

        // Update inventory using assignment count system
        const newAssignmentCount = (inventory.assignmentCount || 0) + 1;
        inventory.assignmentCount = newAssignmentCount;
        inventory.usedBy = order.customer.email;
        inventory.deliveredAt = new Date();
        if (notes) inventory.notes = notes;

        // Only mark as used and delivered if assignment count reaches max
        if (newAssignmentCount >= inventory.maxAssignments) {
          inventory.isUsed = true;
          inventory.status = "delivered";
        }

        await inventory.save();
      }
    }

    // Update order status
    const allItemsDelivered = order.items.every((item) => item.delivered);
    if (allItemsDelivered) {
      order.status = "delivered";
      order.deliveryInfo = {
        deliveredAt: new Date(),
        notes: notes || "Manual delivery completed",
      };
    }

    await order.save();

    // Send delivery email
    try {
      const emailService = require("../services/emailService");
      await emailService.sendDeliveryEmail(order);
    } catch (emailError) {
      console.error("Failed to send delivery email:", emailError);
    }

    res.json({
      success: true,
      message: "Manual delivery completed successfully",
      data: order,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error completing manual delivery",
      error: error.message,
    });
  }
});

// @desc    Get pending deliveries
// @route   GET /api/admin/pending-deliveries
// @access  Private (Admin)
router.get("/pending-deliveries", protect, async (req, res) => {
  try {
    // Find orders with paid status that have undelivered auto-delivery items
    const orders = await Order.find({
      paymentStatus: "paid",
      $or: [
        { "items.delivered": false },
        { "items.deliveryStatus": "pending" },
      ],
    })
      .populate("items.product", "title autoDelivery")
      .select("orderNumber customer items paymentStatus status createdAt")
      .sort({ createdAt: -1 });

    const pendingOrders = orders.filter((order) =>
      order.items.some(
        (item) =>
          item.product?.autoDelivery &&
          (item.deliveryStatus === "pending" || !item.delivered)
      )
    );

    const pendingItems = [];
    pendingOrders.forEach((order) => {
      order.items.forEach((item) => {
        if (
          item.product?.autoDelivery &&
          (item.deliveryStatus === "pending" || !item.delivered)
        ) {
          pendingItems.push({
            orderId: order._id,
            orderNumber: order.orderNumber,
            customerEmail: order.customer.email,
            productId: item.product._id,
            productTitle: item.product.title,
            quantity: item.quantity,
            deliveryStatus: item.deliveryStatus || "pending",
            orderDate: order.createdAt,
          });
        }
      });
    });

    res.json({
      success: true,
      data: {
        pendingOrders: pendingOrders.length,
        pendingItems: pendingItems.length,
        orders: pendingOrders,
        items: pendingItems,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching pending deliveries",
      error: error.message,
    });
  }
});

// ===== DELIVERY LOGS MANAGEMENT =====

// @desc    Get delivery logs
// @route   GET /api/admin/delivery-logs
// @access  Private (Admin)
router.get("/delivery-logs", protect, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      eventType,
      status,
      orderId,
      customerEmail,
      productId,
      startDate,
      endDate,
      isResolved,
    } = req.query;

    const filters = {};
    if (eventType) filters.eventType = eventType;
    if (status) filters.status = status;
    if (orderId) filters.orderId = orderId;
    if (customerEmail) filters.customerEmail = customerEmail;
    if (productId) filters.productId = productId;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (isResolved !== undefined) filters.isResolved = isResolved === "true";

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
    };

    const result = await DeliveryLog.getDeliveryLogs(filters, options);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching delivery logs",
      error: error.message,
    });
  }
});

// @desc    Get delivery log statistics
// @route   GET /api/admin/delivery-logs/stats
// @access  Private (Admin)
router.get("/delivery-logs/stats", protect, async (req, res) => {
  try {
    const { timeframe = "24h" } = req.query;
    const stats = await DeliveryLog.getDeliveryStats(timeframe);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching delivery log statistics",
      error: error.message,
    });
  }
});

// @desc    Mark delivery log error as resolved
// @route   PUT /api/admin/delivery-logs/:id/resolve
// @access  Private (Admin)
router.put("/delivery-logs/:id/resolve", protect, async (req, res) => {
  try {
    const { resolvedBy } = req.body;

    const log = await DeliveryLog.markErrorResolved(
      req.params.id,
      resolvedBy || "admin"
    );

    if (!log) {
      return res.status(404).json({
        success: false,
        message: "Delivery log not found",
      });
    }

    res.json({
      success: true,
      message: "Error marked as resolved",
      data: log,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error resolving delivery log",
      error: error.message,
    });
  }
});

// @desc    Manually trigger retry for failed deliveries
// @route   POST /api/admin/retry-failed-deliveries
// @access  Private (Admin)
router.post("/retry-failed-deliveries", protect, async (req, res) => {
  try {
    const result = await AutoDeliveryService.retryFailedDeliveries();
    res.json(result);
  } catch (error) {
    console.error("Error triggering retry for failed deliveries:", error);
    res.status(500).json({
      success: false,
      message: "Failed to trigger retry for failed deliveries",
      error: error.message,
    });
  }
});

// @desc    Get retry statistics
// @route   GET /api/admin/delivery-retry-stats
// @access  Private (Admin)
router.get("/delivery-retry-stats", protect, async (req, res) => {
  try {
    const { timeframe = "24h" } = req.query;

    let startDate;
    switch (timeframe) {
      case "1h":
        startDate = new Date(Date.now() - 60 * 60 * 1000);
        break;
      case "24h":
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case "7d":
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }

    const stats = await DeliveryLog.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: null,
          totalFailures: {
            $sum: {
              $cond: [{ $eq: ["$status", "error"] }, 1, 0],
            },
          },
          totalRetries: {
            $sum: {
              $cond: [{ $eq: ["$eventType", "delivery_retry"] }, 1, 0],
            },
          },
          successfulRetries: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$eventType", "delivery_retry"] },
                    { $eq: ["$status", "success"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          unresolvedFailures: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "error"] },
                    { $eq: ["$isResolved", false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          maxRetryCount: { $max: "$retryCount" },
          avgRetryCount: { $avg: "$retryCount" },
        },
      },
    ]);

    const result = stats[0] || {
      totalFailures: 0,
      totalRetries: 0,
      successfulRetries: 0,
      unresolvedFailures: 0,
      maxRetryCount: 0,
      avgRetryCount: 0,
    };

    // Calculate retry success rate
    result.retrySuccessRate =
      result.totalRetries > 0
        ? ((result.successfulRetries / result.totalRetries) * 100).toFixed(2)
        : 0;

    res.json({
      success: true,
      timeframe,
      data: result,
    });
  } catch (error) {
    console.error("Error getting retry statistics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get retry statistics",
      error: error.message,
    });
  }
});

// @desc    Manually trigger notification checks
// @route   POST /api/admin/check-notifications
// @access  Private (Admin)
router.post("/check-notifications", protect, async (req, res) => {
  try {
    await NotificationService.checkAndSendAlerts();
    res.json({
      success: true,
      message: "Notification check completed",
    });
  } catch (error) {
    console.error("Error checking notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check notifications",
      error: error.message,
    });
  }
});



// @desc    Check inventory levels and send alerts
// @route   POST /api/admin/check-inventory-levels
// @access  Private (Admin)
router.post("/check-inventory-levels", protect, async (req, res) => {
  try {
    const result = await AutoDeliveryService.checkInventoryLevels();
    res.json(result);
  } catch (error) {
    console.error("Error checking inventory levels:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check inventory levels",
      error: error.message,
    });
  }
});

// @desc    Get low stock products
// @route   GET /api/admin/low-stock-products
// @access  Private (Admin)
router.get("/low-stock-products", protect, async (req, res) => {
  try {
    const { threshold } = req.query;
    const lowStockThreshold =
      parseInt(threshold) || parseInt(process.env.LOW_STOCK_THRESHOLD) || 5;

    const lowStockProducts = await Inventory.aggregate([
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "productInfo",
        },
      },
      {
        $unwind: "$productInfo",
      },
      {
        $match: {
          "productInfo.autoDelivery": true,
        },
      },
      {
        $group: {
          _id: "$product",
          productTitle: { $first: "$productInfo.title" },
          availableCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "available"] }, 1, 0],
            },
          },
          totalCount: { $sum: 1 },
          reservedCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "reserved"] }, 1, 0],
            },
          },
          deliveredCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "delivered"] }, 1, 0],
            },
          },
        },
      },
      {
        $match: {
          availableCount: { $lte: lowStockThreshold },
        },
      },
      {
        $sort: {
          availableCount: 1,
        },
      },
    ]);

    res.json({
      success: true,
      threshold: lowStockThreshold,
      products: lowStockProducts,
    });
  } catch (error) {
    console.error("Error getting low stock products:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get low stock products",
      error: error.message,
    });
  }
});

// ===== SETTINGS MANAGEMENT =====

// @desc    Get settings
// @route   GET /api/admin/settings
// @access  Private (Admin)
router.get("/settings", protect, async (req, res) => {
  try {
    const settings = await Settings.getSettings();

    res.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching settings",
      error: error.message,
    });
  }
});

// @desc    Update settings
// @route   PUT /api/admin/settings
// @access  Private (Admin)
router.put("/settings", protect, async (req, res) => {
  try {
    const {
      taxRate,
      taxEnabled,
      deliveryMessage,
      outlookEnabled,
      outlookClientId,
      outlookClientSecret,
      outlookTenantId,
      outlookRedirectUri,
    } = req.body;

    const updateData = {};
    if (taxRate !== undefined) updateData.taxRate = taxRate;
    if (taxEnabled !== undefined) updateData.taxEnabled = taxEnabled;
    if (deliveryMessage !== undefined)
      updateData.deliveryMessage = deliveryMessage;
    if (outlookEnabled !== undefined)
      updateData.outlookEnabled = outlookEnabled;
    if (outlookClientId !== undefined)
      updateData.outlookClientId = outlookClientId;
    if (outlookClientSecret !== undefined)
      updateData.outlookClientSecret = outlookClientSecret;
    if (outlookTenantId !== undefined)
      updateData.outlookTenantId = outlookTenantId;
    if (outlookRedirectUri !== undefined)
      updateData.outlookRedirectUri = outlookRedirectUri;

    const settings = await Settings.updateSettings(updateData);

    res.json({
      success: true,
      message: "Settings updated successfully",
      data: settings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating settings",
      error: error.message,
    });
  }
});

// ===== DATABASE RESET MANAGEMENT =====

// @desc    Get database reset options and statistics
// @route   GET /api/admin/database/reset-info
// @access  Private (Super Admin only)
router.get(
  "/database/reset-info",
  protect,
  authorize("super_admin"),
  async (req, res) => {
    try {
      const stats = await Promise.all([
        Product.countDocuments(),
        Category.countDocuments(),
        Order.countDocuments(),
        Inventory.countDocuments(),
        InventoryAssignment.countDocuments(),
        DeliveryLog.countDocuments(),
        AdminUser.countDocuments({ role: { $ne: "super_admin" } }),
      ]);

      const resetOptions = {
        products: {
          name: "Products",
          description: "Remove all products and their associated data",
          count: stats[0],
          warning: "This will also remove associated inventory and assignments",
        },
        categories: {
          name: "Categories",
          description: "Remove all categories (products will be unassigned)",
          count: stats[1],
          warning: "Products will lose their category assignments",
        },
        orders: {
          name: "Orders",
          description: "Remove all customer orders and order history",
          count: stats[2],
          warning:
            "This action cannot be undone and will affect revenue tracking",
        },
        inventory: {
          name: "Inventory",
          description: "Remove all inventory items and credentials",
          count: stats[3],
          warning: "This will remove all stored account credentials",
        },
        assignments: {
          name: "Inventory Assignments",
          description: "Remove all inventory assignment records",
          count: stats[4],
          warning: "This will clear the assignment history",
        },
        deliveryLogs: {
          name: "Delivery Logs",
          description: "Remove all delivery and system logs",
          count: stats[5],
          warning: "This will remove all delivery tracking history",
        },
        adminUsers: {
          name: "Admin Users (excluding super admin)",
          description: "Remove all admin users except super admins",
          count: stats[6],
          warning: "This will remove all non-super admin accounts",
        },
        everything: {
          name: "Complete Database Reset",
          description: "Remove ALL data except super admin accounts",
          count: stats.reduce((a, b, i) => (i === 6 ? a + b : a + b), 0),
          warning: "⚠️ DANGER: This will completely wipe the database!",
        },
      };

      res.json({
        success: true,
        data: resetOptions,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching reset information",
        error: error.message,
      });
    }
  }
);

// @desc    Execute database reset with confirmation
// @route   POST /api/admin/database/reset
// @access  Private (Super Admin only)
router.post(
  "/database/reset",
  protect,
  authorize("super_admin"),
  async (req, res) => {
    try {
      const { resetType, confirmationCode, adminPassword } = req.body;

      // Validate required fields
      if (!resetType || !confirmationCode || !adminPassword) {
        return res.status(400).json({
          success: false,
          message:
            "Reset type, confirmation code, and admin password are required",
        });
      }

      // Validate admin password
      if (adminPassword !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({
          success: false,
          message: "Invalid admin password",
        });
      }

      const admin = {
        id: req.user.id,
        email: req.user.email || "admin@gmail.com",
      };

      // Verify confirmation code (should be "RESET_DATABASE_CONFIRM")
      if (confirmationCode !== "RESET_DATABASE_CONFIRM") {
        return res.status(400).json({
          success: false,
          message: "Invalid confirmation code",
        });
      }

      let deletedCounts = {};
      let operations = [];

      // Execute reset based on type
      switch (resetType) {
        case "products":
          operations = [
            { model: InventoryAssignment, name: "inventoryAssignments" },
            { model: Inventory, name: "inventory" },
            { model: Product, name: "products" },
          ];
          break;

        case "categories":
          // Unassign categories from products first
          await Product.updateMany({}, { $unset: { category: 1 } });
          operations = [{ model: Category, name: "categories" }];
          break;

        case "orders":
          operations = [{ model: Order, name: "orders" }];
          break;

        case "inventory":
          operations = [
            { model: InventoryAssignment, name: "inventoryAssignments" },
            { model: Inventory, name: "inventory" },
          ];
          break;

        case "assignments":
          operations = [
            { model: InventoryAssignment, name: "inventoryAssignments" },
          ];
          break;

        case "deliveryLogs":
          operations = [{ model: DeliveryLog, name: "deliveryLogs" }];
          break;

        case "adminUsers":
          operations = [
            {
              model: AdminUser,
              name: "adminUsers",
              filter: { role: { $ne: "super_admin" } },
            },
          ];
          break;

        case "everything":
          operations = [
            { model: InventoryAssignment, name: "inventoryAssignments" },
            { model: DeliveryLog, name: "deliveryLogs" },
            { model: Inventory, name: "inventory" },
            { model: Order, name: "orders" },
            { model: Product, name: "products" },
            { model: Category, name: "categories" },
            {
              model: AdminUser,
              name: "adminUsers",
              filter: { role: { $ne: "super_admin" } },
            },
          ];
          break;

        default:
          return res.status(400).json({
            success: false,
            message: "Invalid reset type",
          });
      }

      // Execute deletions
      for (const operation of operations) {
        const filter = operation.filter || {};
        const result = await operation.model.deleteMany(filter);
        deletedCounts[operation.name] = result.deletedCount;
      }

      // Log the reset action
      console.log(`🔥 DATABASE RESET EXECUTED by ${admin.email}:`, {
        resetType,
        deletedCounts,
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: true,
        message: `Database reset completed successfully`,
        data: {
          resetType,
          deletedCounts,
          executedBy: admin.email,
          executedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Database reset error:", error);
      res.status(500).json({
        success: false,
        message: "Error executing database reset",
        error: error.message,
      });
    }
  }
);



module.exports = router;
