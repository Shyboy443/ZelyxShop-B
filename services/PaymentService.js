const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Order = require("../models/Order");
const AutoDeliveryService = require("./autoDeliveryService");

class PaymentService {
  /**
   * Create a payment intent for Stripe
   * @param {Object} orderData - Order data including amount, currency, etc.
   * @returns {Object} Payment intent client secret
   */
  static async createPaymentIntent(orderData) {
    try {
      const { amount, currency = "usd", customerEmail } = orderData;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: currency.toLowerCase(),
        metadata: {
          customerEmail: customerEmail || "unknown",
        },
        automatic_payment_methods: {
          enabled: true,
        },
      });

      return {
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      };
    } catch (error) {
      console.error("Error creating payment intent:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Process PayPal payment (placeholder for PayPal SDK integration)
   * @param {Object} paymentData - PayPal payment data
   * @returns {Object} Payment result
   */
  static async processPayPalPayment(paymentData) {
    try {
      // TODO: Implement PayPal SDK integration
      // This is a placeholder for PayPal payment processing
      const { orderId, paypalOrderId, amount } = paymentData;

      // Simulate PayPal payment verification
      // In real implementation, verify with PayPal API

      return {
        success: true,
        transactionId: paypalOrderId,
        status: "completed",
      };
    } catch (error) {
      console.error("Error processing PayPal payment:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Handle successful payment and update order
   * @param {String} orderId - Order ID
   * @param {Object} paymentData - Payment transaction data
   * @returns {Object} Update result
   */
  static async handleSuccessfulPayment(orderId, paymentData) {
    try {
      const { transactionId, paymentMethod, amount } = paymentData;

      const order = await Order.findByIdAndUpdate(
        orderId,
        {
          paymentStatus: "paid",
          "paymentInfo.transactionId": transactionId,
          "paymentInfo.paidAt": new Date(),
          "paymentInfo.amount": amount,
          "paymentInfo.method": paymentMethod,
        },
        { new: true }
      ).populate("items.product", "title autoDelivery");

      if (!order) {
        throw new Error("Order not found");
      }

      // Trigger auto-delivery for paid orders
      try {
        await AutoDeliveryService.processAutoDelivery(order._id);
      } catch (deliveryError) {
        console.error("Auto-delivery failed after payment:", deliveryError);
        // Don't fail the payment process if auto-delivery fails
      }

      return {
        success: true,
        order,
      };
    } catch (error) {
      console.error("Error handling successful payment:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Handle failed payment
   * @param {String} orderId - Order ID
   * @param {Object} errorData - Payment error data
   * @returns {Object} Update result
   */
  static async handleFailedPayment(orderId, errorData) {
    try {
      const order = await Order.findByIdAndUpdate(
        orderId,
        {
          paymentStatus: "failed",
          "paymentInfo.failureReason": errorData.reason || "Payment failed",
          "paymentInfo.failedAt": new Date(),
        },
        { new: true }
      );

      return {
        success: true,
        order,
      };
    } catch (error) {
      console.error("Error handling failed payment:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Verify webhook signature (for Stripe)
   * @param {String} payload - Webhook payload
   * @param {String} signature - Webhook signature
   * @returns {Object} Verification result
   */
  static verifyWebhookSignature(payload, signature) {
    try {
      const event = stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      return { success: true, event };
    } catch (error) {
      console.error("Webhook signature verification failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Process refund
   * @param {String} transactionId - Original transaction ID
   * @param {Number} amount - Refund amount
   * @param {String} reason - Refund reason
   * @returns {Object} Refund result
   */
  static async processRefund(
    transactionId,
    amount,
    reason = "requested_by_customer"
  ) {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: transactionId,
        amount: Math.round(amount * 100), // Convert to cents
        reason,
      });

      return {
        success: true,
        refundId: refund.id,
        status: refund.status,
      };
    } catch (error) {
      console.error("Error processing refund:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = PaymentService;
