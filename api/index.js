const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
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

// Routes
try {
  app.use('/products', require('../routes/products'));
  app.use('/categories', require('../routes/categories'));
  app.use('/orders', require('../routes/orders'));
  app.use('/admin', require('../routes/admin'));
  
  // Load currency route with specific error handling
  try {
    const currencyRoute = require('../routes/currency');
    app.use('/currency', currencyRoute);
    console.log('✅ Currency route loaded successfully');
  } catch (currencyError) {
    console.error('❌ Currency route loading failed:', currencyError.message);
    console.error('Currency route stack:', currencyError.stack);
  }
  
  app.use('/payments', require('../routes/payments'));
  app.use('/upload', require('../routes/upload'));
  app.use('/email-verification', require('../routes/emailVerification'));
  app.use('/admin/outlook-accounts', require('../routes/outlookAccounts'));
  app.use('/admin/access-tokens', require('../routes/accessTokens'));
  app.use('/customer/outlook-accounts', require('../routes/customerOutlookAccounts'));
  app.use('/otp', require('../routes/otp'));
} catch (err) {
  console.error('Route loading error:', err);
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
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Zelyx API is running',
    timestamp: new Date().toISOString(),
    mongodb: isConnected ? 'Connected' : 'Disconnected'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Serverless function handler
module.exports = async (req, res) => {
  try {
    await connectToDatabase();
    return app(req, res);
  } catch (error) {
    console.error('Serverless function error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to initialize server'
    });
  }
};