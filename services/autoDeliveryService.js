const Order = require("../models/Order");
const Product = require("../models/Product");
const Inventory = require("../models/Inventory");
const InventoryAssignment = require("../models/InventoryAssignment");
const DeliveryLog = require("../models/DeliveryLog");
const NotificationService = require("./notificationService");
const CustomerNotificationService = require("./customerNotificationService");
const nodemailer = require("nodemailer");

// Email transporter configuration
const createTransporter = () => {
  return nodemailer.createTransporter({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// Auto-delivery service
class AutoDeliveryService {
  // Helper method to get accurate available inventory count for a product
  static async getAvailableInventoryCount(productId) {
    const result = await Inventory.aggregate([
      {
        $match: {
          product: productId,
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

    return result[0]?.availableCount || 0;
  }
  static async processAutoDelivery(orderId, isRetry = false, retryCount = 0) {
    const startTime = Date.now();
    try {
      const order = await Order.findById(orderId).populate("items.product");

      if (!order) {
        throw new Error("Order not found");
      }

      if (
        order.paymentStatus !== "confirmed" &&
        order.paymentStatus !== "paid"
      ) {
        console.log(
          `Order ${order.orderNumber} payment not confirmed yet. Status: ${order.paymentStatus}`
        );
        return {
          success: false,
          message: "Payment not confirmed",
          orderNumber: order.orderNumber,
        };
      }

      // Check if auto-delivery is enabled for this order
      if (!order.autoDeliveryEnabled) {
        console.log(
          `Auto-delivery is disabled for order ${order.orderNumber}. Skipping auto-delivery.`
        );
        return {
          success: false,
          message: "Auto-delivery disabled for this order",
          orderNumber: order.orderNumber,
          requiresManualDelivery: true,
        };
      }

      console.log(`Processing auto-delivery for order ${order.orderNumber}`);

      // Update order status to processing when auto-delivery starts
      if (order.status === "confirmed" || order.status === "pending") {
        order.status = "processing";
        await order.save();
        console.log(`Order ${order.orderNumber} status updated to processing`);
      }

      // Log delivery process start
      await DeliveryLog.logDeliveryEvent({
        orderId: order._id,
        orderNumber: order.orderNumber,
        productId: order.items[0]?.product?._id,
        productTitle: order.items[0]?.product?.title || "Multiple Products",
        eventType: isRetry ? "delivery_retry" : "delivery_started",
        status: "info",
        message: isRetry
          ? `Auto-delivery retry attempt ${retryCount + 1} for order ${
              order.orderNumber
            }`
          : `Auto-delivery process started for order ${order.orderNumber}`,
        customerEmail: order.customer.email,
        quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
        processingTime: 0,
        retryCount: retryCount,
      });

      const deliveryResults = [];

      for (const item of order.items) {
        const product = item.product;

        // Check if product has auto-delivery enabled and item is not already delivered
        if (
          product &&
          product.autoDelivery &&
          item.deliveryStatus !== "delivered"
        ) {
          // Set autoDelivery flag on order item
          item.autoDelivery = true;
          try {
            // Handle quantity-based delivery
            const requiredQuantity = item.quantity;
            const deliveredCredentials = [];

            // Find available inventory for this product using assignment-based system
            const availableInventory = await Inventory.aggregate([
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
                $limit: requiredQuantity,
              },
            ]);

            if (availableInventory.length >= requiredQuantity) {
              // Process each inventory item for the required quantity
              for (let i = 0; i < requiredQuantity; i++) {
                const inventoryItem = availableInventory[i];

                // Create assignment record
                await InventoryAssignment.create({
                  inventory: inventoryItem._id,
                  order: order._id,
                  orderNumber: order.orderNumber,
                  customerEmail: order.customer.email,
                  customerName: `${order.customer.firstName} ${order.customer.lastName}`,
                  assignedAt: new Date(),
                  status: "active",
                  notes: `Auto-delivered for order ${order.orderNumber} (${
                    i + 1
                  }/${requiredQuantity})`,
                });

                // Update inventory item with delivery information
                const inventoryDoc = await Inventory.findById(
                  inventoryItem._id
                );
                inventoryDoc.deliveredAt = new Date();

                // Increment assignment count
                const newAssignmentCount =
                  (inventoryDoc.assignmentCount || 0) + 1;
                inventoryDoc.assignmentCount = newAssignmentCount;
                inventoryDoc.usedBy = order._id;

                // Only mark as used and delivered if assignment count reaches max
                if (newAssignmentCount >= inventoryItem.maxAssignments) {
                  inventoryDoc.isUsed = true;
                  inventoryDoc.status = "delivered";
                }
                await inventoryDoc.save();

                deliveredCredentials.push(inventoryItem.accountCredentials);
              }

              // Add delivered inventory items to order's deliveredInventory array
              const deliveredInventoryIds = availableInventory
                .slice(0, requiredQuantity)
                .map((inv) => inv._id);

              // Add to order's deliveredInventory array if not already present
              for (const inventoryId of deliveredInventoryIds) {
                if (!order.deliveredInventory.includes(inventoryId)) {
                  order.deliveredInventory.push(inventoryId);
                }
              }

              // Update order item with all credentials
              item.delivered = true;
              item.deliveryStatus = "delivered";
              item.deliveredAt = new Date();
              item.accountCredentials = deliveredCredentials.join(
                "\n\n--- Next Account ---\n\n"
              );
              item.credentials = deliveredCredentials.join(
                "\n\n--- Next Account ---\n\n"
              );

              // Send delivery email with all credentials
              await this.sendDeliveryEmail(order, item, deliveredCredentials);

              // Log successful delivery
              await DeliveryLog.logDeliveryEvent({
                orderId: order._id,
                orderNumber: order.orderNumber,
                productId: product._id,
                productTitle: product.title,
                eventType: "delivery_success",
                status: "success",
                message: `Successfully delivered ${requiredQuantity}x ${product.title}`,
                customerEmail: order.customer.email,
                quantity: requiredQuantity,
                inventoryUsed: requiredQuantity,
                processingTime: Date.now() - startTime,
                details: {
                  credentialsDelivered: deliveredCredentials.length,
                  inventoryIds: availableInventory
                    .slice(0, requiredQuantity)
                    .map((inv) => inv._id),
                },
              });

              deliveryResults.push({
                productId: product._id,
                productTitle: product.title,
                status: "delivered",
                quantity: requiredQuantity,
                inventoryIds: availableInventory
                  .slice(0, requiredQuantity)
                  .map((inv) => inv._id),
              });

              console.log(
                `Auto-delivered ${requiredQuantity}x ${product.title} for order ${order.orderNumber}`
              );
            } else {
              // Set delivery status to failed due to insufficient inventory
              item.deliveryStatus = "failed";

              // Get accurate available count for logging
              const actualAvailableCount =
                await this.getAvailableInventoryCount(product._id);

              // Log insufficient inventory error
              await DeliveryLog.logDeliveryEvent({
                orderId: order._id,
                orderNumber: order.orderNumber,
                productId: product._id,
                productTitle: product.title,
                eventType: "insufficient_inventory",
                status: "error",
                message: `Insufficient inventory: need ${requiredQuantity}, have ${actualAvailableCount}`,
                customerEmail: order.customer.email,
                quantity: requiredQuantity,
                inventoryUsed: 0,
                processingTime: Date.now() - startTime,
                errorCode: "INSUFFICIENT_INVENTORY",
                retryCount: retryCount,
                details: {
                  required: requiredQuantity,
                  available: actualAvailableCount,
                  foundInQuery: availableInventory.length,
                },
              });

              // Send admin notification for inventory shortage
              if (retryCount === 0) {
                // Only send on first failure, not retries
                await NotificationService.sendAdminAlert("DELIVERY_FAILURE", {
                  orderNumber: order.orderNumber,
                  customerEmail: order.customer.email,
                  productTitle: product.title,
                  quantity: requiredQuantity,
                  errorMessage: `Insufficient inventory: need ${requiredQuantity}, have ${actualAvailableCount}`,
                  errorCode: "INSUFFICIENT_INVENTORY",
                  retryCount,
                });
              }

              deliveryResults.push({
                productId: product._id,
                productTitle: product.title,
                status: "insufficient_inventory",
                required: requiredQuantity,
                available: actualAvailableCount,
                message: `Insufficient inventory: need ${requiredQuantity}, have ${actualAvailableCount}`,
              });

              console.log(
                `Insufficient inventory for ${product.title} in order ${order.orderNumber}: need ${requiredQuantity}, have ${actualAvailableCount}`
              );
            }
          } catch (error) {
            // Set delivery status to failed due to error
            item.deliveryStatus = "failed";

            // Log delivery error
            await DeliveryLog.logDeliveryEvent({
              orderId: order._id,
              orderNumber: order.orderNumber,
              productId: product._id,
              productTitle: product.title,
              eventType: "delivery_failed",
              status: "error",
              message: `Delivery failed: ${error.message}`,
              customerEmail: order.customer.email,
              quantity: item.quantity,
              inventoryUsed: 0,
              processingTime: Date.now() - startTime,
              errorCode: "DELIVERY_ERROR",
              retryCount: retryCount,
              details: {
                error: error.message,
                stack: error.stack,
              },
            });

            // Send admin notification for delivery error
            if (retryCount === 0) {
              // Only send on first failure, not retries
              await NotificationService.sendAdminAlert("DELIVERY_FAILURE", {
                orderNumber: order.orderNumber,
                customerEmail: order.customer.email,
                productTitle: product.title,
                quantity: item.quantity,
                errorMessage: error.message,
                errorCode: "DELIVERY_ERROR",
                retryCount,
              });
            }

            deliveryResults.push({
              productId: product._id,
              productTitle: product.title,
              status: "error",
              error: error.message,
            });

            console.error(
              `Error delivering ${product.title} for order ${order.orderNumber}:`,
              error
            );
          }
        } else if (item.deliveryStatus === "delivered" || item.delivered) {
          // Item already delivered
          deliveryResults.push({
            productId: product._id,
            productTitle: product.title,
            status: "already_delivered",
          });
        } else if (!product?.autoDelivery) {
          // Product doesn't have auto-delivery enabled
          deliveryResults.push({
            productId: product._id,
            productTitle: product.title,
            status: "manual_delivery_required",
            message: "Auto-delivery not enabled for this product",
          });
        }
      }

      // Save order with updated delivery status
      await order.save();

      // Check if all items are delivered
      const allDelivered = order.items.every(
        (item) =>
          item.deliveryStatus === "delivered" ||
          item.delivered ||
          !item.product?.autoDelivery
      );

      // Check if any auto-delivery items are still pending
      const hasAutoDeliveryItems = order.items.some(
        (item) => item.product?.autoDelivery
      );

      const hasPendingAutoDelivery = order.items.some(
        (item) =>
          item.product?.autoDelivery &&
          item.deliveryStatus !== "delivered" &&
          !item.delivered
      );

      if (allDelivered && hasAutoDeliveryItems) {
        order.status = "delivered";
        order.deliveryInfo.deliveredAt = new Date();
        order.deliveryInfo.method = "auto";
        await order.save();
        console.log(`Order ${order.orderNumber} status updated to delivered`);

        // Generate access token for OTP service after successful delivery
        try {
          await this.generateAccessTokenForOrder(order);
        } catch (tokenError) {
          console.error("Failed to generate access token:", tokenError);
          // Don't fail the delivery if token generation fails
        }

        // Send order completion notification to customer
        try {
          await CustomerNotificationService.sendOrderStatusUpdateEmail(order, {
            status: "delivered",
            message:
              "Your order has been completed and all items have been delivered successfully.",
          });
        } catch (emailError) {
          console.error("Failed to send order completion email:", emailError);
        }
      } else if (
        hasAutoDeliveryItems &&
        !hasPendingAutoDelivery &&
        order.status !== "delivered"
      ) {
        // All auto-delivery items processed, but some might have failed
        const hasFailedItems = order.items.some(
          (item) =>
            item.product?.autoDelivery && item.deliveryStatus === "failed"
        );

        if (hasFailedItems) {
          console.log(
            `Order ${order.orderNumber} has failed delivery items, keeping in processing status`
          );
        }
      }

      return {
        success: true,
        orderNumber: order.orderNumber,
        deliveryResults,
      };
    } catch (error) {
      console.error("Auto-delivery error:", error);
      throw error;
    }
  }

  static async sendDeliveryEmail(order, item, credentials) {
    try {
      const transporter = createTransporter();

      // Handle both single credential (legacy) and multiple credentials (new)
      const credentialsText = Array.isArray(credentials)
        ? credentials
            .map(
              (cred, index) => `
            <div style="background-color: white; padding: 15px; border-radius: 4px; font-family: monospace; white-space: pre-wrap; margin-bottom: 15px;">
              <h4 style="margin-top: 0; color: #1976d2;">Account ${
                index + 1
              }:</h4>
              ${cred}
            </div>
          `
            )
            .join("")
        : `<div style="background-color: white; padding: 15px; border-radius: 4px; font-family: monospace; white-space: pre-wrap;">${
            credentials.accountCredentials || credentials
          }</div>`;

      const quantityText =
        Array.isArray(credentials) && credentials.length > 1
          ? `<p><strong>Quantity:</strong> ${credentials.length} accounts</p>`
          : "";

      const emailContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1976d2;">Your Digital Product is Ready!</h2>
          
          <p>Dear ${order.customer.firstName || "Customer"},</p>
          
          <p>Thank you for your purchase! Your digital product has been automatically delivered.</p>
          
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Order Details:</h3>
            <p><strong>Order Number:</strong> ${order.orderNumber}</p>
            <p><strong>Product:</strong> ${item.title}</p>
            <p><strong>Service Type:</strong> ${item.serviceType}</p>
            <p><strong>Duration:</strong> ${item.duration}</p>
            ${quantityText}
          </div>
          
          <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4caf50;">
            <h3 style="margin-top: 0; color: #2e7d32;">Your Account Credentials:</h3>
            ${credentialsText}
          </div>
          
          <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
            <h4 style="margin-top: 0; color: #856404;">Important Notes:</h4>
            <ul style="margin: 0; padding-left: 20px;">
              <li>Please save these credentials in a secure location</li>
              <li>Do not share these credentials with others</li>
              <li>Contact support if you experience any issues</li>
              <li>This service is valid for the duration specified above</li>
              ${
                Array.isArray(credentials) && credentials.length > 1
                  ? "<li>You have received multiple accounts as per your order quantity</li>"
                  : ""
              }
            </ul>
          </div>
          
          <div style="background-color: #e3f2fd; padding: 20px; border-radius: 6px; margin: 20px 0;">
            <h3 style="color: #1976d2; margin: 0 0 15px 0; font-size: 18px;">📍 Tracking Information</h3>
            <p style="margin: 0;">Track your order status using this link:</p>
            <a href="${process.env.CLIENT_URL || "http://localhost:3000"}/order-status/${order.orderNumber}" style="background-color: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 10px;">Track Order</a>
          </div>
          <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
          
          <p>Best regards,<br>Zelyx Team</p>
          
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
          <p style="font-size: 12px; color: #666;">This is an automated email. Please do not reply to this message.</p>
        </div>
      `;

      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@zelyx.shop",
        to: order.customer.email,
        subject: `Your ${item.title} is Ready - Order ${order.orderNumber}`,
        html: emailContent,
      };

      await transporter.sendMail(mailOptions);
      console.log(
        `Delivery email sent to ${order.customer.email} for order ${order.orderNumber}`
      );

      // Log successful email delivery
      await DeliveryLog.logDeliveryEvent({
        orderId: order._id,
        orderNumber: order.orderNumber,
        productId: item.product._id,
        productTitle: item.product.title,
        eventType: "email_sent",
        status: "success",
        message: `Delivery email sent successfully to ${order.customer.email}`,
        customerEmail: order.customer.email,
        quantity: item.quantity,
        details: {
          emailTo: order.customer.email,
          subject: mailOptions.subject,
          credentialsCount: Array.isArray(credentials) ? credentials.length : 1,
        },
      });
    } catch (error) {
      console.error("Error sending delivery email:", error);

      // Log email sending failure
      await DeliveryLog.logDeliveryEvent({
        orderId: order._id,
        orderNumber: order.orderNumber,
        productId: item.product._id,
        productTitle: item.product.title,
        eventType: "email_failed",
        status: "error",
        message: `Failed to send delivery email: ${error.message}`,
        customerEmail: order.customer.email,
        quantity: item.quantity,
        errorCode: "EMAIL_SEND_FAILED",
        details: {
          error: error.message,
          emailTo: order.customer.email,
        },
      });

      // Send admin notification for email failure
      await NotificationService.sendAdminAlert("EMAIL_SERVICE_DOWN", {
        error: error.message,
        failedAttempts: 1,
        lastAttempt: new Date(),
      });

      // Don't throw error here as delivery was successful, just email failed
    }
  }

  static async checkPendingDeliveries() {
    try {
      console.log("Checking for pending deliveries...");

      // Find orders with paid status that have undelivered auto-delivery items
      const orders = await Order.find({
        paymentStatus: "paid",
        $or: [
          { "items.delivered": false },
          { "items.deliveryStatus": "pending" },
        ],
      }).populate("items.product");

      // Filter and sort orders by priority
      const ordersWithAutoDelivery = orders.filter((order) =>
        order.items.some(
          (item) =>
            item.product?.autoDelivery &&
            (item.deliveryStatus === "pending" || !item.delivered)
        )
      );

      // Sort orders by highest priority products first (lower number = higher priority)
      ordersWithAutoDelivery.sort((a, b) => {
        const aMinPriority = Math.min(
          ...a.items
            .filter(
              (item) =>
                item.product?.autoDelivery &&
                (item.deliveryStatus === "pending" || !item.delivered)
            )
            .map((item) => item.product?.deliveryPriority || 5)
        );
        const bMinPriority = Math.min(
          ...b.items
            .filter(
              (item) =>
                item.product?.autoDelivery &&
                (item.deliveryStatus === "pending" || !item.delivered)
            )
            .map((item) => item.product?.deliveryPriority || 5)
        );
        return aMinPriority - bMinPriority;
      });

      console.log(
        `Found ${ordersWithAutoDelivery.length} orders with auto-delivery items, processing by priority...`
      );

      const results = [];
      let processedCount = 0;

      for (const order of ordersWithAutoDelivery) {
        try {
          const result = await this.processAutoDelivery(order._id);
          results.push(result);
          processedCount++;
        } catch (error) {
          console.error(
            `Failed to process auto-delivery for order ${order.orderNumber}:`,
            error
          );
          results.push({
            success: false,
            orderNumber: order.orderNumber,
            error: error.message,
          });
        }
      }

      console.log(
        `Pending delivery check completed. Processed ${processedCount} orders out of ${orders.length} total orders.`
      );
      return {
        success: true,
        totalOrders: orders.length,
        processedOrders: processedCount,
        results,
      };
    } catch (error) {
      console.error("Error checking pending deliveries:", error);
      throw error;
    }
  }

  // Method to start periodic checking for pending deliveries
  static startPeriodicCheck(intervalMinutes = 5) {
    console.log(
      `Starting periodic delivery check every ${intervalMinutes} minutes`
    );

    // Run immediately
    this.checkPendingDeliveries().catch((error) => {
      console.error("Initial delivery check failed:", error);
    });

    // Set up periodic checking
    const intervalMs = intervalMinutes * 60 * 1000;
    return setInterval(() => {
      // Check for new pending deliveries
      this.checkPendingDeliveries().catch((error) => {
        console.error("Periodic delivery check failed:", error);
      });

      // Check for failed deliveries to retry
      this.retryFailedDeliveries().catch((error) => {
        console.error("Retry failed deliveries check failed:", error);
      });

      // Check inventory levels
      this.checkInventoryLevels().catch((error) => {
        console.error("Inventory level check failed:", error);
      });

      // Check for pending admin alerts
      NotificationService.checkAndSendAlerts().catch((error) => {
        console.error("Check pending alerts failed:", error);
      });
    }, intervalMs);
  }

  static async retryFailedDeliveries() {
    try {
      console.log("Checking for failed deliveries to retry...");

      // Find failed delivery logs that haven't exceeded max retry attempts
      const failedLogs = await DeliveryLog.find({
        status: "error",
        isResolved: false,
        retryCount: { $lt: 3 }, // Max 3 retry attempts
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Only retry within 24 hours
      }).sort({ createdAt: -1 });

      const results = [];

      for (const log of failedLogs) {
        try {
          // Calculate retry delay (exponential backoff: 5min, 15min, 45min)
          const retryDelays = [5, 15, 45]; // minutes
          const delayMinutes = retryDelays[log.retryCount] || 45;
          const retryTime = new Date(
            log.createdAt.getTime() + delayMinutes * 60 * 1000
          );

          if (new Date() >= retryTime) {
            console.log(
              `Retrying delivery for order ${log.orderId}, attempt ${
                log.retryCount + 1
              }`
            );

            const result = await this.processAutoDelivery(
              log.orderId,
              true,
              log.retryCount
            );
            results.push({
              orderId: log.orderId,
              retryAttempt: log.retryCount + 1,
              result,
            });
          }
        } catch (error) {
          console.error(
            `Failed to retry delivery for order ${log.orderId}:`,
            error
          );
        }
      }

      return {
        success: true,
        retriedCount: results.length,
        results,
      };
    } catch (error) {
      console.error("Error in retryFailedDeliveries:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Method to get delivery statistics
  static async getDeliveryStats() {
    try {
      const stats = await Order.aggregate([
        {
          $match: {
            "items.product": { $exists: true },
          },
        },
        {
          $unwind: "$items",
        },
        {
          $lookup: {
            from: "products",
            localField: "items.product",
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
            _id: null,
            totalAutoDeliveryItems: { $sum: "$items.quantity" },
            deliveredItems: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ["$items.deliveryStatus", "delivered"] },
                      { $eq: ["$items.delivered", true] },
                    ],
                  },
                  "$items.quantity",
                  0,
                ],
              },
            },
            pendingItems: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ["$items.deliveryStatus", "pending"] },
                      { $eq: ["$items.delivered", false] },
                    ],
                  },
                  "$items.quantity",
                  0,
                ],
              },
            },
          },
        },
      ]);

      const deliveryStats = stats[0] || {
        totalAutoDeliveryItems: 0,
        deliveredItems: 0,
        pendingItems: 0,
      };

      // Get inventory statistics with assignment tracking
      const inventoryStats = await Inventory.aggregate([
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
          $lookup: {
            from: "inventoryassignments",
            localField: "_id",
            foreignField: "inventory",
            as: "assignments",
          },
        },
        {
          $addFields: {
            isAssigned: {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: "$assignments",
                      cond: { $eq: ["$$this.status", "active"] },
                    },
                  },
                },
                0,
              ],
            },
          },
        },
        {
          $addFields: {
            remainingAssignments: {
              $subtract: [
                "$maxAssignments",
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
          $group: {
            _id: "$product",
            productTitle: { $first: "$productInfo.title" },
            totalInventory: { $sum: 1 },
            availableInventory: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$status", "available"] },
                      { $gt: ["$remainingAssignments", 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            reservedInventory: {
              $sum: {
                $cond: [{ $eq: ["$status", "reserved"] }, 1, 0],
              },
            },
            assignedInventory: {
              $sum: {
                $cond: [{ $eq: ["$isAssigned", true] }, 1, 0],
              },
            },
            totalRemainingAssignments: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$status", "available"] },
                      { $gt: ["$remainingAssignments", 0] },
                    ],
                  },
                  "$remainingAssignments",
                  0,
                ],
              },
            },
          },
        },
      ]);

      return {
        success: true,
        deliveryStats,
        inventoryStats,
      };
    } catch (error) {
      console.error("Error getting delivery stats:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Monitor inventory levels and send alerts for low stock
  static async checkInventoryLevels() {
    try {
      console.log("Checking inventory levels...");

      const lowStockThreshold = parseInt(process.env.LOW_STOCK_THRESHOLD) || 5;

      // Get inventory levels for auto-delivery products with assignment tracking
      const inventoryLevels = await Inventory.aggregate([
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
          $lookup: {
            from: "inventoryassignments",
            localField: "_id",
            foreignField: "inventory",
            as: "assignments",
          },
        },
        {
          $addFields: {
            isAssigned: {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: "$assignments",
                      cond: { $eq: ["$$this.status", "active"] },
                    },
                  },
                },
                0,
              ],
            },
          },
        },
        {
          $addFields: {
            remainingAssignments: {
              $subtract: [
                "$maxAssignments",
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
          $group: {
            _id: "$product",
            productTitle: { $first: "$productInfo.title" },
            availableCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$status", "available"] },
                      { $gt: ["$remainingAssignments", 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            totalCount: { $sum: 1 },
            totalRemainingAssignments: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$status", "available"] },
                      { $gt: ["$remainingAssignments", 0] },
                    ],
                  },
                  "$remainingAssignments",
                  0,
                ],
              },
            },
          },
        },
        {
          $match: {
            availableCount: { $lte: lowStockThreshold },
          },
        },
      ]);

      // Get pending orders count for each low-stock product
      for (const product of inventoryLevels) {
        const pendingOrders = await Order.aggregate([
          {
            $match: {
              paymentStatus: "paid",
              "items.product": product._id,
              $or: [
                { "items.delivered": false },
                { "items.deliveryStatus": "pending" },
              ],
            },
          },
          {
            $unwind: "$items",
          },
          {
            $match: {
              "items.product": product._id,
              $or: [
                { "items.delivered": false },
                { "items.deliveryStatus": "pending" },
              ],
            },
          },
          {
            $group: {
              _id: null,
              totalPending: { $sum: "$items.quantity" },
            },
          },
        ]);

        const pendingCount = pendingOrders[0]?.totalPending || 0;

        // Send alert if stock is critically low
        if (
          product.availableCount <= Math.max(1, lowStockThreshold / 2) ||
          product.availableCount < pendingCount
        ) {
          await NotificationService.sendAdminAlert("INVENTORY_LOW", {
            productTitle: product.productTitle,
            currentStock: product.availableCount,
            threshold: lowStockThreshold,
            pendingOrders: pendingCount,
          });
        }
      }

      return {
        success: true,
        checkedProducts: inventoryLevels.length,
        lowStockProducts: inventoryLevels.filter(
          (p) => p.availableCount <= lowStockThreshold
        ),
      };
    } catch (error) {
      console.error("Error checking inventory levels:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Generate access token for OTP service after successful order delivery
  static async generateAccessTokenForOrder(
    order,
    maxUsage = 100,
    expirationDays = 30
  ) {
    try {
      const UserAccessToken = require("../models/UserAccessToken");

      // Check if order already has an access token
      const existingToken = await UserAccessToken.findOne({
        orderId: order._id,
      });

      if (existingToken) {
        console.log(
          `Access token already exists for order ${order.orderNumber}`
        );
        return existingToken;
      }

      // Generate new access token
      const crypto = require("crypto");
      const token = crypto.randomBytes(32).toString("hex");

      // Set token expiration based on provided days
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expirationDays);

      // Create access token with configurable usage limits and expiration
      const accessToken = new UserAccessToken({
        token,
        email: order.customerInfo.email,
        orderId: order._id,
        orderNumber: order.orderNumber,
        maxUsage, // Configurable usage limit
        expiresAt,
        isActive: true,
        createdBy: "system", // Auto-generated by system
        description: `Auto-generated for order ${order.orderNumber} - ${maxUsage} uses, expires in ${expirationDays} days`,
        permissions: ["read"], // Default permission for OTP access
        tokenName: `Order-${order.orderNumber}-${Date.now()}`,
      });

      await accessToken.save();

      console.log(
        `Access token generated for order ${order.orderNumber}: ${maxUsage} uses, ${expirationDays} days expiration`
      );

      // TODO: Send access token to customer via email
      // This could be added to the order completion email

      return accessToken;
    } catch (error) {
      console.error("Error generating access token for order:", error);
      throw error;
    }
  }
}

module.exports = AutoDeliveryService;
