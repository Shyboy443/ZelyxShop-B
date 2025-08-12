const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Product = require("../models/Product");
const Settings = require("../models/Settings");
const { validateOrder } = require("../middlewares/validation");

// @desc    Create new order
// @route   POST /api/orders
// @access  Public
router.post("/", validateOrder, async (req, res) => {
  console.log("Received order creation request:", req.body);
  try {
    const {
      customer,
      items,
      currency = "LKR",
      exchangeRate = 1,
      notes,
      paymentMethod = "credit_card",
    } = req.body;

    // Validate and calculate order totals
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      // Get product details
      const product = await Product.findById(item.product);

      if (!product) {
        return res.status(400).json({
          success: false,
          message: `Product with ID ${item.product} not found`,
        });
      }

      if (!product.active) {
        return res.status(400).json({
          success: false,
          message: `Product ${product.title} is not available`,
        });
      }

      if (product.availability < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.title}. Available: ${product.availability}, Requested: ${item.quantity}`,
        });
      }

      // For auto-delivery products, check inventory availability using assignment-based system
      if (product.autoDelivery) {
        const Inventory = require("../models/Inventory");

        // Use the same logic as AutoDeliveryService for accurate availability count
        const availableInventoryResult = await Inventory.aggregate([
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
            },
          },
          {
            $match: {
              $expr: {
                $lt: ["$activeAssignments", "$maxAssignments"],
              },
            },
          },
          {
            $count: "availableCount",
          },
        ]);

        const availableInventoryCount =
          availableInventoryResult[0]?.availableCount || 0;

        if (availableInventoryCount < item.quantity) {
          return res.status(400).json({
            success: false,
            message: `Insufficient inventory for auto-delivery product ${product.title}. Available inventory: ${availableInventoryCount}, Requested: ${item.quantity}`,
          });
        }
      }

      // Calculate price based on currency
      let itemPrice = product.price;
      if (currency === "USD") {
        itemPrice = product.price * exchangeRate;
      }

      const orderItem = {
        product: product._id,
        title: product.title,
        price: itemPrice,
        quantity: item.quantity,
        image: product.images[0] || "",
        serviceType: product.category?.name || "Service",
        duration: "Instant", // Default duration since Product model doesn't have this field
        features: product.features,
        accountCredentials: "", // Will be populated during delivery from Inventory
        autoDelivery: product.autoDelivery || false,
      };

      orderItems.push(orderItem);
      subtotal += itemPrice * item.quantity;
    }

    // Get settings for tax calculation
    const settings = await Settings.getSettings();

    // Calculate tax based on settings
    const tax = settings.taxEnabled ? (subtotal * settings.taxRate) / 100 : 0;
    const total = subtotal + tax;

    // Create order (order number will be generated automatically by the model)
    const orderData = {
      customer,
      items: orderItems,
      subtotal,
      tax,
      total,
      currency,
      exchangeRate,
      notes,
      paymentMethod,
    };

    // Set payment timeout for bank deposits
    if (paymentMethod === "bank_deposit") {
      orderData.paymentTimeout = {
        expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000), // 6 hours from now
        isExpired: false,
        notificationSent: false,
      };
    }

    const order = new Order(orderData);

    await order.save();

    // Send order initialized email
    const CustomerNotificationService = require("../services/customerNotificationService");
    try {
      await CustomerNotificationService.sendOrderInitializedEmail(order);
    } catch (emailError) {
      console.error("Failed to send order initialized email:", emailError);
      // Continue without failing order creation
    }

    // Update product availability
    for (const item of items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { availability: -item.quantity },
      });
    }

    // Import AutoDeliveryService for automatic delivery
    const AutoDeliveryService = require("../services/autoDeliveryService");

    // Trigger automatic delivery if order is paid (for immediate payments)
    if (order.paymentStatus === "paid") {
      try {
        await AutoDeliveryService.processAutoDelivery(order._id);
        console.log(`Auto-delivery triggered for order ${order.orderNumber}`);
      } catch (deliveryError) {
        console.error(
          "Auto-delivery failed during order creation:",
          deliveryError
        );
        // Don't fail order creation if auto-delivery fails
      }
    }

    // Populate order details for response
    await order.populate({
      path: "items.product",
      select:
        "title slug images category features accountCredentials autoDelivery",
      populate: {
        path: "category",
        select: "name",
      },
    });

    res.status(201).json({
      success: true,
      message: "Order placed successfully",
      data: order,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({
      success: false,
      message: "Error creating order",
      error: error.message,
      stack: error.stack,
    });
  }
});

// @desc    Get order by order number
// @route   GET /api/orders/:orderNumber
// @access  Public
router.get("/:orderNumber", async (req, res) => {
  try {
    const order = await Order.findOne({
      orderNumber: req.params.orderNumber,
    })
      .populate({
        path: "items.product",
        select: "title slug images category features accountCredentials",
        populate: {
          path: "category",
          select: "name",
        },
      })
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
      message: "Error fetching order",
      error: error.message,
    });
  }
});

// @desc    Calculate order total (for checkout preview)
// @route   POST /api/orders/calculate
// @access  Public
router.post("/calculate", async (req, res) => {
  try {
    const { items, currency = "LKR", exchangeRate = 1 } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Items array is required",
      });
    }

    let subtotal = 0;
    const calculatedItems = [];

    for (const item of items) {
      const product = await Product.findById(item.product);

      if (!product) {
        return res.status(400).json({
          success: false,
          message: `Product with ID ${item.product} not found`,
        });
      }

      if (!product.active) {
        return res.status(400).json({
          success: false,
          message: `Product ${product.title} is not available`,
        });
      }

      if (product.availability < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.title}`,
        });
      }

      let itemPrice = product.price;
      if (currency === "USD") {
        itemPrice = product.price * exchangeRate;
      }

      const calculatedItem = {
        product: product._id,
        title: product.title,
        price: itemPrice,
        quantity: item.quantity,
        total: itemPrice * item.quantity,
      };

      calculatedItems.push(calculatedItem);
      subtotal += itemPrice * item.quantity;
    }

    // Get settings for tax calculation
    const settings = await Settings.getSettings();

    // Calculate tax based on settings
    const tax = settings.taxEnabled ? (subtotal * settings.taxRate) / 100 : 0;
    const total = subtotal + tax;

    res.json({
      success: true,
      data: {
        items: calculatedItems,
        subtotal,
        tax,
        total,
        currency,
        exchangeRate,
        deliveryMessage: settings.deliveryMessage,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error calculating order total",
      error: error.message,
    });
  }
});

// @desc    Get order timeout information
// @route   GET /api/orders/:orderNumber/timeout
// @access  Public
router.get("/:orderNumber/timeout", async (req, res) => {
  try {
    console.log("Timeout request for order:", req.params.orderNumber);

    const order = await Order.findOne({
      orderNumber: req.params.orderNumber,
    });

    if (!order) {
      console.log("Order not found:", req.params.orderNumber);
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    console.log(
      "Order found:",
      order.orderNumber,
      "Payment method:",
      order.paymentMethod
    );
    console.log("Payment timeout info:", order.paymentTimeout);

    // Check if order has payment timeout (only for bank deposits)
    if (
      order.paymentMethod !== "bank_deposit" ||
      !order.paymentTimeout ||
      !order.paymentTimeout.expiresAt
    ) {
      console.log(
        "No timeout info for order:",
        order.orderNumber,
        "Payment method:",
        order.paymentMethod
      );
      return res.json({
        success: true,
        data: {
          orderNumber: order.orderNumber,
          paymentMethod: order.paymentMethod,
          expired: false,
          timeRemaining: null,
          timeRemainingMs: null,
          message: "No payment timeout for this order type",
        },
      });
    }

    // Import PaymentTimeoutService
    const PaymentTimeoutService = require("../services/paymentTimeoutService");
    const timeRemaining = await PaymentTimeoutService.getTimeRemaining(
      order._id
    );

    if (!timeRemaining) {
      console.log(
        "PaymentTimeoutService returned null for order:",
        order.orderNumber
      );
      return res.status(404).json({
        success: false,
        message: "No timeout information available for this order",
      });
    }

    console.log("Timeout info retrieved:", timeRemaining);

    res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        paymentMethod: order.paymentMethod,
        ...timeRemaining,
      },
    });
  } catch (error) {
    console.error("Error getting timeout information:", error);
    res.status(500).json({
      success: false,
      message: "Error getting timeout information",
      error: error.message,
    });
  }
});

// @desc    Get current credentials for delivered order items
// @route   GET /api/orders/:orderNumber/current-credentials
// @access  Public
router.get("/:orderNumber/current-credentials", async (req, res) => {
  try {
    const order = await Order.findOne({
      orderNumber: req.params.orderNumber,
    })
      .populate({
        path: "deliveredInventory",
        populate: {
          path: "product",
          select: "title",
        },
      })
      .populate({
        path: "items.product",
        select: "title",
      });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Get current credentials from delivered inventory items
    const currentCredentials = [];

    if (order.deliveredInventory && order.deliveredInventory.length > 0) {
      // Group inventory items by product
      const inventoryByProduct = {};

      for (const inventoryItem of order.deliveredInventory) {
        const productId = inventoryItem.product._id.toString();
        if (!inventoryByProduct[productId]) {
          inventoryByProduct[productId] = {
            title: inventoryItem.product.title,
            credentials: [],
          };
        }

        if (inventoryItem.accountCredentials) {
          inventoryByProduct[productId].credentials.push(
            inventoryItem.accountCredentials
          );
        }
      }

      // Convert to array format expected by frontend
      for (const [productId, data] of Object.entries(inventoryByProduct)) {
        if (data.credentials.length > 0) {
          currentCredentials.push({
            title: data.title,
            credentials: data.credentials.join("\n\n--- Next Account ---\n\n"),
          });
        }
      }
    }

    // If no current credentials found, fall back to static credentials from order items
    if (currentCredentials.length === 0) {
      const fallbackCredentials = order.items
        ?.filter(
          (item) =>
            (item.deliveryStatus === "delivered" || item.delivered) &&
            (item.accountCredentials || item.credentials)
        )
        .map((item) => ({
          title: item.title,
          credentials: item.accountCredentials || item.credentials,
        }));

      return res.json({
        success: true,
        data: {
          orderNumber: order.orderNumber,
          credentials: fallbackCredentials || [],
          source: "static", // Indicates credentials are from static order data
        },
      });
    }

    res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        credentials: currentCredentials,
        source: "dynamic", // Indicates credentials are from current inventory
      },
    });
  } catch (error) {
    console.error("Error fetching current credentials:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching current credentials",
      error: error.message,
    });
  }
});

module.exports = router;
