const express = require("express");
const router = express.Router();
const UserAccessToken = require("../models/UserAccessToken");
const OutlookAccount = require("../models/OutlookAccount");
const outlookService = require("../services/outlookService");
const multiOutlookService = require("../services/multiOutlookService");
const axios = require("axios");

/**
 * @route   POST /api/otp/get-otp
 * @desc    Get OTP from email using access token
 * @access  Public (with valid access token)
 */
router.post("/get-otp", async (req, res) => {
  try {
    const { accessToken, email } = req.body;

    if (!accessToken || !email) {
      return res.status(400).json({
        success: false,
        message: "Access token and email are required",
      });
    }

    // Find and validate access token with MongoDB connection error handling
    let tokenRecord;
    try {
      tokenRecord = await UserAccessToken.findOne({
        token: accessToken,
        isActive: true,
        $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }],
      }).maxTimeMS(5000); // 5 second timeout
    } catch (dbError) {
      console.error("Database connection error:", dbError);
      return res.status(503).json({
        success: false,
        message: "Database connection error. Please try again later.",
        error: "SERVICE_UNAVAILABLE",
      });
    }

    if (!tokenRecord) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired access token",
      });
    }

    // Check usage limit (fix field name from usageLimit to maxUsage)
    if (
      tokenRecord.maxUsage &&
      tokenRecord.usageCount >= tokenRecord.maxUsage
    ) {
      return res.status(429).json({
        success: false,
        message: "Access token usage limit exceeded",
      });
    }

    // Find all active Outlook accounts with error handling
    let outlookAccounts;
    try {
      outlookAccounts = await OutlookAccount.find({
        isActive: true,
        syncStatus: { $ne: "error" },
      }).maxTimeMS(5000);
      console.log(
        `Found ${outlookAccounts.length} active accounts: ${outlookAccounts
          .map((a) => a.email)
          .join(", ")}`
      );
    } catch (dbError) {
      console.error("Database error finding Outlook accounts:", dbError);
      return res.status(503).json({
        success: false,
        message: "Database connection error. Please try again later.",
        error: "SERVICE_UNAVAILABLE",
      });
    }

    if (outlookAccounts.length === 0) {
      return res.status(503).json({
        success: false,
        message:
          "No active email service available. Please add your Outlook account or contact support.",
      });
    }

    // Sync all active accounts before searching
    try {
      await multiOutlookService.syncAllAccounts();
      console.log("Synced all active accounts");
    } catch (syncError) {
      console.error("Error syncing accounts:", syncError);
      // Continue even if sync fails, as emails might still be available
    }

    // Search for OTP emails across all available accounts
    let otpResult = { success: false };
    for (const outlookAccount of outlookAccounts) {
      const isOwnEmail =
        email && email.toLowerCase() === outlookAccount.email?.toLowerCase();
      const searchEmail = isOwnEmail ? null : email;
      console.log(
        `Searching account ${outlookAccount.email}, isOwnEmail: ${isOwnEmail}, searchEmail: ${searchEmail}`
      );
      const result = await searchForOTP(outlookAccount, searchEmail);
      console.log(
        `Result for ${outlookAccount.email}: success=${result.success}`
      );
      if (result.success) {
        otpResult = result;
        break;
      }
    }

    if (!otpResult.success) {
      return res.status(404).json({
        success: false,
        message:
          otpResult.message ||
          "Authentication code not received. Please check if the code was sent to your email within the last 5 minutes.",
        error: "OTP_NOT_FOUND",
      });
    }

    // Check if this OTP has already been retrieved
    const isNewOTP = !tokenRecord.hasRetrievedOTP(otpResult.otp);

    // Only increment usage count for new OTPs
    if (isNewOTP) {
      try {
        tokenRecord.usageCount += 1;
        tokenRecord.lastUsed = new Date();
        await tokenRecord.addRetrievedOTP(
          otpResult.otp,
          otpResult.service,
          otpResult.timestamp
        );
      } catch (dbError) {
        console.error("Error updating token usage:", dbError);
        // Still return the OTP even if usage count update fails
      }
    } else {
      // Update last used time even for duplicate OTPs
      try {
        tokenRecord.lastUsed = new Date();
        await tokenRecord.save();
      } catch (dbError) {
        console.error("Error updating last used time:", dbError);
      }
    }

    const remainingUses = tokenRecord.maxUsage
      ? tokenRecord.maxUsage - tokenRecord.usageCount
      : "unlimited";

    res.json({
      success: true,
      data: {
        otp: otpResult.otp,
        service: otpResult.service,
        timestamp: otpResult.timestamp,
        remainingUses: remainingUses,
        isNewOTP: isNewOTP,
        message: isNewOTP
          ? "New OTP retrieved"
          : "Previously retrieved OTP (usage not counted)",
      },
    });
  } catch (error) {
    console.error("Error getting OTP:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving OTP",
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/otp/token-info
 * @desc    Get access token information
 * @access  Public (with valid access token)
 */
router.get("/token-info", async (req, res) => {
  try {
    const { accessToken } = req.query;

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: "Access token is required",
      });
    }

    const tokenRecord = await UserAccessToken.findOne({
      token: accessToken,
      isActive: true,
    });

    if (!tokenRecord) {
      return res.status(401).json({
        success: false,
        message: "Invalid access token",
      });
    }

    res.json({
      success: true,
      data: {
        usageCount: tokenRecord.usageCount,
        maxUsage: tokenRecord.maxUsage,
        remainingUses: tokenRecord.maxUsage
          ? tokenRecord.maxUsage - tokenRecord.usageCount
          : "unlimited",
        expiresAt: tokenRecord.expiresAt,
        isExpired: tokenRecord.expiresAt < new Date(),
        isActive: tokenRecord.isActive,
      },
    });
  } catch (error) {
    console.error("Error getting token info:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving token information",
      error: error.message,
    });
  }
});

/**
 * Search for OTP in recent emails
 */
async function searchForOTP(outlookAccount, targetEmail) {
  try {
    // Get access token for the Outlook account
    let accessToken = outlookAccount.accessToken;
    console.log(
      `Starting search for account ${outlookAccount.email}, targetEmail: ${targetEmail}`
    );

    // Search for recent emails related to ChatGPT login
    const searchQuery = targetEmail
      ? `from:${targetEmail} AND (chatgpt OR openai)`
      : "OTP OR code OR verification AND (chatgpt OR openai) AND NOT (reset OR recovery OR password)";
    const url = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$search="${searchQuery}"&$top=50`;

    let response;
    let retryCount = 0;
    const maxRetries = 1;

    while (retryCount <= maxRetries) {
      try {
        response = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          timeout: 10000, // 10 second timeout
        });
        console.log(
          `API call successful for ${outlookAccount.email}, found ${response.data.value.length} emails`
        );
        break; // Success, exit retry loop
      } catch (apiError) {
        console.error(
          "Microsoft Graph API error for ${outlookAccount.email}:",
          apiError.response?.data || apiError.message
        );

        if (apiError.response?.status === 401 && retryCount === 0) {
          // Token expired, try to refresh it
          try {
            console.log(
              `Access token expired for ${outlookAccount.email}, attempting to refresh...`
            );
            const outlookService = require("../services/outlookService");
            await outlookService.refreshAccountToken(outlookAccount);

            // Reload the account to get the new token
            const OutlookAccount = require("../models/OutlookAccount");
            const refreshedAccount = await OutlookAccount.findById(
              outlookAccount._id
            );
            accessToken = refreshedAccount.accessToken;
            console.log(`Token refreshed for ${outlookAccount.email}`);

            retryCount++;
            continue; // Retry with new token
          } catch (refreshError) {
            console.error(
              `Failed to refresh token for ${outlookAccount.email}:`,
              refreshError.message
            );
            return {
              success: false,
              message:
                "Email service authentication expired. Please contact support.",
            };
          }
        }

        if (apiError.code === "ECONNABORTED" || apiError.code === "ETIMEDOUT") {
          return {
            success: false,
            message: "Email service timeout. Please try again.",
          };
        }

        return {
          success: false,
          message:
            "Email service temporarily unavailable. Please try again later.",
        };
      }
    }

    let emails = response.data.value;
    console.log(
      `Initial search found ${emails.length} emails for ${outlookAccount.email}`
    );

    // If no emails found with search, try a broader approach
    if (!emails || emails.length === 0) {
      console.log(
        "No emails found with search query, trying broader approach..."
      );
      const broadUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=100`;

      try {
        const broadResponse = await axios.get(broadUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        });

        // Filter emails manually for the target email (if specified) or look for OTP-related emails
        const allEmails = broadResponse.data.value || [];
        emails = allEmails.filter((email) => {
          if (targetEmail) {
            // If target email specified, look for emails from that sender
            const fromEmail =
              email.from?.emailAddress?.address?.toLowerCase() || "";
            return fromEmail === targetEmail.toLowerCase();
          } else {
            // If no target email, look for emails containing ChatGPT login keywords (excluding reset)
            const subject = (email.subject || "").toLowerCase();
            const body = (email.body?.content || "").toLowerCase();
            const content = subject + " " + body;
            return (
              /\b(otp|code|verification|authenticate|login|signin)\b/i.test(
                content
              ) &&
              /chatgpt|openai/i.test(content) &&
              !/reset|recovery|password/i.test(content)
            );
          }
        });

        console.log(`Found ${emails.length} emails with broader search`);
      } catch (broadError) {
        console.error("Broader search also failed:", broadError.message);
        emails = [];
      }
    }

    // Sort emails by received date (newest first)
    emails.sort(
      (a, b) => new Date(b.receivedDateTime) - new Date(a.receivedDateTime)
    );

    // Look for OTP in recent emails (last 15 minutes)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    console.log(
      `Searching for OTP in ${emails.length} emails for target: ${targetEmail}`
    );
    console.log(
      `Time window: emails newer than ${fifteenMinutesAgo.toISOString()}`
    );

    let recentEmailsCount = 0;
    let otpSearchAttempts = 0;

    for (const email of emails) {
      const receivedDate = new Date(email.receivedDateTime);

      if (receivedDate < fifteenMinutesAgo) {
        continue; // Skip emails older than 15 minutes
      }

      recentEmailsCount++;
      console.log(
        `Checking email ${recentEmailsCount}: Subject: "${
          email.subject
        }", From: ${
          email.from?.emailAddress?.address
        }, Received: ${receivedDate.toISOString()}`
      );

      // Extract OTP from email content
      const otpResult = extractOTPFromEmail(email);
      otpSearchAttempts++;

      if (otpResult.success) {
        console.log(
          `OTP found in ${outlookAccount.email}! Code: ${otpResult.otp}, Service: ${otpResult.service}`
        );
        return {
          success: true,
          otp: otpResult.otp,
          service: otpResult.service,
          timestamp: receivedDate,
        };
      } else {
        console.log(
          `No OTP found in email for ${outlookAccount.email}: ${otpResult.message}`
        );
      }
    }

    console.log(
      `Search completed: ${recentEmailsCount} recent emails checked, ${otpSearchAttempts} OTP extraction attempts`
    );

    return {
      success: false,
      message:
        "Authentication code not received. Please check if the code was sent to your email within the last 15 minutes.",
    };
  } catch (error) {
    console.error(`Error searching for OTP in ${outlookAccount.email}:`, error);

    // Handle specific error types
    if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      return {
        success: false,
        message:
          "Network connection error. Please check your internet connection and try again.",
      };
    }

    return {
      success: false,
      message:
        "Error searching emails for authentication code. Please try again later.",
    };
  }
}

/**
 * Extract OTP from email content
 */
function extractOTPFromEmail(email) {
  try {
    const subject = email.subject || "";
    const body = email.body?.content || "";
    const textContent = subject + " " + body;

    console.log(`Checking for reset keywords in email subject: ${subject}`);
    console.log(
      `Reset check result: ${/password reset|reset password|recovery code/i.test(
        textContent
      )}`
    );

    // Check first if email appears to be password reset
    if (/password reset|reset password|recovery code/i.test(textContent)) {
      console.log(`Skipping password reset email: ${subject}`);
      return {
        success: false,
        message: "Skipped password reset email",
      };
    }

    // Common OTP patterns (excluding reset-specific)
    const otpPatterns = [
      /\b(\d{6})\b/g, // 6-digit codes
      /\b(\d{4})\b/g, // 4-digit codes
      /\b(\d{8})\b/g, // 8-digit codes
      /verification code[:\s]*(\d+)/gi,
      /your code[:\s]*(\d+)/gi,
      /otp[:\s]*(\d+)/gi,
      /pin[:\s]*(\d+)/gi,
    ];

    // Service detection patterns
    const servicePatterns = {
      ChatGPT: /chatgpt|openai/gi,
      Google: /google|gmail/gi,
      Microsoft: /microsoft|outlook|hotmail/gi,
      Facebook: /facebook|meta/gi,
      Twitter: /twitter|x\.com/gi,
      Instagram: /instagram/gi,
      LinkedIn: /linkedin/gi,
      Discord: /discord/gi,
      Telegram: /telegram/gi,
      WhatsApp: /whatsapp/gi,
    };

    // Detect service and only proceed if ChatGPT
    let detectedService = "Unknown";
    for (const [service, pattern] of Object.entries(servicePatterns)) {
      if (pattern.test(textContent)) {
        detectedService = service;
        break;
      }
    }
    if (detectedService !== "ChatGPT") {
      return {
        success: false,
        message: "Skipped non-ChatGPT email",
      };
    }

    // Extract OTP
    for (const pattern of otpPatterns) {
      const matches = textContent.match(pattern);
      if (matches && matches.length > 0) {
        // Return the first valid OTP found
        const otp = matches[0].replace(/\D/g, ""); // Remove non-digits
        if (otp.length >= 4 && otp.length <= 8) {
          return {
            success: true,
            otp: otp,
            service: detectedService,
          };
        }
      }
    }

    return {
      success: false,
      message: "No OTP pattern found in email",
    };
  } catch (error) {
    console.error("Error extracting OTP:", error);
    return {
      success: false,
      message: "Error processing email content",
    };
  }
}

module.exports = router;
