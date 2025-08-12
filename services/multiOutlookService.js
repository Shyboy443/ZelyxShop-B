const outlookService = require("./outlookService");
const OutlookAccount = require("../models/OutlookAccount");
const OutlookConfig = require("../models/OutlookConfig");
const Settings = require("../models/Settings");
const Order = require("../models/Order");

class MultiOutlookService {
  constructor() {
    this.syncInProgress = new Set();
    this.syncInterval = null;
  }

  /**
   * Start automatic email synchronization for all active accounts
   */
  async startAutoSync() {
    try {
      const settings = await Settings.findOne();
      if (!settings || !settings.outlookEnabled) {
        console.log("Outlook integration is disabled");
        return;
      }

      // Clear existing interval
      if (this.syncInterval) {
        clearInterval(this.syncInterval);
      }

      // Set up new sync interval (default: 5 minutes)
      const intervalMs = 5 * 60 * 1000; // 5 minutes
      this.syncInterval = setInterval(() => {
        this.syncAllAccounts().catch((error) => {
          console.error("Error in auto sync:", error.message);
        });
      }, intervalMs);

      console.log("Auto sync started for Outlook accounts");

      // Run initial sync
      await this.syncAllAccounts();
    } catch (error) {
      console.error("Error starting auto sync:", error.message);
    }
  }

  /**
   * Stop automatic email synchronization
   */
  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log("Auto sync stopped for Outlook accounts");
    }
  }

  /**
   * Sync emails for all active Outlook accounts
   */
  async syncAllAccounts() {
    try {
      const activeAccounts = await OutlookAccount.find({
        isActive: true,
        syncStatus: { $ne: "syncing" },
      });

      if (activeAccounts.length === 0) {
        console.log("No active Outlook accounts found for sync");
        return { totalAccounts: 0, results: [] };
      }

      console.log(
        `Starting sync for ${activeAccounts.length} Outlook accounts`
      );

      const results = [];

      // Process accounts in parallel with concurrency limit
      const concurrencyLimit = 3;
      for (let i = 0; i < activeAccounts.length; i += concurrencyLimit) {
        const batch = activeAccounts.slice(i, i + concurrencyLimit);
        const batchPromises = batch.map((account) =>
          this.syncSingleAccount(account)
        );
        const batchResults = await Promise.allSettled(batchPromises);

        batchResults.forEach((result, index) => {
          const account = batch[index];
          if (result.status === "fulfilled") {
            results.push({
              accountId: account._id,
              email: account.email,
              success: true,
              ...result.value,
            });
          } else {
            results.push({
              accountId: account._id,
              email: account.email,
              success: false,
              error: result.reason.message,
            });
          }
        });
      }

      const successCount = results.filter((r) => r.success).length;
      console.log(
        `Sync completed: ${successCount}/${activeAccounts.length} accounts successful`
      );

      return {
        totalAccounts: activeAccounts.length,
        successfulAccounts: successCount,
        results,
      };
    } catch (error) {
      console.error("Error syncing all accounts:", error.message);
      throw error;
    }
  }

  /**
   * Sync emails for a single account
   */
  async syncSingleAccount(account) {
    const accountId = account._id.toString();

    // Prevent concurrent syncing of the same account
    if (this.syncInProgress.has(accountId)) {
      throw new Error("Sync already in progress for this account");
    }

    this.syncInProgress.add(accountId);

    try {
      const result = await outlookService.syncAccountEmails(account._id);

      // Process potential orders
      if (result.potentialOrders && result.potentialOrders.length > 0) {
        await this.processPotentialOrders(result.potentialOrders, account);
      }

      return result;
    } finally {
      this.syncInProgress.delete(accountId);
    }
  }

  /**
   * Process potential orders found in emails
   */
  async processPotentialOrders(potentialOrders, account) {
    try {
      for (const potentialOrder of potentialOrders) {
        await this.matchOrderWithEmail(potentialOrder, account);
      }
    } catch (error) {
      console.error("Error processing potential orders:", error.message);
    }
  }

  /**
   * Match potential order with existing orders in database
   */
  async matchOrderWithEmail(potentialOrder, account) {
    try {
      const { orderInfo } = potentialOrder;

      if (!orderInfo) return;

      // Try to find matching order by order number
      let matchedOrder = null;

      if (orderInfo.orderNumber) {
        matchedOrder = await Order.findOne({
          orderNumber: { $regex: new RegExp(orderInfo.orderNumber, "i") },
        });
      }

      // If not found by order number, try by customer email and amount
      if (!matchedOrder && orderInfo.customerEmail && orderInfo.amount) {
        matchedOrder = await Order.findOne({
          "customer.email": orderInfo.customerEmail,
          total: { $gte: orderInfo.amount - 1, $lte: orderInfo.amount + 1 }, // Allow small variance
          paymentStatus: { $in: ["pending", "processing"] },
        });
      }

      if (matchedOrder) {
        // Update order with email verification info
        await this.updateOrderWithEmailVerification(
          matchedOrder,
          potentialOrder,
          account
        );
        console.log(
          `Order ${matchedOrder.orderNumber} matched with email from ${account.email}`
        );
      } else {
        console.log(
          `No matching order found for potential order from ${account.email}`
        );
      }
    } catch (error) {
      console.error("Error matching order with email:", error.message);
    }
  }

  /**
   * Update order with email verification information
   */
  async updateOrderWithEmailVerification(order, potentialOrder, account) {
    try {
      const emailVerification = {
        verified: true,
        verifiedAt: new Date(),
        verificationSource: "outlook_email",
        emailId: potentialOrder.emailId,
        accountEmail: account.email,
        confidence: potentialOrder.orderInfo.confidence,
        extractedInfo: potentialOrder.orderInfo,
      };

      // Add email verification to order
      if (!order.emailVerification) {
        order.emailVerification = emailVerification;
      } else {
        // Update existing verification if confidence is higher
        if (emailVerification.confidence > order.emailVerification.confidence) {
          order.emailVerification = emailVerification;
        }
      }

      // If order was pending payment and we have high confidence, mark as verified
      if (
        order.paymentStatus === "pending" &&
        emailVerification.confidence >= 70
      ) {
        order.paymentStatus = "verified";
        order.paymentVerifiedAt = new Date();
        order.notes =
          (order.notes || "") +
          `\n\nPayment verified via email from ${account.email} (Confidence: ${emailVerification.confidence}%)`;
      }

      await order.save();

      console.log(
        `Order ${order.orderNumber} updated with email verification (Confidence: ${emailVerification.confidence}%)`
      );
    } catch (error) {
      console.error(
        "Error updating order with email verification:",
        error.message
      );
    }
  }

  /**
   * Get sync status for all accounts
   */
  async getSyncStatus() {
    try {
      const accounts = await OutlookAccount.find(
        {},
        {
          email: 1,
          isActive: 1,
          syncStatus: 1,
          lastSyncAt: 1,
          errorMessage: 1,
          statistics: 1,
        }
      ).sort({ email: 1 });

      const totalAccounts = accounts.length;
      const activeAccounts = accounts.filter((acc) => acc.isActive).length;
      const syncingAccounts = accounts.filter(
        (acc) => acc.syncStatus === "syncing"
      ).length;
      const errorAccounts = accounts.filter(
        (acc) => acc.syncStatus === "error"
      ).length;

      return {
        totalAccounts,
        activeAccounts,
        syncingAccounts,
        errorAccounts,
        autoSyncEnabled: !!this.syncInterval,
        accounts: accounts.map((acc) => ({
          id: acc._id,
          email: acc.email,
          isActive: acc.isActive,
          syncStatus: acc.syncStatus,
          lastSyncAt: acc.lastSyncAt,
          errorMessage: acc.errorMessage,
          statistics: acc.statistics,
        })),
      };
    } catch (error) {
      console.error("Error getting sync status:", error.message);
      throw error;
    }
  }

  /**
   * Force sync for a specific account
   */
  async forceSyncAccount(accountId) {
    try {
      const account = await OutlookAccount.findById(accountId);
      if (!account) {
        throw new Error("Account not found");
      }

      if (!account.isActive) {
        throw new Error("Account is not active");
      }

      return await this.syncSingleAccount(account);
    } catch (error) {
      console.error("Error force syncing account:", error.message);
      throw error;
    }
  }

  /**
   * Test email connectivity for an account
   */
  async testAccountConnectivity(accountId) {
    try {
      const account = await OutlookAccount.findById(accountId);
      if (!account) {
        throw new Error("Account not found");
      }

      // Check if token is expired and refresh if needed
      if (account.isTokenExpired()) {
        await outlookService.refreshAccountToken(account);
        await account.reload();
      }

      // Try to get user profile
      const profile = await outlookService.getUserProfile(account.accessToken);

      return {
        success: true,
        profile: {
          displayName: profile.displayName,
          email: profile.mail || profile.userPrincipalName,
          id: profile.id,
        },
        tokenExpiry: account.tokenExpiresAt,
      };
    } catch (error) {
      console.error("Error testing account connectivity:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get email statistics across all accounts
   */
  async getEmailStatistics() {
    try {
      const accounts = await OutlookAccount.find({ isActive: true });

      const stats = {
        totalAccounts: accounts.length,
        totalEmailsProcessed: 0,
        totalOrdersFound: 0,
        lastSyncAt: null,
        accountStats: [],
      };

      for (const account of accounts) {
        stats.totalEmailsProcessed += account.statistics.totalEmailsProcessed;
        stats.totalOrdersFound += account.statistics.totalOrdersFound;

        if (
          account.lastSyncAt &&
          (!stats.lastSyncAt || account.lastSyncAt > stats.lastSyncAt)
        ) {
          stats.lastSyncAt = account.lastSyncAt;
        }

        stats.accountStats.push({
          email: account.email,
          emailsProcessed: account.statistics.totalEmailsProcessed,
          ordersFound: account.statistics.totalOrdersFound,
          lastSync: account.lastSyncAt,
          status: account.syncStatus,
        });
      }

      return stats;
    } catch (error) {
      console.error("Error getting email statistics:", error.message);
      throw error;
    }
  }
}

module.exports = new MultiOutlookService();
