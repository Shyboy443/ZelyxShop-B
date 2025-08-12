const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ImageEnhancementService = require('./ImageEnhancementService');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure multer for temporary file storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/temp/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
  },
});

// Create multer upload middleware
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Accept only images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
});

class CloudinaryService {
  static getUploadMiddleware() {
    return upload;
  }

  static async uploadImage(file) {
    let enhancedImagePath = null;
    
    try {
      // Create enhanced version of the image
      const enhancedFileName = `enhanced_${Date.now()}_${path.basename(file.filename)}`;
      enhancedImagePath = path.join('uploads/temp/', enhancedFileName);
      
      // Apply AI-powered image enhancement
      await ImageEnhancementService.autoEnhance(file.path, enhancedImagePath);
      
      // Upload the enhanced image to Cloudinary
      const result = await cloudinary.uploader.upload(enhancedImagePath, {
        folder: 'zelyx-products',
        transformation: [
          { width: 1920, height: 1080, crop: 'limit' }, // Higher resolution for better quality
          { quality: '95' }, // Highest quality setting
          { fetch_format: 'auto' },
          { flags: 'progressive' } // Progressive JPEG for better loading
        ],
      });
      
      // Clean up temporary files
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      if (enhancedImagePath && fs.existsSync(enhancedImagePath)) {
        fs.unlinkSync(enhancedImagePath);
      }
      
      return {
        url: result.secure_url,
        public_id: result.public_id,
      };
    } catch (error) {
      // Clean up temporary files on error
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      if (enhancedImagePath && fs.existsSync(enhancedImagePath)) {
        fs.unlinkSync(enhancedImagePath);
      }
      throw new Error(`Image upload failed: ${error.message}`);
    }
  }

  static async deleteImage(publicId) {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      return result;
    } catch (error) {
      throw new Error(`Image deletion failed: ${error.message}`);
    }
  }

  static async uploadMultipleImages(files) {
    try {
      const uploadPromises = files.map(file => this.uploadImage(file));
      const results = await Promise.all(uploadPromises);
      return results;
    } catch (error) {
      throw new Error(`Multiple image upload failed: ${error.message}`);
    }
  }
}

module.exports = CloudinaryService;