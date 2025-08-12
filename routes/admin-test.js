const express = require('express');
const router = express.Router();

// Simple test route
router.post('/login', (req, res) => {
  res.json({
    success: false,
    message: 'Test admin route is working - credentials validation not implemented in test'
  });
});

router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Admin test route is working'
  });
});

module.exports = router;