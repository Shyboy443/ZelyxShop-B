const express = require("express");
const router = express.Router();
const PaymentService = require("../services/PaymentService");
const Order = require("../models/Order");
const { protect } = require("../middlewares/auth");
const multer = require("multer");
const path = require("path");

// Configure multer for receipt uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/receipts/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      req.params.orderNumber +
        "-" +
        uniqueSuffix +
        path.extname(file.originalname)
    );
  },
});

// @desc    Upload appeal receipt after payment decline
// @route   POST /api/payments/appeal-receipt/:orderNumber
// @access  Public
router.post("/appeal-receipt/:orderNumber", (req, res) => {
  upload.single("receipt")(req, res, async (err) => {
    try {
      console.log(
        "Appeal receipt upload request for order:",
        req.params.orderNumber
      );

      // Handle multer errors
      if (err) {
        console.error("Multer error:", err.message);
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            message: "File too large. Maximum size is 5MB.",
          });
        }
        if (err.message === "Only image files and PDFs are allowed!") {
          return res.status(400).json({
            success: false,
            message: "Invalid file type. Only images and PDFs are allowed.",
          });
        }
        return res.status(400).json({ success: false, message: err.message });
      }

      const order = await Order.findOne({
        orderNumber: req.params.orderNumber,
      });
      if (!order) {
        console.log("Order not found:", req.params.orderNumber);
        return res
          .status(404)
          .json({ success: false, message: "Order not found" });
      }

      // Check if payment was declined
      if (order.paymentStatus !== "declined") {
        return res.status(400).json({
          success: false,
          message: "Payment appeal is only allowed for declined payments",
        });
      }

      if (!req.file) {
        console.log("No file uploaded in request");
        return res
          .status(400)
          .json({ success: false, message: "No file uploaded" });
      }

      // Update appeal count and reset payment status to pending
      const currentAppealCount = order.receiptVerification?.appealCount || 0;

      // Store the relative path for the receipt (normalize path separators for URLs)
      order.receipt = req.file.path.replace(/\\/g, "/");
      order.receiptOriginalName = req.file.originalname;
      order.receiptUploadedAt = new Date();
      order.paymentStatus = "pending";
      order.receiptVerification = {
        ...order.receiptVerification,
        status: "pending",
        appealCount: currentAppealCount + 1,
        lastAppealAt: new Date(),
      };

      await order.save();

      console.log(
        "Appeal receipt uploaded successfully for order:",
        order.orderNumber,
        "File:",
        req.file.filename
      );
      res.json({
        success: true,
        message:
          "Appeal receipt uploaded successfully. Your payment is now under review again.",
        filename: req.file.filename,
      });
    } catch (error) {
      console.error("Error uploading appeal receipt:", error);
      res.status(500).json({
        success: false,
        message: "Error uploading appeal receipt",
        error: error.message,
      });
    }
  });
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Accept images and PDFs
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype === "application/pdf"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only image files and PDFs are allowed!"), false);
    }
  },
});

// @desc    Upload payment receipt for bank deposit
// @route   POST /api/payments/upload-receipt/:orderNumber
// @access  Public
router.post("/upload-receipt/:orderNumber", (req, res) => {
  upload.single("receipt")(req, res, async (err) => {
    try {
      console.log("Receipt upload request for order:", req.params.orderNumber);

      // Handle multer errors
      if (err) {
        console.error("Multer error:", err.message);
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            message: "File too large. Maximum size is 5MB.",
          });
        }
        if (err.message === "Only image files and PDFs are allowed!") {
          return res.status(400).json({
            success: false,
            message: "Invalid file type. Only images and PDFs are allowed.",
          });
        }
        return res.status(400).json({ success: false, message: err.message });
      }

      console.log("File received:", req.file ? req.file.filename : "No file");

      const order = await Order.findOne({
        orderNumber: req.params.orderNumber,
      });
      if (!order) {
        console.log("Order not found:", req.params.orderNumber);
        return res
          .status(404)
          .json({ success: false, message: "Order not found" });
      }

      console.log(
        "Order found:",
        order.orderNumber,
        "Payment method:",
        order.paymentMethod
      );

      if (order.paymentMethod !== "bank_deposit") {
        console.log(
          "Invalid payment method for receipt upload:",
          order.paymentMethod
        );
        return res.status(400).json({
          success: false,
          message: "Receipt upload only for bank deposits",
        });
      }

      if (!req.file) {
        console.log("No file uploaded in request");
        return res
          .status(400)
          .json({ success: false, message: "No file uploaded" });
      }

      // Store the relative path for the receipt (normalize path separators for URLs)
      order.receipt = req.file.path.replace(/\\/g, "/");
      order.receiptOriginalName = req.file.originalname;
      order.receiptUploadedAt = new Date();
      await order.save();

      console.log(
        "Receipt uploaded successfully for order:",
        order.orderNumber,
        "File:",
        req.file.filename
      );
      res.json({
        success: true,
        message: "Receipt uploaded successfully",
        filename: req.file.filename,
      });
    } catch (error) {
      console.error("Error uploading receipt:", error);
      res.status(500).json({
        success: false,
        message: "Error uploading receipt",
        error: error.message,
      });
    }
  });
});

// @desc    Create payment intent for Stripe
// @route   POST /api/payments/create-intent
// @access  Public
router.post("/create-intent", async (req, res) => {
  try {
    const { amount, currency, customerEmail } = req.body;

    if (!amount) {
      return res.status(400).json({
        success: false,
        message: "Amount is required",
      });
    }

    const result = await PaymentService.createPaymentIntent({
      amount,
      currency,
      customerEmail,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to create payment intent",
        error: result.error,
      });
    }

    res.json({
      success: true,
      clientSecret: result.clientSecret,
      paymentIntentId: result.paymentIntentId,
    });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

// @desc    Confirm payment
// @route   POST /api/payments/confirm
// @access  Public
router.post("/confirm", async (req, res) => {
  try {
    const { transactionId, paymentMethod, amount, customerEmail } = req.body;

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: "Transaction ID is required",
      });
    }

    // Check for testing override
    const skipPaymentCheck = process.env.SKIP_PAYMENT_CHECK === "true";

    // For now, just return success - the actual order creation and payment confirmation
    // will happen in the checkout flow after payment is successful
    res.json({
      success: true,
      transactionId,
      paymentMethod,
      amount,
      customerEmail,
      testMode: skipPaymentCheck,
    });
  } catch (error) {
    console.error("Error confirming payment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to confirm payment",
    });
  }
});

// @desc    Process Bank Deposit payment
// @route   POST /api/payments/bank-deposit
// @access  Public
router.post("/bank-deposit", async (req, res) => {
  try {
    const { orderId, amount, customerEmail, receiptInfo } = req.body;

    if (!orderId || !amount) {
      return res.status(400).json({
        success: false,
        message: "Order ID and amount are required",
      });
    }

    // Check for testing override
    const skipPaymentCheck = process.env.SKIP_PAYMENT_CHECK === "true";

    // Generate transaction ID for bank deposit
    const transactionId = `bank_deposit_${Date.now()}`;

    // For bank deposits, payment status is pending until receipt is verified
    const paymentStatus = skipPaymentCheck ? "completed" : "pending";

    res.json({
      success: true,
      transactionId,
      paymentMethod: "bank_deposit",
      paymentStatus,
      amount,
      customerEmail,
      receiptInfo,
      message:
        "Bank deposit recorded. Please send payment receipt via chat for verification.",
      testMode: skipPaymentCheck,
    });
  } catch (error) {
    console.error("Error processing bank deposit:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process bank deposit",
      error: error.message,
    });
  }
});

// @desc    Process Cryptocurrency payment
// @route   POST /api/payments/cryptocurrency
// @access  Public
router.post("/cryptocurrency", async (req, res) => {
  try {
    const { orderId, amount, customerEmail, cryptoType, walletAddress } =
      req.body;

    if (!orderId || !amount) {
      return res.status(400).json({
        success: false,
        message: "Order ID and amount are required",
      });
    }

    // Check for testing override
    const skipPaymentCheck = process.env.SKIP_PAYMENT_CHECK === "true";

    // Generate transaction ID for cryptocurrency
    const transactionId = `crypto_${cryptoType || "btc"}_${Date.now()}`;

    // For crypto, payment status is pending until blockchain confirmation
    const paymentStatus = skipPaymentCheck ? "completed" : "pending";

    res.json({
      success: true,
      transactionId,
      paymentMethod: "cryptocurrency",
      paymentStatus,
      amount,
      customerEmail,
      cryptoType: cryptoType || "bitcoin",
      walletAddress,
      message:
        "Cryptocurrency payment initiated. Awaiting blockchain confirmation.",
      testMode: skipPaymentCheck,
    });
  } catch (error) {
    console.error("Error processing cryptocurrency payment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process cryptocurrency payment",
      error: error.message,
    });
  }
});

// @desc    Process PayPal payment
// @route   POST /api/payments/paypal
// @access  Public
router.post("/paypal", async (req, res) => {
  try {
    const { orderId, paypalOrderId, amount } = req.body;

    if (!orderId || !paypalOrderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID and PayPal order ID are required",
      });
    }

    // Verify order exists
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Process PayPal payment
    const paypalResult = await PaymentService.processPayPalPayment({
      orderId,
      paypalOrderId,
      amount,
    });

    if (!paypalResult.success) {
      return res.status(400).json({
        success: false,
        message: "PayPal payment failed",
        error: paypalResult.error,
      });
    }

    // Handle successful payment
    const result = await PaymentService.handleSuccessfulPayment(orderId, {
      transactionId: paypalResult.transactionId,
      paymentMethod: "paypal",
      amount,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to process payment",
        error: result.error,
      });
    }

    res.json({
      success: true,
      message: "PayPal payment processed successfully",
      order: result.order,
    });
  } catch (error) {
    console.error("Error processing PayPal payment:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

// @desc    Handle Stripe webhooks
// @route   POST /api/payments/webhook/stripe
// @access  Public
router.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signature = req.headers["stripe-signature"];
      const payload = req.body;

      // Verify webhook signature
      const verification = PaymentService.verifyWebhookSignature(
        payload,
        signature
      );
      if (!verification.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid webhook signature",
        });
      }

      const event = verification.event;

      // Handle different event types
      switch (event.type) {
        case "payment_intent.succeeded":
          const paymentIntent = event.data.object;
          const orderId = paymentIntent.metadata.orderId;

          if (orderId) {
            await PaymentService.handleSuccessfulPayment(orderId, {
              transactionId: paymentIntent.id,
              paymentMethod: "stripe",
              amount: paymentIntent.amount / 100, // Convert from cents
            });
          }
          break;

        case "payment_intent.payment_failed":
          const failedPayment = event.data.object;
          const failedOrderId = failedPayment.metadata.orderId;

          if (failedOrderId) {
            await PaymentService.handleFailedPayment(failedOrderId, {
              reason:
                failedPayment.last_payment_error?.message || "Payment failed",
            });
          }
          break;

        default:
          console.log(`Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error("Error handling Stripe webhook:", error);
      res.status(500).json({
        success: false,
        message: "Webhook processing failed",
        error: error.message,
      });
    }
  }
);

// @desc    Process refund
// @route   POST /api/payments/refund
// @access  Private (Admin)
router.post("/refund", protect, async (req, res) => {
  try {
    const { orderId, amount, reason } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    // Get order and verify payment info
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.paymentStatus !== "paid") {
      return res.status(400).json({
        success: false,
        message: "Order is not paid, cannot process refund",
      });
    }

    if (!order.paymentInfo.transactionId) {
      return res.status(400).json({
        success: false,
        message: "No transaction ID found for this order",
      });
    }

    // Process refund
    const refundResult = await PaymentService.processRefund(
      order.paymentInfo.transactionId,
      amount || order.total,
      reason
    );

    if (!refundResult.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to process refund",
        error: refundResult.error,
      });
    }

    // Update order with refund information
    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      {
        paymentStatus: "refunded",
        "paymentInfo.refundId": refundResult.refundId,
        "paymentInfo.refundedAt": new Date(),
        "paymentInfo.refundAmount": amount || order.total,
      },
      { new: true }
    );

    res.json({
      success: true,
      message: "Refund processed successfully",
      refundId: refundResult.refundId,
      order: updatedOrder,
    });
  } catch (error) {
    console.error("Error processing refund:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

// @desc    Get payment status
// @route   GET /api/payments/status/:orderId
// @access  Public
router.get("/status/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId).select(
      "paymentStatus paymentInfo orderNumber"
    );
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      paymentStatus: order.paymentStatus,
      paymentInfo: order.paymentInfo,
      orderNumber: order.orderNumber,
    });
  } catch (error) {
    console.error("Error getting payment status:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

module.exports = router;
