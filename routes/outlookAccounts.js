const express = require("express");
const router = express.Router();
const OutlookAccount = require("../models/OutlookAccount");
const OutlookConfig = require("../models/OutlookConfig");
const Settings = require("../models/Settings");
const outlookService = require("../services/outlookService");
const multiOutlookService = require("../services/multiOutlookService");
const { protect, authorize } = require("../middlewares/auth");

/**
 * @route   GET /api/outlook-accounts/callback
 * @desc    Handle OAuth callback and add account (GET request from OAuth provider)
 * @access  Public (no auth middleware for OAuth callback)
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

    // Extract admin user ID from state
    const stateMatch = state.match(/admin_([a-f0-9]+)_/);
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

    const userId = stateMatch[1];

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

    // Check if account already exists
    const existingAccount = await OutlookAccount.findOne({
      email: userEmail,
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
            <p>Outlook account <strong>${userEmail}</strong> has been updated successfully.</p>
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

    // Create new account
    const newAccount = new OutlookAccount({
      email: userEmail,
      displayName: profile.displayName,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
      addedBy: userId,
    });

    await newAccount.save();

    res.send(`
      <html>
        <body>
          <h2>Success!</h2>
          <p>Outlook account <strong>${userEmail}</strong> has been added successfully.</p>
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
    console.error("Error handling admin OAuth callback:", error);
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

// Apply authentication middleware to all other routes
router.use(protect);
router.use(authorize("admin", "super_admin"));

/**
 * @route   GET /api/outlook-accounts
 * @desc    Get all Outlook accounts
 * @access  Admin
 */
router.get("/", async (req, res) => {
  try {
    const accounts = await OutlookAccount.find()
      .populate("addedBy", "firstName lastName email")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: accounts,
    });
  } catch (error) {
    console.error("Error fetching Outlook accounts:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching Outlook accounts",
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/outlook-accounts/auth-url
 * @desc    Get OAuth authorization URL
 * @access  Admin
 */
router.get("/auth-url", async (req, res) => {
  try {
    const settings = await Settings.findOne();
    if (!settings || !settings.outlookEnabled) {
      return res.status(400).json({
        success: false,
        message:
          "Outlook integration is not enabled. Please configure it in settings first.",
      });
    }

    if (
      !settings.outlookClientId ||
      !settings.outlookTenantId ||
      !settings.outlookRedirectUri
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Outlook configuration is incomplete. Please check your settings.",
      });
    }

    const state = `admin_${req.user.id}_${Date.now()}`;
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
    console.error("Error generating auth URL:", error);
    res.status(500).json({
      success: false,
      message: "Error generating authorization URL",
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/outlook-accounts/callback
 * @desc    Handle OAuth callback and add account (Legacy JSON endpoint)
 * @access  Admin
 */
router.post("/callback", async (req, res) => {
  try {
    const { code, state } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Authorization code is required",
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

    // Check if account already exists
    const existingAccount = await OutlookAccount.findOne({
      email: profile.mail || profile.userPrincipalName,
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
        message: "Account updated successfully",
        data: existingAccount,
      });
    }

    // Create new account
    const newAccount = new OutlookAccount({
      email: profile.mail || profile.userPrincipalName,
      displayName: profile.displayName,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
      addedBy: req.user.id,
    });

    await newAccount.save();

    res.json({
      success: true,
      message: "Outlook account added successfully",
      data: newAccount,
    });
  } catch (error) {
    console.error("Error handling OAuth callback:", error);
    res.status(500).json({
      success: false,
      message: "Error adding Outlook account",
      error: error.message,
    });
  }
});

/**
 * @route   PUT /api/outlook-accounts/:id
 * @desc    Update Outlook account settings
 * @access  Admin
 */
router.put("/:id", async (req, res) => {
  try {
    const { isActive, settings } = req.body;

    const account = await OutlookAccount.findById(req.params.id);
    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    // Update account settings
    if (typeof isActive === "boolean") {
      account.isActive = isActive;
    }

    if (settings) {
      if (settings.autoSync !== undefined) {
        account.settings.autoSync = settings.autoSync;
      }
      if (settings.syncInterval) {
        account.settings.syncInterval = settings.syncInterval;
      }
      if (settings.maxEmailsPerSync) {
        account.settings.maxEmailsPerSync = settings.maxEmailsPerSync;
      }
    }

    await account.save();

    res.json({
      success: true,
      message: "Account updated successfully",
      data: account,
    });
  } catch (error) {
    console.error("Error updating account:", error);
    res.status(500).json({
      success: false,
      message: "Error updating account",
      error: error.message,
    });
  }
});

/**
 * @route   DELETE /api/outlook-accounts/:id
 * @desc    Delete Outlook account
 * @access  Admin
 */
router.delete("/:id", async (req, res) => {
  try {
    const account = await OutlookAccount.findById(req.params.id);
    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    await OutlookAccount.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting account:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting account",
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/outlook-accounts/:id/sync
 * @desc    Force sync for specific account
 * @access  Admin
 */
router.post("/:id/sync", async (req, res) => {
  try {
    const result = await multiOutlookService.forceSyncAccount(req.params.id);

    res.json({
      success: true,
      message: "Sync completed successfully",
      data: result,
    });
  } catch (error) {
    console.error("Error syncing account:", error);
    res.status(500).json({
      success: false,
      message: "Error syncing account",
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/outlook-accounts/:id/test
 * @desc    Test account connectivity
 * @access  Admin
 */
router.post("/:id/test", async (req, res) => {
  try {
    const result = await multiOutlookService.testAccountConnectivity(
      req.params.id
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error testing account:", error);
    res.status(500).json({
      success: false,
      message: "Error testing account connectivity",
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/outlook-accounts/sync/status
 * @desc    Get sync status for all accounts
 * @access  Admin
 */
router.get("/sync/status", async (req, res) => {
  try {
    const status = await multiOutlookService.getSyncStatus();

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error("Error getting sync status:", error);
    res.status(500).json({
      success: false,
      message: "Error getting sync status",
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/outlook-accounts/sync/all
 * @desc    Force sync for all accounts
 * @access  Admin
 */
router.post("/sync/all", async (req, res) => {
  try {
    const result = await multiOutlookService.syncAllAccounts();

    res.json({
      success: true,
      message: "Sync initiated for all accounts",
      data: result,
    });
  } catch (error) {
    console.error("Error syncing all accounts:", error);
    res.status(500).json({
      success: false,
      message: "Error syncing all accounts",
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/outlook-accounts/statistics
 * @desc    Get email processing statistics
 * @access  Admin
 */
router.get("/statistics", async (req, res) => {
  try {
    const stats = await multiOutlookService.getEmailStatistics();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error getting statistics:", error);
    res.status(500).json({
      success: false,
      message: "Error getting statistics",
      error: error.message,
    });
  }
});

module.exports = router;
