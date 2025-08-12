const axios = require("axios");
const OutlookAccount = require("../models/OutlookAccount");
const OutlookConfig = require("../models/OutlookConfig");
const Order = require("../models/Order");
const Settings = require("../models/Settings");

class OutlookService {
  constructor() {
    this.graphApiUrl = "https://graph.microsoft.com/v1.0";
    this.authUrl = "https://login.microsoftonline.com";
  }

  /**
   * Get authorization URL for OAuth flow
   */
  getAuthUrl(tenantId, clientId, redirectUri, state = "") {
    const scopes = [
      "https://graph.microsoft.com/Mail.Read",
      "https://graph.microsoft.com/Mail.Send",
      "https://graph.microsoft.com/User.Read",
      "offline_access",
    ].join(" ");

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: scopes,
      state: state,
      response_mode: "query",
    });

    return `${
      this.authUrl
    }/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(
    code,
    tenantId,
    clientId,
    clientSecret,
    redirectUri
  ) {
    try {
      const tokenUrl = `${this.authUrl}/${tenantId}/oauth2/v2.0/token`;

      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });

      const response = await axios.post(tokenUrl, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      return response.data;
    } catch (error) {
      console.error(
        "Error exchanging code for token:",
        error.response?.data || error.message
      );
      throw new Error("Failed to exchange authorization code for token");
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken, tenantId, clientId, clientSecret) {
    try {
      const tokenUrl = `${this.authUrl}/${tenantId}/oauth2/v2.0/token`;

      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });

      const response = await axios.post(tokenUrl, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      return response.data;
    } catch (error) {
      console.error(
        "Error refreshing token:",
        error.response?.data || error.message
      );
      throw new Error("Failed to refresh access token");
    }
  }

  /**
   * Get user profile information
   */
  async getUserProfile(accessToken) {
    try {
      const response = await axios.get(`${this.graphApiUrl}/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });

      return response.data;
    } catch (error) {
      console.error(
        "Error getting user profile:",
        error.response?.data || error.message
      );
      throw new Error("Failed to get user profile");
    }
  }

  /**
   * Search emails for payment receipts
   */
  async searchEmails(accessToken, keywords = [], maxEmails = 50) {
    try {
      // Build search query
      const searchTerms =
        keywords.length > 0 ? keywords : ["payment", "receipt", "order"];
      const searchQuery = searchTerms.map((term) => `"${term}"`).join(" OR ");

      const params = new URLSearchParams({
        $search: searchQuery,
        $top: maxEmails.toString(),
        $orderby: "receivedDateTime desc",
        $select: "id,subject,from,receivedDateTime,bodyPreview,hasAttachments",
      });

      const response = await axios.get(
        `${this.graphApiUrl}/me/messages?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      return response.data.value || [];
    } catch (error) {
      console.error(
        "Error searching emails:",
        error.response?.data || error.message
      );
      throw new Error("Failed to search emails");
    }
  }

  /**
   * Get email details including attachments
   */
  async getEmailDetails(accessToken, messageId) {
    try {
      const response = await axios.get(
        `${this.graphApiUrl}/me/messages/${messageId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          params: {
            $expand: "attachments",
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error(
        "Error getting email details:",
        error.response?.data || error.message
      );
      throw new Error("Failed to get email details");
    }
  }

  /**
   * Process emails to find order-related information
   */
  async processEmailsForOrders(emails) {
    const potentialOrders = [];

    for (const email of emails) {
      try {
        // Extract potential order information from email
        const orderInfo = this.extractOrderInfo(email);
        if (orderInfo) {
          potentialOrders.push({
            emailId: email.id,
            subject: email.subject,
            from: email.from?.emailAddress?.address,
            receivedAt: email.receivedDateTime,
            orderInfo: orderInfo,
          });
        }
      } catch (error) {
        console.error("Error processing email:", email.id, error.message);
      }
    }

    return potentialOrders;
  }

  /**
   * Extract order information from email content
   */
  extractOrderInfo(email) {
    const subject = email.subject?.toLowerCase() || "";
    const preview = email.bodyPreview?.toLowerCase() || "";
    const content = `${subject} ${preview}`;

    // Look for order numbers
    const orderNumberPatterns = [
      /order[\s#]*([a-zA-Z0-9-_]+)/i,
      /transaction[\s#]*([a-zA-Z0-9-_]+)/i,
      /receipt[\s#]*([a-zA-Z0-9-_]+)/i,
      /invoice[\s#]*([a-zA-Z0-9-_]+)/i,
    ];

    let orderNumber = null;
    for (const pattern of orderNumberPatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        orderNumber = match[1];
        break;
      }
    }

    // Look for amounts
    const amountPatterns = [
      /\$([0-9,]+\.?[0-9]*)/,
      /([0-9,]+\.?[0-9]*)\s*USD/i,
      /total[\s:]*\$?([0-9,]+\.?[0-9]*)/i,
      /amount[\s:]*\$?([0-9,]+\.?[0-9]*)/i,
    ];

    let amount = null;
    for (const pattern of amountPatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        amount = parseFloat(match[1].replace(/,/g, ""));
        break;
      }
    }

    // Look for email addresses
    const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
    const emailMatch = content.match(emailPattern);
    const customerEmail = emailMatch ? emailMatch[1] : null;

    if (orderNumber || amount || customerEmail) {
      return {
        orderNumber,
        amount,
        customerEmail,
        confidence: this.calculateConfidence(
          orderNumber,
          amount,
          customerEmail,
          content
        ),
      };
    }

    return null;
  }

  /**
   * Calculate confidence score for extracted order information
   */
  calculateConfidence(orderNumber, amount, customerEmail, content) {
    let confidence = 0;

    if (orderNumber) confidence += 40;
    if (amount) confidence += 30;
    if (customerEmail) confidence += 20;

    // Boost confidence for payment-related keywords
    const paymentKeywords = [
      "payment",
      "paid",
      "receipt",
      "invoice",
      "transaction",
      "purchase",
    ];
    const keywordMatches = paymentKeywords.filter((keyword) =>
      content.includes(keyword)
    ).length;
    confidence += keywordMatches * 2;

    return Math.min(confidence, 100);
  }

  /**
   * Sync emails for a specific Outlook account
   */
  async syncAccountEmails(accountId) {
    try {
      const account = await OutlookAccount.findById(accountId);
      if (!account || !account.isActive) {
        throw new Error("Account not found or inactive");
      }

      // Check if token is expired and refresh if needed
      if (account.isTokenExpired()) {
        await this.refreshAccountToken(account);
      }

      await account.startSync();

      const settings = await Settings.findOne();
      const maxEmails = settings?.outlookMaxEmailsToScan || 50;
      const keywords = settings?.outlookSearchKeywords || [
        "payment",
        "receipt",
        "order",
      ];

      // Search for emails
      const emails = await this.searchEmails(
        account.accessToken,
        keywords,
        maxEmails
      );

      // Process emails for order information
      const potentialOrders = await this.processEmailsForOrders(emails);

      // Update account statistics
      await account.updateSyncStats(emails.length, potentialOrders.length);

      return {
        emailsProcessed: emails.length,
        ordersFound: potentialOrders.length,
        potentialOrders,
      };
    } catch (error) {
      console.error("Error syncing account emails:", error.message);
      if (account) {
        await account.setSyncError(error.message);
      }
      throw error;
    }
  }

  /**
   * Refresh account token
   */
  async refreshAccountToken(account) {
    try {
      const settings = await Settings.findOne();
      if (!settings || !settings.outlookEnabled) {
        throw new Error("Outlook integration is not enabled");
      }

      const tokenData = await this.refreshAccessToken(
        account.refreshToken,
        settings.outlookTenantId,
        settings.outlookClientId,
        settings.outlookClientSecret
      );

      await account.updateTokens(
        tokenData.access_token,
        tokenData.refresh_token,
        tokenData.expires_in
      );

      return tokenData;
    } catch (error) {
      console.error("Error refreshing account token:", error.message);
      await account.setSyncError("Token refresh failed: " + error.message);
      throw error;
    }
  }

  /**
   * Send email notification
   */
  async sendEmail(accessToken, to, subject, body, isHtml = false) {
    try {
      const message = {
        message: {
          subject: subject,
          body: {
            contentType: isHtml ? "HTML" : "Text",
            content: body,
          },
          toRecipients: [
            {
              emailAddress: {
                address: to,
              },
            },
          ],
        },
      };

      const response = await axios.post(
        `${this.graphApiUrl}/me/sendMail`,
        message,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      return { success: true, messageId: response.headers["x-ms-request-id"] };
    } catch (error) {
      console.error(
        "Error sending email:",
        error.response?.data || error.message
      );
      throw new Error("Failed to send email");
    }
  }
}

module.exports = new OutlookService();
