const express = require("express");
const router = express.Router();
const OutlookAccount = require("../models/OutlookAccount");
const Settings = require("../models/Settings");
const outlookService = require("../services/outlookService");
const UserAccessToken = require("../models/UserAccessToken");

/**
 * @route   GET /api/customer/outlook-accounts/auth-url
 * @desc    Get OAuth authorization URL for customers
 * @access  Public (with valid access token)
 */
router.get("/auth-url", async (req, res) => {
  try {
    const { accessToken } = req.query;

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: "Access token is required",
      });
    }

    // Validate access token
    const tokenRecord = await UserAccessToken.findOne({
      token: accessToken,
      isActive: true,
      expiresAt: { $gt: new Date() },
    });

    if (!tokenRecord) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired access token",
      });
    }

    const settings = await Settings.findOne();
    if (!settings || !settings.outlookEnabled) {
      return res.status(400).json({
        success: false,
        message: "Outlook integration is not enabled",
      });
    }

    if (
      !settings.outlookClientId ||
      !settings.outlookTenantId ||
      !settings.outlookRedirectUri
    ) {
      return res.status(400).json({
        success: false,
        message: "Outlook configuration is incomplete",
      });
    }

    const state = `customer_${tokenRecord._id}_${Date.now()}`;
    const authUrl = outlookService.getAuthUrl(
      settings.outlookTenantId,
      settings.outlookClientId,
      settings.outlookRedirectUri,
      state
    );

    res.json({
      success: true,
      data: {
        authUrl,
        state,
      },
    });
  } catch (error) {
    console.error("Error generating customer auth URL:", error);
    res.status(500).json({
      success: false,
      message: "Error generating authorization URL",
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/customer/outlook-accounts/callback
 * @desc    Handle OAuth callback for customer accounts (GET request from OAuth provider)
 * @access  Public
 */
router.get("/callback", async (req, res) => {
  try {
    const { error, error_description, code, state } = req.query;

    // Handle OAuth errors
    if (error) {
      console.error("OAuth error:", error, error_description);
      return res.status(400).send(`
        <html>
          <body>
            <h2>Authentication Error</h2>
            <p><strong>Error:</strong> ${error}</p>
            <p><strong>Description:</strong> ${
              error_description || "Unknown error occurred"
            }</p>
            <p>Please close this window and try again. If the problem persists, contact support.</p>
            <script>
              setTimeout(() => {
                window.close();
              }, 5000);
            </script>
          </body>
        </html>
      `);
    }

    if (!code || !state) {
      return res.status(400).send(`
        <html>
          <body>
            <h2>Authentication Error</h2>
            <p>Missing authorization code or state parameter.</p>
            <p>Please close this window and try again.</p>
            <script>
              setTimeout(() => {
                window.close();
              }, 3000);
            </script>
          </body>
        </html>
      `);
    }

    // Extract customer token ID from state
    const stateMatch = state.match(/customer_([a-f0-9]+)_/);
    if (!stateMatch) {
      return res.status(400).send(`
        <html>
          <body>
            <h2>Authentication Error</h2>
            <p>Invalid state parameter.</p>
            <p>Please close this window and try again.</p>
            <script>
              setTimeout(() => {
                window.close();
              }, 3000);
            </script>
          </body>
        </html>
      `);
    }

    const tokenId = stateMatch[1];

    // Validate token exists
    const tokenRecord = await UserAccessToken.findOne({
      _id: tokenId,
      isActive: true,
      expiresAt: { $gt: new Date() },
    });

    if (!tokenRecord) {
      return res.status(401).send(`
        <html>
          <body>
            <h2>Authentication Error</h2>
            <p>Invalid or expired access token.</p>
            <p>Please close this window and try again.</p>
            <script>
              setTimeout(() => {
                window.close();
              }, 3000);
            </script>
          </body>
        </html>
      `);
    }

    const settings = await Settings.findOne();
    if (!settings || !settings.outlookEnabled) {
      return res.status(400).send(`
        <html>
          <body>
            <h2>Configuration Error</h2>
            <p>Outlook integration is not enabled.</p>
            <p>Please close this window and contact support.</p>
            <script>
              setTimeout(() => {
                window.close();
              }, 3000);
            </script>
          </body>
        </html>
      `);
    }

    // Exchange code for tokens
    const tokenData = await outlookService.exchangeCodeForToken(
      code,
      settings.outlookTenantId,
      settings.outlookClientId,
      settings.outlookClientSecret,
      settings.outlookRedirectUri
    );

    // Get user profile
    const profile = await outlookService.getUserProfile(tokenData.access_token);
    const userEmail = profile.mail || profile.userPrincipalName;

    // Check if account already exists for this customer
    const existingAccount = await OutlookAccount.findOne({
      email: userEmail,
      addedBy: tokenRecord._id,
    });

    if (existingAccount) {
      // Update existing account
      await existingAccount.updateTokens(
        tokenData.access_token,
        tokenData.refresh_token,
        tokenData.expires_in
      );

      return res.send(`
        <html>
          <body>
            <h2>Success!</h2>
            <p>Your Outlook account <strong>${userEmail}</strong> has been updated successfully.</p>
            <p>You can now close this window.</p>
            <script>
              setTimeout(() => {
                window.close();
              }, 3000);
            </script>
          </body>
        </html>
      `);
    }

    // Create new account for customer
    const newAccount = new OutlookAccount({
      email: userEmail,
      displayName: profile.displayName,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
      addedBy: tokenRecord._id,
      isActive: true,
      syncStatus: "idle",
    });

    await newAccount.save();

    res.send(`
      <html>
        <body>
          <h2>Success!</h2>
          <p>Your Outlook account <strong>${userEmail}</strong> has been added successfully.</p>
          <p>You can now close this window.</p>
          <script>
            setTimeout(() => {
              window.close();
            }, 3000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error handling customer OAuth callback:", error);
    res.status(500).send(`
      <html>
        <body>
          <h2>Server Error</h2>
          <p>An error occurred while processing your request.</p>
          <p>Please close this window and try again. If the problem persists, contact support.</p>
          <script>
            setTimeout(() => {
              window.close();
            }, 5000);
          </script>
        </body>
      </html>
    `);
  }
});

/**
 * @route   POST /api/customer/outlook-accounts/callback
 * @desc    Handle OAuth callback for customer accounts (Legacy JSON endpoint)
 * @access  Public
 */
router.post("/callback", async (req, res) => {
  try {
    const { code, state, accessToken } = req.body;

    if (!code || !state || !accessToken) {
      return res.status(400).json({
        success: false,
        message: "Code, state, and access token are required",
      });
    }

    // Validate access token
    const tokenRecord = await UserAccessToken.findOne({
      token: accessToken,
      isActive: true,
      expiresAt: { $gt: new Date() },
    });

    if (!tokenRecord) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired access token",
      });
    }

    // Verify state matches the token
    if (!state.includes(tokenRecord._id.toString())) {
      return res.status(400).json({
        success: false,
        message: "Invalid state parameter",
      });
    }

    const settings = await Settings.findOne();
    if (!settings || !settings.outlookEnabled) {
      return res.status(400).json({
        success: false,
        message: "Outlook integration is not enabled",
      });
    }

    // Exchange code for tokens
    const tokenData = await outlookService.exchangeCodeForToken(
      code,
      settings.outlookTenantId,
      settings.outlookClientId,
      settings.outlookClientSecret,
      settings.outlookRedirectUri
    );

    // Get user profile
    const profile = await outlookService.getUserProfile(tokenData.access_token);
    const userEmail = profile.mail || profile.userPrincipalName;

    // Check if account already exists for this customer
    const existingAccount = await OutlookAccount.findOne({
      email: userEmail,
      addedBy: tokenRecord._id, // Use token ID as customer identifier
    });

    if (existingAccount) {
      // Update existing account
      await existingAccount.updateTokens(
        tokenData.access_token,
        tokenData.refresh_token,
        tokenData.expires_in
      );

      return res.json({
        success: true,
        message: "Outlook account updated successfully",
        data: {
          email: existingAccount.email,
          displayName: existingAccount.displayName,
          isActive: existingAccount.isActive,
        },
      });
    }

    // Create new account for customer
    const newAccount = new OutlookAccount({
      email: userEmail,
      displayName: profile.displayName,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
      addedBy: tokenRecord._id, // Use token ID as customer identifier
      isActive: true,
      syncStatus: "idle",
    });

    await newAccount.save();

    res.json({
      success: true,
      message: "Outlook account added successfully",
      data: {
        email: newAccount.email,
        displayName: newAccount.displayName,
        isActive: newAccount.isActive,
      },
    });
  } catch (error) {
    console.error("Error handling customer OAuth callback:", error);
    res.status(500).json({
      success: false,
      message: "Error processing OAuth callback",
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/customer/outlook-accounts
 * @desc    Get customer's Outlook accounts
 * @access  Public (with valid access token)
 */
router.get("/", async (req, res) => {
  try {
    const { accessToken } = req.query;

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: "Access token is required",
      });
    }

    // Validate access token
    const tokenRecord = await UserAccessToken.findOne({
      token: accessToken,
      isActive: true,
      expiresAt: { $gt: new Date() },
    });

    if (!tokenRecord) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired access token",
      });
    }

    // Get customer's Outlook accounts
    const accounts = await OutlookAccount.find({
      addedBy: tokenRecord._id,
    }).select("email displayName isActive syncStatus lastSyncAt createdAt");

    res.json({
      success: true,
      data: accounts,
    });
  } catch (error) {
    console.error("Error fetching customer Outlook accounts:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching Outlook accounts",
      error: error.message,
    });
  }
});

/**
 * @route   DELETE /api/customer/outlook-accounts/:id
 * @desc    Delete customer's Outlook account
 * @access  Public (with valid access token)
 */
router.delete("/:id", async (req, res) => {
  try {
    const { accessToken } = req.body;
    const { id } = req.params;

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: "Access token is required",
      });
    }

    // Validate access token
    const tokenRecord = await UserAccessToken.findOne({
      token: accessToken,
      isActive: true,
      expiresAt: { $gt: new Date() },
    });

    if (!tokenRecord) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired access token",
      });
    }

    // Find and delete the account (only if it belongs to this customer)
    const account = await OutlookAccount.findOne({
      _id: id,
      addedBy: tokenRecord._id,
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found or access denied",
      });
    }

    await OutlookAccount.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Outlook account removed successfully",
    });
  } catch (error) {
    console.error("Error deleting customer Outlook account:", error);
    res.status(500).json({
      success: false,
      message: "Error removing Outlook account",
      error: error.message,
    });
  }
});

/**
 * @route   PUT /api/customer/outlook-accounts/:id/toggle
 * @desc    Toggle customer's Outlook account active status
 * @access  Public (with valid access token)
 */
router.put("/:id/toggle", async (req, res) => {
  try {
    const { accessToken } = req.body;
    const { id } = req.params;

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: "Access token is required",
      });
    }

    // Validate access token
    const tokenRecord = await UserAccessToken.findOne({
      token: accessToken,
      isActive: true,
      expiresAt: { $gt: new Date() },
    });

    if (!tokenRecord) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired access token",
      });
    }

    // Find and toggle the account (only if it belongs to this customer)
    const account = await OutlookAccount.findOne({
      _id: id,
      addedBy: tokenRecord._id,
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found or access denied",
      });
    }

    account.isActive = !account.isActive;
    await account.save();

    res.json({
      success: true,
      message: `Account ${
        account.isActive ? "activated" : "deactivated"
      } successfully`,
      data: {
        email: account.email,
        isActive: account.isActive,
      },
    });
  } catch (error) {
    console.error("Error toggling customer Outlook account:", error);
    res.status(500).json({
      success: false,
      message: "Error updating Outlook account",
      error: error.message,
    });
  }
});

module.exports = router;
