const nodemailer = require("nodemailer");
const Order = require("../models/Order");

// Create transporter for customer notifications
const createCustomerTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_PORT == 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

class CustomerNotificationService {
  /**
   * Send payment confirmation email to customer
   * @param {Object} orderData - Order data including customer info and order details
   */
  static async sendPaymentConfirmationEmail(orderData) {
    try {
      const customerEmail =
        orderData.customer?.email || orderData.customerEmail;

      if (!customerEmail) {
        console.log("Customer email not found, skipping notification");
        return { success: false, error: "No customer email" };
      }

      const transporter = createCustomerTransporter();
      const emailContent = this.generatePaymentConfirmationEmail(orderData);

      const mailOptions = {
        from: "noreply@zelyx.shop",
        to: customerEmail,
        subject: `Payment Confirmed - Order #${orderData.orderNumber}`,
        html: emailContent,
      };

      const result = await transporter.sendMail(mailOptions);
      console.log(
        `Payment confirmation email sent to ${customerEmail} for order ${orderData.orderNumber}`
      );

      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error("Error sending payment confirmation email:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate HTML content for payment confirmation email
   * @param {Object} orderData - Order data
   * @returns {string} HTML email content
   */
  static generatePaymentConfirmationEmail(orderData) {
    const orderStatusUrl = `${
      process.env.CLIENT_URL || "http://localhost:3000"
    }/order-status/${orderData.orderNumber}`;
    const customerName =
      orderData.customer?.firstName ||
      orderData.customerInfo?.firstName ||
      "Valued Customer";
    const productTitle =
      orderData.items?.[0]?.title ||
      orderData.productTitle ||
      "Digital Product";
    const orderTotal = orderData.total || 0;
    const currency = orderData.currency || "USD";

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 20px;">
        <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1976d2; margin: 0; font-size: 28px;">✅ Payment Confirmed!</h1>
            <p style="color: #666; margin: 10px 0 0 0; font-size: 16px;">Your order has been successfully processed</p>
          </div>
          
          <!-- Greeting -->
          <div style="margin-bottom: 25px;">
            <p style="font-size: 16px; color: #333; margin: 0;">Dear ${customerName},</p>
            <p style="font-size: 16px; color: #333; line-height: 1.6; margin: 15px 0;">Great news! We have successfully confirmed your payment and your order is now being processed.</p>
          </div>
          
          <!-- Order Details Card -->
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin-bottom: 25px; border-left: 4px solid #1976d2;">
            <h3 style="color: #1976d2; margin: 0 0 15px 0; font-size: 18px;">📋 Order Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #666; font-weight: bold;">Order Number:</td>
                <td style="padding: 8px 0; color: #333;">#${
                  orderData.orderNumber
                }</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666; font-weight: bold;">Product:</td>
                <td style="padding: 8px 0; color: #333;">${productTitle}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666; font-weight: bold;">Total Amount:</td>
                <td style="padding: 8px 0; color: #333; font-weight: bold;">${currency} ${Number(
      orderTotal
    ).toFixed(2)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666; font-weight: bold;">Payment Status:</td>
                <td style="padding: 8px 0;"><span style="background-color: #4caf50; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold;">CONFIRMED</span></td>
              </tr>

            </table>
          </div>
          
          <!-- Next Steps -->
          <div style="background-color: #e3f2fd; padding: 20px; border-radius: 6px; margin-bottom: 25px;">
            <h3 style="color: #1976d2; margin: 0 0 15px 0; font-size: 18px;">🚀 What's Next?</h3>
            <ul style="margin: 0; padding-left: 20px; color: #333; line-height: 1.6;">
              <li>Your order is now being processed</li>
              <li>You will receive delivery instructions shortly</li>
              <li>Track your order status using the link below</li>
              <li>Check your email for delivery notifications</li>
            </ul>
          </div>
          
          <!-- CTA Button -->
          <div style="text-align: center; margin: 30px 0;">
            <a href="${orderStatusUrl}" style="background-color: #1976d2; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">📊 Track Your Order</a>
          </div>
          
          <!-- Support Info -->
          <div style="border-top: 1px solid #eee; padding-top: 20px; text-align: center;">
            <p style="color: #666; font-size: 14px; margin: 0 0 10px 0;">Need help? Contact our support team</p>
            <p style="color: #1976d2; font-size: 14px; margin: 0;">📧 support@zelyx.shop | 📞 +1 (555) 123-4567</p>
          </div>
          
          <!-- Footer -->
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="color: #999; font-size: 12px; margin: 0;">Thank you for choosing Zelyx Digital Services</p>
            <p style="color: #999; font-size: 12px; margin: 5px 0 0 0;">This is an automated message, please do not reply to this email.</p>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Send order status update email to customer
   * @param {Object} orderData - Order data
   * @param {string} statusUpdate - Status update message
   */
  static async sendOrderStatusUpdateEmail(orderData, statusUpdate) {
    try {
      const customerEmail =
        orderData.customer?.email || orderData.customerEmail;

      if (!customerEmail) {
        console.log(
          "Customer email not found, skipping status update notification"
        );
        return { success: false, error: "No customer email" };
      }

      const transporter = createCustomerTransporter();
      const emailContent = this.generateOrderStatusUpdateEmail(
        orderData,
        statusUpdate
      );

      const mailOptions = {
        from: `"Zelyx Digital Services" <${process.env.SMTP_USER}>`,
        to: customerEmail,
        subject: `Order Update - #${orderData.orderNumber}`,
        html: emailContent,
      };

      const result = await transporter.sendMail(mailOptions);
      console.log(
        `Order status update email sent to ${customerEmail} for order ${orderData.orderNumber}`
      );

      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error("Error sending order status update email:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate HTML content for order status update email
   * @param {Object} orderData - Order data
   * @param {string} statusUpdate - Status update message
   * @returns {string} HTML email content
   */
  static generateOrderStatusUpdateEmail(orderData, statusUpdate) {
    const orderStatusUrl = `${
      process.env.CLIENT_URL || "http://localhost:3000"
    }/order-status/${orderData.orderNumber}`;
    const customerName =
      orderData.customer?.firstName ||
      orderData.customerInfo?.firstName ||
      "Valued Customer";

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 20px;">
        <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1976d2; margin: 0; font-size: 24px;">📦 Order Status Update</h1>
            <p style="color: #666; margin: 10px 0 0 0;">Order #${orderData.orderNumber}</p>
          </div>
          
          <p style="font-size: 16px; color: #333;">Dear ${customerName},</p>
          <p style="font-size: 16px; color: #333; line-height: 1.6;">${statusUpdate}</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${orderStatusUrl}" style="background-color: #1976d2; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">View Order Status</a>
          </div>
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="color: #999; font-size: 12px; margin: 0;">Thank you for choosing Zelyx Digital Services</p>
          </div>
        </div>
      </div>
    `;
  }
}

  /**
   * Send order initialized email to customer
   * @param {Object} orderData - Order data including customer info and order details
   */
  CustomerNotificationService.sendOrderInitializedEmail = async function(orderData) {
    try {
      const customerEmail = orderData.customer?.email || orderData.customerEmail;

      if (!customerEmail) {
        console.log("Customer email not found, skipping initialization notification");
        return { success: false, error: "No customer email" };
      }

      const transporter = createCustomerTransporter();
      const emailContent = this.generateOrderInitializedEmail(orderData);

      const mailOptions = {
        from: process.env.SMTP_FROM,
        to: customerEmail,
        subject: `Order Initialized - #${orderData.orderNumber}`,
        html: emailContent,
      };

      const result = await transporter.sendMail(mailOptions);
      console.log(`Order initialized email sent to ${customerEmail} for order ${orderData.orderNumber}`);

      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error("Error sending order initialized email:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate HTML content for order initialized email
   * @param {Object} orderData - Order data
   * @returns {string} HTML email content
   */
  CustomerNotificationService.generateOrderInitializedEmail = function(orderData) {
    const orderStatusUrl = `${process.env.CLIENT_URL || "http://localhost:3000"}/order-status/${orderData.orderNumber}`;
    const customerName = orderData.customer?.firstName || orderData.customerInfo?.firstName || "Valued Customer";
    const productTitle = orderData.items?.[0]?.title || orderData.productTitle || "Digital Product";
    const orderTotal = orderData.total || 0;
    const currency = orderData.currency || "USD";

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 20px;">
        <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1976d2; margin: 0; font-size: 28px;">🛒 Order Initialized!</h1>
            <p style="color: #666; margin: 10px 0 0 0; font-size: 16px;">Thank you for your order</p>
          </div>
          
          <!-- Greeting -->
          <div style="margin-bottom: 25px;">
            <p style="font-size: 16px; color: #333; margin: 0;">Dear ${customerName},</p>
            <p style="font-size: 16px; color: #333; line-height: 1.6; margin: 15px 0;">Your order has been successfully initialized and is awaiting payment confirmation.</p>
          </div>
          
          <!-- Order Details Card -->
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin-bottom: 25px; border-left: 4px solid #1976d2;">
            <h3 style="color: #1976d2; margin: 0 0 15px 0; font-size: 18px;">📋 Order Summary</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #666; font-weight: bold;">Order Number:</td>
                <td style="padding: 8px 0; color: #333;">#${orderData.orderNumber}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666; font-weight: bold;">Product:</td>
                <td style="padding: 8px 0; color: #333;">${productTitle}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666; font-weight: bold;">Total Amount:</td>
                <td style="padding: 8px 0; color: #333; font-weight: bold;">${currency} ${Number(orderTotal).toFixed(2)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666; font-weight: bold;">Status:</td>
                <td style="padding: 8px 0;"><span style="background-color: #ffc107; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold;">INITIALIZED</span></td>
              </tr>
            </table>
          </div>
          
          <!-- Next Steps -->
          <div style="background-color: #e3f2fd; padding: 20px; border-radius: 6px; margin-bottom: 25px;">
            <h3 style="color: #1976d2; margin: 0 0 15px 0; font-size: 18px;">🚀 Next Steps</h3>
            <ul style="margin: 0; padding-left: 20px; color: #333; line-height: 1.6;">
              <li>Complete your payment</li>
              <li>We'll process your order once payment is confirmed</li>
              <li>You'll receive delivery notification soon after</li>
            </ul>
          </div>
          
          <!-- CTA Button -->
          <div style="text-align: center; margin: 30px 0;">
            <a href="${orderStatusUrl}" style="background-color: #1976d2; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">📊 Track Your Order</a>
          </div>
          
          <!-- Support Info -->
          <div style="border-top: 1px solid #eee; padding-top: 20px; text-align: center;">
            <p style="color: #666; font-size: 14px; margin: 0 0 10px 0;">Need help? Contact our support team</p>
            <p style="color: #1976d2; font-size: 14px; margin: 0;">📧 support@zelyx.shop | 📞 +1 (555) 123-4567</p>
          </div>
          
          <!-- Footer -->
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="color: #999; font-size: 12px; margin: 0;">Thank you for choosing Zelyx Digital Services</p>
            <p style="color: #999; font-size: 12px; margin: 5px 0 0 0;">This is an automated message, please do not reply to this email.</p>
          </div>
        </div>
      </div>
    `;
  }

module.exports = CustomerNotificationService;
