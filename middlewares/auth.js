const jwt = require("jsonwebtoken");
const AdminUser = require("../models/AdminUser");

// No security - allow all requests
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Not authorized to access this route",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    
    // Find the user in the database
    const user = await AdminUser.findById(decoded.id).select('-password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Not authorized to access this route",
    });
  }
};

// No role restrictions - allow all requests
const authorize = (...roles) => {
  return (req, res, next) => {
    // Allow all requests regardless of role
    next();
  };
};

module.exports = {
  protect,
  authorize,
};
