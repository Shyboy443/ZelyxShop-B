const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Category = require("../models/Category");
const { protect } = require("../middlewares/auth");
const { validateProduct } = require("../middlewares/validation");

// @desc    Get all products
// @route   GET /api/products
// @access  Public
router.get("/", async (req, res) => {
  try {
    const {
      category,
      featured,
      search,
      minPrice,
      maxPrice,
      inStock,
      sort = "createdAt",
      order = "desc",
      page = 1,
      limit = 12,
    } = req.query;

    // Build query
    let query = { active: true };

    if (category) {
      query.category = category;
    }

    if (featured === "true") {
      query.featured = true;
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    // Price filtering
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) {
        query.price.$gte = parseFloat(minPrice);
      }
      if (maxPrice) {
        query.price.$lte = parseFloat(maxPrice);
      }
    }

    // Stock filtering
    if (inStock === "true") {
      query.availability = { $gt: 0 };
    }

    // Build sort object
    const sortObj = {};
    sortObj[sort] = order === "desc" ? -1 : 1;

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query
    const products = await Product.find(query)
      .populate("category", "name slug")
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));

    // Get assignment counts for auto-delivery products
    const Inventory = require("../models/Inventory");
    const productsWithAssignments = await Promise.all(
      products.map(async (product) => {
        const productObj = product.toObject();
        
        if (product.autoDelivery) {
          // Get assignment count using the same logic as admin routes
          const assignmentResult = await Inventory.aggregate([
            {
              $match: {
                product: product._id,
                status: "available"
              }
            },
            {
              $lookup: {
                from: "inventoryassignments",
                localField: "_id",
                foreignField: "inventory",
                as: "assignments"
              }
            },
            {
              $addFields: {
                activeAssignments: {
                  $size: {
                    $filter: {
                      input: "$assignments",
                      cond: { $eq: ["$$this.status", "active"] }
                    }
                  }
                }
              }
            },
            {
              $group: {
                _id: null,
                totalAssignments: { $sum: "$activeAssignments" },
                totalMaxAssignments: { $sum: { $ifNull: ["$maxAssignments", 1] } }
              }
            }
          ]);
          
          const assignmentData = assignmentResult[0] || { totalAssignments: 0, totalMaxAssignments: 0 };
          productObj.assignmentCount = assignmentData.totalAssignments;
          productObj.maxAssignments = assignmentData.totalMaxAssignments;
        }
        
        return productObj;
      })
    );

    // Get total count for pagination
    const total = await Product.countDocuments(query);

    res.json({
      success: true,
      data: productsWithAssignments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching products",
      error: error.message,
    });
  }
});

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Build query - check if id is a valid ObjectId format
    let query = { active: true };

    if (mongoose.isValidObjectId(id)) {
      // Valid ObjectId format - search by both _id and slug
      query.$or = [{ _id: id }, { slug: id }];
    } else {
      // Not a valid ObjectId - search only by slug
      query.slug = id;
    }

    const product = await Product.findOne(query).populate(
      "category",
      "name slug"
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Get related products from same category (if category exists)
    let relatedProducts = [];
    if (product.category) {
      relatedProducts = await Product.find({
        category: product.category._id,
        _id: { $ne: product._id },
        active: true,
      })
        .populate("category", "name slug")
        .limit(4);
    }

    res.json({
      success: true,
      data: {
        product,
        relatedProducts,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching product",
      error: error.message,
    });
  }
});

// @desc    Get products by category
// @route   GET /api/products/category/:categorySlug
// @access  Public
router.get("/category/:categorySlug", async (req, res) => {
  try {
    const { categorySlug } = req.params;
    const {
      sort = "createdAt",
      order = "desc",
      page = 1,
      limit = 12,
    } = req.query;

    // Find category
    const category = await Category.findOne({
      slug: categorySlug,
      active: true,
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Build sort object
    const sortObj = {};
    sortObj[sort] = order === "desc" ? -1 : 1;

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get products
    const products = await Product.find({
      category: category._id,
      active: true,
    })
      .populate("category", "name slug")
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const total = await Product.countDocuments({
      category: category._id,
      active: true,
    });

    res.json({
      success: true,
      data: {
        category,
        products,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching products by category",
      error: error.message,
    });
  }
});

module.exports = router;
