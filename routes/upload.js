const express = require('express');
const router = express.Router();
const CloudinaryService = require('../services/CloudinaryService');
const { protect, authorize } = require('../middlewares/auth');

// @desc    Upload product images
// @route   POST /api/upload/product-images
// @access  Private/Admin
router.post('/product-images', protect, authorize('admin'), (req, res) => {
  const upload = CloudinaryService.getUploadMiddleware();
  
  upload.array('images', 10)(req, res, async (err) => {
    try {
      if (err) {
        console.error('Multer error:', err);
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload error'
        });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No files uploaded'
        });
      }

      console.log('Files received:', req.files.length);

      // Upload each file to Cloudinary
      const uploadPromises = req.files.map(file => 
        CloudinaryService.uploadImage(file)
      );

      const uploadResults = await Promise.all(uploadPromises);

      res.json({
        success: true,
        message: 'Images uploaded successfully',
        images: uploadResults
      });

    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Server error during upload'
      });
    }
  });
});

// @desc    Delete product image
// @route   DELETE /api/upload/product-image/:publicId
// @access  Private/Admin
router.delete('/product-image/:publicId', protect, authorize('admin'), async (req, res) => {
  try {
    const { publicId } = req.params;
    
    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: 'Public ID is required'
      });
    }

    const result = await CloudinaryService.deleteImage(publicId);

    res.json({
      success: true,
      message: 'Image deleted successfully',
      result
    });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during deletion'
    });
  }
});

module.exports = router;