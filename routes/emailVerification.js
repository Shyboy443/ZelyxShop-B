const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const Order = require("../models/Order");
const Settings = require("../models/Settings");
const OutlookAccount = require("../models/OutlookAccount");
const outlookService = require("../services/outlookService");
const { body, validationResult } = require("express-validator");

/**
 * @route   POST /api/email-verification/request
 * @desc    Request email verification for an order
 * @access  Public
 */
router.post(
  "/request",
  [
    body("orderNumber")
      .notEmpty()
      .withMessage("Order number is required")
      .trim(),
    body("email")
      .isEmail()
      .withMessage("Valid email is required")
      .normalizeEmail(),
    body("verificationMethod")
      .optional()
      .isIn(["otp", "link"])
      .withMessage("Invalid verification method"),
  ],
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { orderNumber, email, verificationMethod = "otp" } = req.body;

      // Find the order
      const order = await Order.findOne({
        orderNumber: orderNumber,
        "customer.email": email,
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found or email does not match",
        });
      }

      // Check if order is already verified
      if (order.emailVerification && order.emailVerification.verified) {
        return res.json({
          success: true,
          message: "Order is already verified",
          data: {
            verified: true,
            verifiedAt: order.emailVerification.verifiedAt,
          },
        });
      }

      // Generate verification code/token
      const verificationCode = crypto.randomInt(100000, 999999).toString();
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      // Store verification data in order
      order.emailVerification = {
        verified: false,
        verificationCode: verificationCode,
        verificationToken: verificationToken,
        expiresAt: expiresAt,
        attempts: 0,
        maxAttempts: 5,
        requestedAt: new Date(),
        method: verificationMethod,
      };

      await order.save();

      // Send verification email
      try {
        await this.sendVerificationEmail(order, verificationMethod);
      } catch (emailError) {
        console.error("Error sending verification email:", emailError);
        // Continue even if email sending fails
      }

      res.json({
        success: true,
        message: `Verification ${verificationMethod} sent to your email`,
        data: {
          orderNumber: order.orderNumber,
          email: order.customer.email,
          expiresAt: expiresAt,
          method: verificationMethod,
        },
      });
    } catch (error) {
      console.error("Error requesting email verification:", error);
      res.status(500).json({
        success: false,
        message: "Error requesting email verification",
        error: error.message,
      });
    }
  }
);

/**
 * @route   POST /api/email-verification/verify
 * @desc    Verify email with OTP code
 * @access  Public
 */
router.post(
  "/verify",
  [
    body("orderNumber")
      .notEmpty()
      .withMessage("Order number is required")
      .trim(),
    body("email")
      .isEmail()
      .withMessage("Valid email is required")
      .normalizeEmail(),
    body("verificationCode")
      .notEmpty()
      .withMessage("Verification code is required")
      .isLength({ min: 6, max: 6 })
      .withMessage("Verification code must be 6 digits")
      .isNumeric()
      .withMessage("Verification code must be numeric"),
  ],
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { orderNumber, email, verificationCode } = req.body;

      // Find the order
      const order = await Order.findOne({
        orderNumber: orderNumber,
        "customer.email": email,
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found or email does not match",
        });
      }

      // Check if verification data exists
      if (!order.emailVerification) {
        return res.status(400).json({
          success: false,
          message:
            "No verification request found. Please request verification first.",
        });
      }

      const verification = order.emailVerification;

      // Check if already verified
      if (verification.verified) {
        return res.json({
          success: true,
          message: "Order is already verified",
          data: {
            verified: true,
            verifiedAt: verification.verifiedAt,
          },
        });
      }

      // Check if expired
      if (new Date() > verification.expiresAt) {
        return res.status(400).json({
          success: false,
          message: "Verification code has expired. Please request a new one.",
        });
      }

      // Check attempt limit
      if (verification.attempts >= verification.maxAttempts) {
        return res.status(400).json({
          success: false,
          message:
            "Maximum verification attempts exceeded. Please request a new code.",
        });
      }

      // Increment attempts
      verification.attempts += 1;

      // Check verification code
      if (verification.verificationCode !== verificationCode) {
        await order.save();
        return res.status(400).json({
          success: false,
          message: "Invalid verification code",
          data: {
            attemptsRemaining: verification.maxAttempts - verification.attempts,
          },
        });
      }

      // Verification successful
      verification.verified = true;
      verification.verifiedAt = new Date();
      verification.verificationSource = "manual_otp";

      // Update order payment status if it was pending
      if (order.paymentStatus === "pending") {
        order.paymentStatus = "verified";
        order.paymentVerifiedAt = new Date();
        order.notes =
          (order.notes || "") +
          "\n\nPayment verified via email OTP verification";
      }

      await order.save();

      res.json({
        success: true,
        message: "Email verification successful",
        data: {
          verified: true,
          verifiedAt: verification.verifiedAt,
          orderNumber: order.orderNumber,
          paymentStatus: order.paymentStatus,
        },
      });
    } catch (error) {
      console.error("Error verifying email:", error);
      res.status(500).json({
        success: false,
        message: "Error verifying email",
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /api/email-verification/verify-link/:token
 * @desc    Verify email with verification link
 * @access  Public
 */
router.get("/verify-link/:token", async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Verification token is required",
      });
    }

    // Find order with matching verification token
    const order = await Order.findOne({
      "emailVerification.verificationToken": token,
      "emailVerification.verified": false,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Invalid or expired verification link",
      });
    }

    const verification = order.emailVerification;

    // Check if expired
    if (new Date() > verification.expiresAt) {
      return res.status(400).json({
        success: false,
        message: "Verification link has expired",
      });
    }

    // Verification successful
    verification.verified = true;
    verification.verifiedAt = new Date();
    verification.verificationSource = "email_link";

    // Update order payment status if it was pending
    if (order.paymentStatus === "pending") {
      order.paymentStatus = "verified";
      order.paymentVerifiedAt = new Date();
      order.notes =
        (order.notes || "") +
        "\n\nPayment verified via email verification link";
    }

    await order.save();

    res.json({
      success: true,
      message: "Email verification successful",
      data: {
        verified: true,
        verifiedAt: verification.verifiedAt,
        orderNumber: order.orderNumber,
        paymentStatus: order.paymentStatus,
      },
    });
  } catch (error) {
    console.error("Error verifying email link:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying email link",
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/email-verification/status/:orderNumber
 * @desc    Get verification status for an order
 * @access  Public
 */
router.get("/status/:orderNumber", async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email parameter is required",
      });
    }

    // Find the order
    const order = await Order.findOne({
      orderNumber: orderNumber,
      "customer.email": email,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found or email does not match",
      });
    }

    const verification = order.emailVerification;

    if (!verification) {
      return res.json({
        success: true,
        data: {
          verified: false,
          verificationRequested: false,
        },
      });
    }

    res.json({
      success: true,
      data: {
        verified: verification.verified,
        verificationRequested: true,
        verifiedAt: verification.verifiedAt,
        expiresAt: verification.expiresAt,
        attempts: verification.attempts,
        maxAttempts: verification.maxAttempts,
        method: verification.method,
        paymentStatus: order.paymentStatus,
      },
    });
  } catch (error) {
    console.error("Error getting verification status:", error);
    res.status(500).json({
      success: false,
      message: "Error getting verification status",
      error: error.message,
    });
  }
});

/**
 * Send verification email using Outlook service
 */
router.sendVerificationEmail = async function (order, method = "otp") {
  try {
    const settings = await Settings.findOne();
    if (!settings || !settings.outlookEnabled) {
      throw new Error("Outlook integration is not enabled");
    }

    // Get an active Outlook account for sending emails
    const senderAccount = await OutlookAccount.findOne({
      isActive: true,
      syncStatus: { $ne: "error" },
    });

    if (!senderAccount) {
      throw new Error("No active Outlook account available for sending emails");
    }

    // Check if token is expired and refresh if needed
    if (senderAccount.isTokenExpired()) {
      await outlookService.refreshAccountToken(senderAccount);
    }

    const verification = order.emailVerification;
    let subject, body;

    if (method === "otp") {
      subject = `Email Verification Code - Order ${order.orderNumber}`;
      body = `
        <h2>Email Verification Required</h2>
        <p>Dear ${order.customer.firstName || "Customer"},</p>
        <p>To verify your email for order <strong>${
          order.orderNumber
        }</strong>, please use the following verification code:</p>
        <div style="background-color: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0;">
          <h1 style="color: #333; font-size: 32px; margin: 0;">${
            verification.verificationCode
          }</h1>
        </div>
        <p>This code will expire in 15 minutes.</p>
        <p>If you didn't request this verification, please ignore this email.</p>
        <br>
        <p>Best regards,<br>Zelyx Team</p>
      `;
    } else {
      const verificationUrl = `${
        process.env.CLIENT_URL || "http://localhost:3000"
      }/email-verification/verify/${verification.verificationToken}`;
      subject = `Verify Your Email - Order ${order.orderNumber}`;
      body = `
        <h2>Email Verification Required</h2>
        <p>Dear ${order.customer.firstName || "Customer"},</p>
        <p>To verify your email for order <strong>${
          order.orderNumber
        }</strong>, please click the link below:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email</a>
        </div>
        <p>Or copy and paste this link in your browser:</p>
        <p><a href="${verificationUrl}">${verificationUrl}</a></p>
        <p>This link will expire in 15 minutes.</p>
        <p>If you didn't request this verification, please ignore this email.</p>
        <br>
        <p>Best regards,<br>Zelyx Team</p>
      `;
    }

    await outlookService.sendEmail(
      senderAccount.accessToken,
      order.customer.email,
      subject,
      body,
      true
    );

    console.log(
      `Verification email sent to ${order.customer.email} for order ${order.orderNumber}`
    );
  } catch (error) {
    console.error("Error sending verification email:", error);
    throw error;
  }
};

module.exports = router;
