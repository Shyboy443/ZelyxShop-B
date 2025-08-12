const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();

// Trust proxy for proper IP detection
app.set("trust proxy", 1);

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || [
      "http://localhost:3000",
      "https://zelyx-shop-h15ruo9vy-ashens-projects-29eb4a7c.vercel.app",
      "https://*.vercel.app"
    ],
    credentials: true,
  })
);

// Rate limiting for production
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // production limit
  message: "Too many requests from this IP, please try again later.",
  validate: {
    xForwardedForHeader: true, // enable validation for production
  },
});

// Rate limiting for order status checks
const orderStatusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // production limit for order status checks
  message: "Too many order status requests, please try again later.",
  validate: {
    xForwardedForHeader: true,
  },
});

app.use("/api/", limiter);
app.use("/api/orders/:orderNumber", orderStatusLimiter);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve static files from uploads directory
app.use("/uploads", express.static("uploads"));

// Routes
app.use("/api/products", require("./routes/products"));
app.use("/api/categories", require("./routes/categories"));
app.use("/api/orders", require("./routes/orders"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/currency", require("./routes/currency"));
app.use("/api/payments", require("./routes/payments"));
app.use("/api/upload", require("./routes/upload"));
app.use("/api/email-verification", require("./routes/emailVerification"));
app.use("/api/admin/outlook-accounts", require("./routes/outlookAccounts"));
app.use("/api/admin/access-tokens", require("./routes/accessTokens"));
app.use(
  "/api/customer/outlook-accounts",
  require("./routes/customerOutlookAccounts")
);
app.use("/api/otp", require("./routes/otp"));

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    name: "Zelyx API",
    version: "1.0.0",
    status: "OK",
    message: "Zelyx API is running successfully",
    endpoints: {
      health: "/api/health",
      products: "/api/products",
      categories: "/api/categories",
      orders: "/api/orders",
      admin: "/api/admin",
      currency: "/api/currency",
      payments: "/api/payments",
      upload: "/api/upload"
    }
  });
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Zelyx API is running" });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: "Something went wrong!",
    error:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Internal server error",
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// MongoDB connection for serverless
let isConnected = false;

const connectToDatabase = async () => {
  if (isConnected) {
    return;
  }

  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    isConnected = true;
    console.log("✅ Connected to MongoDB");
    
    // Create default admin user (only run once)
    if (!global.adminCreated) {
      require("./utils/createAdmin")();
      global.adminCreated = true;
    }
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    throw err;
  }
};

// Connect to database on startup
connectToDatabase();

// Export the app for Vercel
module.exports = app;

// Request logging middleware (disabled to reduce console noise)
// app.use((req, res, next) => {
//   console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.path}`);
//   next();
// });
