const nodemailer = require("nodemailer");
const DeliveryLog = require("../models/DeliveryLog");

// Create transporter for admin notifications
const createAdminTransporter = () => {
  return nodemailer.createTransporter({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_PORT == 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

class NotificationService {
  static async sendAdminAlert(type, data) {
    try {
      const adminEmail = process.env.ADMIN_EMAIL;
      if (!adminEmail) {
        console.log("Admin email not configured, skipping notification");
        return;
      }

      const transporter = createAdminTransporter();
      let subject, content;

      switch (type) {
        case "DELIVERY_FAILURE":
          subject = `🚨 Delivery Failure Alert - Order ${data.orderNumber}`;
          content = this.generateDeliveryFailureEmail(data);
          break;
        case "INVENTORY_LOW":
          subject = `⚠️ Low Inventory Alert - ${data.productTitle}`;
          content = this.generateLowInventoryEmail(data);
          break;
        case "MULTIPLE_FAILURES":
          subject = `🔥 Critical: Multiple Delivery Failures Detected`;
          content = this.generateMultipleFailuresEmail(data);
          break;
        case "EMAIL_SERVICE_DOWN":
          subject = `💥 Email Service Failure Alert`;
          content = this.generateEmailServiceDownEmail(data);
          break;
        case "RETRY_EXHAUSTED":
          subject = `❌ Delivery Retry Exhausted - Order ${data.orderNumber}`;
          content = this.generateRetryExhaustedEmail(data);
          break;
        default:
          console.log(`Unknown notification type: ${type}`);
          return;
      }

      const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to: adminEmail,
        subject,
        html: content,
      };

      await transporter.sendMail(mailOptions);
      console.log(`Admin notification sent: ${type}`);
    } catch (error) {
      console.error("Failed to send admin notification:", error);
    }
  }

  static generateDeliveryFailureEmail(data) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d32f2f;">🚨 Delivery Failure Alert</h2>
        
        <div style="background-color: #ffebee; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
          <h3 style="margin-top: 0; color: #d32f2f;">Order Details:</h3>
          <p><strong>Order Number:</strong> ${data.orderNumber}</p>
          <p><strong>Customer Email:</strong> ${data.customerEmail}</p>
          <p><strong>Product:</strong> ${data.productTitle}</p>
          <p><strong>Quantity:</strong> ${data.quantity}</p>
          <p><strong>Error:</strong> ${data.errorMessage}</p>
          <p><strong>Error Code:</strong> ${data.errorCode}</p>
          <p><strong>Retry Count:</strong> ${data.retryCount || 0}</p>
        </div>
        
        <div style="background-color: #fff3e0; padding: 15px; border-radius: 4px;">
          <h3 style="margin-top: 0; color: #f57c00;">Recommended Actions:</h3>
          <ul>
            <li>Check inventory levels for this product</li>
            <li>Verify email service configuration</li>
            <li>Review delivery logs for patterns</li>
            <li>Consider manual delivery if urgent</li>
          </ul>
        </div>
        
        <p style="margin-top: 20px; color: #666;">
          <small>This is an automated alert from the Zelyx Auto-Delivery System.</small>
        </p>
      </div>
    `;
  }

  static generateLowInventoryEmail(data) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f57c00;">⚠️ Low Inventory Alert</h2>
        
        <div style="background-color: #fff3e0; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
          <h3 style="margin-top: 0; color: #f57c00;">Product Details:</h3>
          <p><strong>Product:</strong> ${data.productTitle}</p>
          <p><strong>Current Stock:</strong> ${data.currentStock} items</p>
          <p><strong>Threshold:</strong> ${data.threshold} items</p>
          <p><strong>Pending Orders:</strong> ${data.pendingOrders || 0}</p>
        </div>
        
        <div style="background-color: #ffebee; padding: 15px; border-radius: 4px;">
          <h3 style="margin-top: 0; color: #d32f2f;">Action Required:</h3>
          <p>Please add more inventory items to prevent delivery failures.</p>
        </div>
        
        <p style="margin-top: 20px; color: #666;">
          <small>This is an automated alert from the Zelyx Auto-Delivery System.</small>
        </p>
      </div>
    `;
  }

  static generateMultipleFailuresEmail(data) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d32f2f;">🔥 Critical: Multiple Delivery Failures</h2>
        
        <div style="background-color: #ffebee; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
          <h3 style="margin-top: 0; color: #d32f2f;">Alert Summary:</h3>
          <p><strong>Failed Deliveries:</strong> ${data.failureCount} in the last ${data.timeframe}</p>
          <p><strong>Affected Orders:</strong> ${data.affectedOrders}</p>
          <p><strong>Most Common Error:</strong> ${data.commonError}</p>
        </div>
        
        <div style="background-color: #fff3e0; padding: 15px; border-radius: 4px;">
          <h3 style="margin-top: 0; color: #f57c00;">Immediate Actions Required:</h3>
          <ul>
            <li>Check system health and email service</li>
            <li>Review inventory levels across all products</li>
            <li>Investigate common failure patterns</li>
            <li>Consider temporarily disabling auto-delivery if needed</li>
          </ul>
        </div>
        
        <p style="margin-top: 20px; color: #666;">
          <small>This is a critical automated alert from the Zelyx Auto-Delivery System.</small>
        </p>
      </div>
    `;
  }

  static generateEmailServiceDownEmail(data) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d32f2f;">💥 Email Service Failure</h2>
        
        <div style="background-color: #ffebee; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
          <h3 style="margin-top: 0; color: #d32f2f;">Service Status:</h3>
          <p><strong>Error:</strong> ${data.error}</p>
          <p><strong>Failed Attempts:</strong> ${data.failedAttempts}</p>
          <p><strong>Last Attempt:</strong> ${new Date(
            data.lastAttempt
          ).toLocaleString()}</p>
        </div>
        
        <div style="background-color: #fff3e0; padding: 15px; border-radius: 4px;">
          <h3 style="margin-top: 0; color: #f57c00;">Action Required:</h3>
          <p>Email delivery service is down. Please check SMTP configuration and service status.</p>
        </div>
        
        <p style="margin-top: 20px; color: #666;">
          <small>This is an automated alert from the Zelyx Auto-Delivery System.</small>
        </p>
      </div>
    `;
  }

  static generateRetryExhaustedEmail(data) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d32f2f;">❌ Delivery Retry Exhausted</h2>
        
        <div style="background-color: #ffebee; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
          <h3 style="margin-top: 0; color: #d32f2f;">Order Details:</h3>
          <p><strong>Order Number:</strong> ${data.orderNumber}</p>
          <p><strong>Customer Email:</strong> ${data.customerEmail}</p>
          <p><strong>Product:</strong> ${data.productTitle}</p>
          <p><strong>Total Retry Attempts:</strong> ${data.retryCount}</p>
          <p><strong>Last Error:</strong> ${data.lastError}</p>
        </div>
        
        <div style="background-color: #fff3e0; padding: 15px; border-radius: 4px;">
          <h3 style="margin-top: 0; color: #f57c00;">Manual Intervention Required:</h3>
          <p>All automatic retry attempts have been exhausted. Manual delivery may be required.</p>
        </div>
        
        <p style="margin-top: 20px; color: #666;">
          <small>This is an automated alert from the Zelyx Auto-Delivery System.</small>
        </p>
      </div>
    `;
  }

  // Check for critical conditions and send alerts
  static async checkAndSendAlerts() {
    try {
      // Check for multiple failures in the last hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentFailures = await DeliveryLog.find({
        status: "error",
        createdAt: { $gte: oneHourAgo },
      });

      if (recentFailures.length >= 5) {
        const errorCounts = {};
        recentFailures.forEach((log) => {
          errorCounts[log.errorCode] = (errorCounts[log.errorCode] || 0) + 1;
        });

        const commonError = Object.keys(errorCounts).reduce((a, b) =>
          errorCounts[a] > errorCounts[b] ? a : b
        );

        await this.sendAdminAlert("MULTIPLE_FAILURES", {
          failureCount: recentFailures.length,
          timeframe: "hour",
          affectedOrders: [
            ...new Set(recentFailures.map((log) => log.orderNumber)),
          ].length,
          commonError,
        });
      }

      // Check for exhausted retries
      const exhaustedRetries = await DeliveryLog.find({
        status: "error",
        retryCount: { $gte: 3 },
        isResolved: false,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });

      for (const log of exhaustedRetries) {
        await this.sendAdminAlert("RETRY_EXHAUSTED", {
          orderNumber: log.orderNumber,
          customerEmail: log.customerEmail,
          productTitle: log.productTitle,
          retryCount: log.retryCount,
          lastError: log.message,
        });

        // Mark as resolved to prevent duplicate alerts
        await DeliveryLog.findByIdAndUpdate(log._id, { isResolved: true });
      }
    } catch (error) {
      console.error("Error in checkAndSendAlerts:", error);
    }
  }
}

module.exports = NotificationService;
