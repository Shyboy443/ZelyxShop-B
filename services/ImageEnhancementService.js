const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

class ImageEnhancementService {
  /**
   * Enhance image quality using Sharp with advanced processing
   * @param {string} inputPath - Path to the input image
   * @param {string} outputPath - Path for the enhanced output image
   * @param {Object} options - Enhancement options
   */
  static async enhanceImage(inputPath, outputPath, options = {}) {
    try {
      const {
        width = 1920,
        height = 1080,
        quality = 95,
        sharpen = true,
        denoise = true,
        enhanceColors = true,
        format = 'jpeg'
      } = options;

      let pipeline = sharp(inputPath)
        .resize(width, height, {
          fit: 'inside',
          withoutEnlargement: true,
          kernel: sharp.kernel.lanczos3 // High-quality resampling
        });

      // Apply noise reduction
      if (denoise) {
        pipeline = pipeline.median(1); // Light noise reduction
      }

      // Enhance colors and contrast
      if (enhanceColors) {
        pipeline = pipeline
          .modulate({
            brightness: 1.05, // Slight brightness boost
            saturation: 1.1,  // Enhanced saturation
            hue: 0
          })
          .gamma(1.1) // Improve contrast
          .normalize(); // Auto-level the image
      }

      // Apply sharpening
      if (sharpen) {
        pipeline = pipeline.sharpen({
          sigma: 1.0,
          flat: 1.0,
          jagged: 2.0
        });
      }

      // Set output format and quality
      if (format === 'jpeg') {
        pipeline = pipeline.jpeg({
          quality: quality,
          progressive: true,
          mozjpeg: true // Use mozjpeg encoder for better compression
        });
      } else if (format === 'webp') {
        pipeline = pipeline.webp({
          quality: quality,
          effort: 6 // Higher effort for better compression
        });
      }

      await pipeline.toFile(outputPath);
      
      return {
        success: true,
        outputPath,
        message: 'Image enhanced successfully'
      };
    } catch (error) {
      console.error('Image enhancement error:', error);
      throw new Error(`Image enhancement failed: ${error.message}`);
    }
  }

  /**
   * Get image metadata and quality metrics
   */
  static async analyzeImage(imagePath) {
    try {
      const metadata = await sharp(imagePath).metadata();
      
      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: metadata.size,
        density: metadata.density,
        hasAlpha: metadata.hasAlpha,
        channels: metadata.channels,
        colorspace: metadata.space
      };
    } catch (error) {
      throw new Error(`Image analysis failed: ${error.message}`);
    }
  }

  /**
   * Create multiple optimized versions of an image
   */
  static async createResponsiveVersions(inputPath, outputDir, baseName) {
    try {
      const versions = [
        { suffix: '_large', width: 1920, quality: 95 },
        { suffix: '_medium', width: 1200, quality: 90 },
        { suffix: '_small', width: 800, quality: 85 },
        { suffix: '_thumb', width: 400, quality: 80 }
      ];

      const results = [];

      for (const version of versions) {
        const outputPath = path.join(outputDir, `${baseName}${version.suffix}.jpg`);
        
        await this.enhanceImage(inputPath, outputPath, {
          width: version.width,
          quality: version.quality,
          sharpen: true,
          denoise: true,
          enhanceColors: true
        });

        results.push({
          size: version.suffix.replace('_', ''),
          path: outputPath,
          width: version.width,
          quality: version.quality
        });
      }

      return results;
    } catch (error) {
      throw new Error(`Responsive versions creation failed: ${error.message}`);
    }
  }

  /**
   * Auto-enhance image with intelligent settings based on content
   */
  static async autoEnhance(inputPath, outputPath) {
    try {
      const metadata = await this.analyzeImage(inputPath);
      
      // Determine optimal settings based on image characteristics
      let enhanceOptions = {
        width: Math.min(metadata.width, 1920),
        height: Math.min(metadata.height, 1080),
        quality: 95,
        sharpen: true,
        denoise: metadata.width > 1000, // Apply noise reduction for larger images
        enhanceColors: true
      };

      // Adjust settings for different image types
      if (metadata.width < 800 || metadata.height < 600) {
        // Small images - be more conservative
        enhanceOptions.sharpen = false;
        enhanceOptions.denoise = false;
        enhanceOptions.quality = 90;
      }

      if (metadata.channels === 1) {
        // Grayscale images
        enhanceOptions.enhanceColors = false;
      }

      return await this.enhanceImage(inputPath, outputPath, enhanceOptions);
    } catch (error) {
      throw new Error(`Auto-enhancement failed: ${error.message}`);
    }
  }
}

module.exports = ImageEnhancementService;