const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

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
    console.log('✅ Connected to MongoDB');
    
    // Create default admin user (only run once)
    if (!global.adminCreated) {
      require(path.join(__dirname, '..', 'utils', 'createAdmin'))();
      global.adminCreated = true;
    }
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    throw err;
  }
};

// Create Express app
const app = express();

// Basic middleware
app.use(
  cors({
    origin: '*',
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes with absolute path resolution and /api prefix
try {
  const routesPath = path.join(__dirname, '..', 'routes');
  console.log('📁 Routes path:', routesPath);
  
  // Load admin route with detailed logging
  const adminRoutePath = path.join(routesPath, 'admin-serverless');
  console.log('🔍 Loading admin route from:', adminRoutePath);
  const adminRouter = require(adminRoutePath);
  console.log('✅ Admin router loaded successfully');
  app.use('/api/admin', adminRouter);
  console.log('✅ Admin routes mounted at /api/admin');
  
  // Load other routes
  app.use('/api/products', require(path.join(routesPath, 'products')));
  app.use('/api/categories', require(path.join(routesPath, 'categories')));
  app.use('/api/orders', require(path.join(routesPath, 'orders')));
  app.use('/api/currency', require(path.join(routesPath, 'currency')));
  app.use('/api/payments', require(path.join(routesPath, 'payments')));
  app.use('/api/upload', require(path.join(routesPath, 'upload')));
  app.use('/api/email-verification', require(path.join(routesPath, 'emailVerification')));
  // outlook-accounts and access-tokens are handled by admin.js sub-routes
  app.use('/api/customer/outlook-accounts', require(path.join(routesPath, 'customerOutlookAccounts')));
  app.use('/api/otp', require(path.join(routesPath, 'otp')));
  console.log('✅ All routes loaded successfully');
} catch (err) {
  console.error('❌ Route loading error:', err);
  console.error('❌ __dirname:', __dirname);
  console.error('❌ Routes path:', path.join(__dirname, '..', 'routes'));
  console.error('❌ Error stack:', err.stack);
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Zelyx API',
    version: '1.0.0',
    status: 'OK',
    message: 'Zelyx API is running successfully',
    endpoints: {
      health: '/api/health',
      products: '/api/products',
      categories: '/api/categories',
      orders: '/api/orders',
      admin: '/api/admin',
      currency: '/api/currency',
      payments: '/api/payments',
      upload: '/api/upload'
    }
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Zelyx API is running',
    timestamp: new Date().toISOString(),
    mongodb: isConnected ? 'Connected' : 'Disconnected'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Express error:', err.stack);
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
});

// 404 handler
app.use('*', (req, res) => {
  console.log('404 for path:', req.originalUrl);
  res.status(404).json({ message: 'Route not found' });
});

// Serverless function handler
module.exports = async (req, res) => {
  try {
    console.log('Serverless function called for:', req.url, 'Method:', req.method);
    await connectToDatabase();
    
    // Add request logging for debugging
    console.log('Request details:', {
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: req.body
    });
    
    return app(req, res);
  } catch (error) {
    console.error('Serverless function error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to initialize server',
      details: error.message
    });
  }
};