const Order = require("../models/Order");
const cron = require("node-cron");

class PaymentTimeoutService {
  static async checkExpiredOrders() {
    try {
      console.log("Checking for expired payment orders...");

      const now = new Date();

      // Find orders that have expired but not yet marked as expired
      const expiredOrders = await Order.find({
        "paymentTimeout.expiresAt": { $lt: now },
        "paymentTimeout.isExpired": false,
        paymentStatus: "pending",
        status: { $ne: "cancelled" },
      });

      console.log(`Found ${expiredOrders.length} expired orders`);

      for (const order of expiredOrders) {
        await this.expireOrder(order._id);
      }

      return {
        success: true,
        expiredCount: expiredOrders.length,
      };
    } catch (error) {
      console.error("Error checking expired orders:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  static async expireOrder(orderId) {
    try {
      const order = await Order.findById(orderId);

      if (!order) {
        throw new Error("Order not found");
      }

      // Mark order as expired and cancelled
      order.paymentTimeout.isExpired = true;
      order.status = "cancelled";
      order.paymentStatus = "failed";
      order.paymentInfo.failedAt = new Date();
      order.paymentInfo.failureReason =
        "Payment timeout - order expired after 6 hours";

      await order.save();

      console.log(`Order ${order.orderNumber} expired and cancelled`);

      return {
        success: true,
        orderNumber: order.orderNumber,
      };
    } catch (error) {
      console.error(`Error expiring order ${orderId}:`, error);
      throw error;
    }
  }

  static async getTimeRemaining(orderId) {
    try {
      const order = await Order.findById(orderId);

      if (!order || !order.paymentTimeout.expiresAt) {
        return null;
      }

      const now = new Date();
      const expiresAt = new Date(order.paymentTimeout.expiresAt);
      const timeRemaining = expiresAt.getTime() - now.getTime();

      if (timeRemaining <= 0) {
        return {
          expired: true,
          timeRemaining: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
        };
      }

      const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
      const minutes = Math.floor(
        (timeRemaining % (1000 * 60 * 60)) / (1000 * 60)
      );
      const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);

      return {
        expired: false,
        timeRemaining,
        timeRemainingMs: timeRemaining,
        hours,
        minutes,
        seconds,
        expiresAt,
      };
    } catch (error) {
      console.error("Error getting time remaining:", error);
      throw error;
    }
  }

  static startPeriodicCheck(intervalMinutes = 10) {
    console.log(
      `Starting payment timeout check every ${intervalMinutes} minutes`
    );

    // Run immediately
    this.checkExpiredOrders().catch((error) => {
      console.error("Initial timeout check failed:", error);
    });

    // Set up periodic checking using cron (every 10 minutes)
    cron.schedule("*/10 * * * *", () => {
      this.checkExpiredOrders().catch((error) => {
        console.error("Periodic timeout check failed:", error);
      });
    });

    console.log("Payment timeout service started");
  }
}

module.exports = PaymentTimeoutService;
