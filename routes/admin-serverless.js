const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const AdminUser = require("../models/AdminUser");
const bcrypt = require('bcryptjs');
const jwt = require("jsonwebtoken");
const { protect, authorize } = require("../middlewares/auth");

// @desc    Admin login
// @route   POST /api/admin/login
// @access  Public
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Check if admin exists
    const admin = await AdminUser.findOne({ email }).select('+password');
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: admin._id, role: admin.role },
      process.env.JWT_SECRET || "fallback_secret",
      { expiresIn: "30d" }
    );

    res.json({
      success: true,
      message: "Login successful",
      token,
      admin: {
        id: admin._id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
        lastLogin: new Date(),
      },
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: "Error during login",
      error: error.message,
    });
  }
});

// @desc    Get admin profile
// @route   GET /api/admin/profile
// @access  Private (Admin)
router.get("/profile", protect, (req, res) => {
  res.json({
    success: true,
    data: req.user,
  });
});

module.exports = router;