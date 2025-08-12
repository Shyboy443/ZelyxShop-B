const Category = require("../models/Category");
const Product = require("../models/Product");
const Inventory = require("../models/Inventory");
const Order = require("../models/Order");
const { generateUniqueOrderNumber } = require("../utils/idGenerator");

/**
 * Generate a slug from a name string
 * @param {string} name - The name to convert to slug
 * @returns {string} - The generated slug
 */
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
};

/**
 * Clear existing sample data to avoid duplicates
 */
const clearSampleData = async () => {
  try {
    console.log("🗑️ Starting sample data cleanup...");

    // Clear sample categories
    console.log("📂 Clearing sample categories...");
    const categoriesResult = await Category.deleteMany({
      name: {
        $in: [
          "Digital Games",
          "Streaming Services",
          "Software Licenses",
          "VPN Services",
        ],
      },
    });
    console.log(`✅ Deleted ${categoriesResult.deletedCount} categories`);

    // Clear sample products
    console.log("🛍️ Clearing sample products...");
    const productsResult = await Product.deleteMany({
      title: {
        $in: [
          "Steam Premium Account",
          "Netflix Premium Subscription",
          "Adobe Creative Suite License",
          "NordVPN Premium Account",
          "Spotify Premium Family",
          "Microsoft Office 365",
        ],
      },
    });
    console.log(`✅ Deleted ${productsResult.deletedCount} products`);

    // Clear sample inventory (all items with sample usernames)
    console.log("📦 Clearing sample inventory...");
    const inventoryResult = await Inventory.deleteMany({
      username: { $regex: /^user\d+_\d+@example\.com$/ },
    });
    console.log(`✅ Deleted ${inventoryResult.deletedCount} inventory items`);

    // Clear sample orders (orders with sample customer emails)
    console.log("📋 Clearing sample orders...");
    const ordersResult = await Order.deleteMany({
      "customer.email": {
        $in: [
          "customer1@example.com",
          "customer2@example.com",
          "customer3@example.com",
        ],
      },
    });
    console.log(`✅ Deleted ${ordersResult.deletedCount} orders`);

    console.log("🧹 Sample data cleanup completed successfully");
  } catch (error) {
    console.error("❌ Error clearing sample data:", error);
    throw error;
  }
};

/**
 * Create sample categories
 * @returns {Array} - Array of created categories
 */
const createSampleCategories = async () => {
  try {
    console.log("📂 Creating sample categories...");

    const sampleCategories = [
      {
        name: "Digital Games",
        slug: generateSlug("Digital Games"),
        description: "Premium digital game accounts and licenses",
        serviceProvider: "Steam, Epic Games, Origin",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: "Streaming Services",
        slug: generateSlug("Streaming Services"),
        description: "Premium streaming platform subscriptions",
        serviceProvider: "Netflix, Spotify, Disney+",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: "Software Licenses",
        slug: generateSlug("Software Licenses"),
        description: "Professional software licenses and tools",
        serviceProvider: "Adobe, Microsoft, Autodesk",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: "VPN Services",
        slug: generateSlug("VPN Services"),
        description: "Premium VPN subscriptions for privacy and security",
        serviceProvider: "NordVPN, ExpressVPN, Surfshark",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    console.log(
      `💾 Inserting ${sampleCategories.length} categories into database...`
    );
    const result = await Category.insertMany(sampleCategories);
    console.log(`✅ Successfully created ${result.length} categories`);

    return result;
  } catch (error) {
    console.error("❌ Error creating sample categories:", error);
    throw error;
  }
};

/**
 * Create sample products
 * @param {Array} categories - Array of categories to associate products with
 * @returns {Array} - Array of created products
 */
const createSampleProducts = async (categories) => {
  try {
    console.log(
      `🛍️ Creating sample products for ${categories.length} categories...`
    );

    if (!categories || categories.length === 0) {
      throw new Error("No categories provided for product creation");
    }
    const sampleProducts = [
      {
        title: "Steam Premium Account",
        slug: generateSlug("Steam Premium Account"),
        description:
          "Premium Steam gaming account with access to exclusive games and features. Includes game library with popular titles and community features.",
        images: [
          {
            url: "https://via.placeholder.com/400x300/1b2838/ffffff?text=Steam+Account",
            public_id: "sample_steam_account",
          },
        ],
        price: 29.99,
        features: [
          "Access to Steam library",
          "Community features",
          "Workshop access",
          "Achievement system",
        ],
        availability: 15,
        autoDelivery: true,
        category: categories[0]._id,
        featured: true,
        active: true,
      },
      {
        title: "Netflix Premium Subscription",
        slug: generateSlug("Netflix Premium Subscription"),
        description:
          "1-month Netflix Premium subscription with 4K streaming and multiple device access for the ultimate entertainment experience.",
        images: [
          {
            url: "https://via.placeholder.com/400x300/e50914/ffffff?text=Netflix+Premium",
            public_id: "sample_netflix_premium",
          },
        ],
        price: 15.99,
        features: [
          "4K Ultra HD streaming",
          "Multiple device access",
          "Offline downloads",
          "No ads",
        ],
        availability: 25,
        autoDelivery: true,
        category: categories[1]._id,
        featured: false,
        active: true,
      },
      {
        title: "Adobe Creative Suite License",
        slug: generateSlug("Adobe Creative Suite License"),
        description:
          "Professional Adobe Creative Suite license including Photoshop, Illustrator, and Premiere Pro for creative professionals.",
        images: [
          {
            url: "https://via.placeholder.com/400x300/ff0000/ffffff?text=Adobe+Creative",
            public_id: "sample_adobe_creative",
          },
        ],
        price: 89.99,
        features: [
          "Photoshop CC",
          "Illustrator CC",
          "Premiere Pro CC",
          "Cloud storage",
          "Mobile apps",
        ],
        availability: 8,
        autoDelivery: false,
        category: categories[2]._id,
        featured: true,
        active: true,
      },
      {
        title: "NordVPN Premium Account",
        slug: generateSlug("NordVPN Premium Account"),
        description:
          "1-year NordVPN premium subscription with unlimited bandwidth and global server access for maximum privacy and security.",
        images: [
          {
            url: "https://via.placeholder.com/400x300/4687ff/ffffff?text=NordVPN+Premium",
            public_id: "sample_nordvpn_premium",
          },
        ],
        price: 59.99,
        features: [
          "5500+ servers worldwide",
          "No logs policy",
          "Kill switch",
          "Double VPN",
          "Threat protection",
        ],
        availability: 12,
        autoDelivery: true,
        category: categories[3]._id,
        featured: false,
        active: true,
      },
      {
        title: "Spotify Premium Family",
        slug: generateSlug("Spotify Premium Family"),
        description:
          "6-month Spotify Premium Family plan for up to 6 users with ad-free music streaming and offline downloads.",
        images: [
          {
            url: "https://via.placeholder.com/400x300/1db954/ffffff?text=Spotify+Family",
            public_id: "sample_spotify_family",
          },
        ],
        price: 45.99,
        features: [
          "6 Premium accounts",
          "Ad-free music",
          "Offline downloads",
          "High quality audio",
          "Family mix",
        ],
        availability: 20,
        autoDelivery: true,
        category: categories[1]._id,
        featured: false,
        active: true,
      },
      {
        title: "Microsoft Office 365",
        slug: generateSlug("Microsoft Office 365"),
        description:
          "1-year Microsoft Office 365 subscription with Word, Excel, PowerPoint, and cloud storage for productivity and collaboration.",
        images: [
          {
            url: "https://via.placeholder.com/400x300/0078d4/ffffff?text=Office+365",
            public_id: "sample_office_365",
          },
        ],
        price: 69.99,
        features: [
          "Word, Excel, PowerPoint",
          "1TB OneDrive storage",
          "Teams collaboration",
          "Mobile apps",
        ],
        availability: 10,
        autoDelivery: false,
        category: categories[2]._id,
        featured: true,
        active: true,
      },
    ];

    console.log(
      `💾 Inserting ${sampleProducts.length} products into database...`
    );
    const result = await Product.insertMany(sampleProducts);
    console.log(`✅ Successfully created ${result.length} products`);

    return result;
  } catch (error) {
    console.error("❌ Error creating sample products:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      categoriesCount: categories ? categories.length : "undefined",
      categories: categories
        ? categories.map((c) => ({ id: c._id, name: c.name }))
        : "undefined",
    });
    throw error;
  }
};

/**
 * Create sample inventory
 * @param {Array} products - Array of products to create inventory for
 * @returns {Array} - Array of created inventory items
 */
const createSampleInventory = async (products) => {
  try {
    console.log(
      `📦 Creating sample inventory for ${products.length} products...`
    );

    if (!products || products.length === 0) {
      throw new Error("No products provided for inventory creation");
    }

    const sampleInventory = [];

    products.forEach((product, index) => {
      if (!product || !product._id) {
        console.error(`❌ Invalid product at index ${index}:`, product);
        throw new Error(`Invalid product at index ${index}: missing _id`);
      }

      // Create 3-5 inventory items per product
      const itemCount = Math.floor(Math.random() * 3) + 3;
      console.log(
        `📋 Creating ${itemCount} inventory items for product: ${product.title}`
      );

      for (let i = 0; i < itemCount; i++) {
        const username = `user${index + 1}_${i + 1}@example.com`;
        const password = `password${index + 1}${i + 1}`;
        const additionalInfo = `Sample credentials for ${
          product.title
        } - Item ${i + 1}`;

        const inventoryItem = {
          product: product._id,
          accountCredentials: `Username: ${username}\nPassword: ${password}\n\n${additionalInfo}`,
          username: username,
          password: password,
          isUsed: false,
          usedBy: null,
          deliveredAt: null,
          assignmentCount: 0,
          maxAssignments: 1,
          notes: `Sample inventory item for ${product.title}`,
          status: "available",
          expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
          allowUpdatesAfterExpiry: true,
          originalDeliveryDate: null,
        };

        sampleInventory.push(inventoryItem);
      }
    });

    console.log(
      `💾 Inserting ${sampleInventory.length} inventory items into database...`
    );
    const result = await Inventory.insertMany(sampleInventory);
    console.log(`✅ Successfully created ${result.length} inventory items`);

    return result;
  } catch (error) {
    console.error("❌ Error creating sample inventory:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      productsCount: products ? products.length : "undefined",
      products: products
        ? products.map((p) => ({ id: p._id, title: p.title }))
        : "undefined",
    });
    throw error;
  }
};

/**
 * Create sample orders
 * @param {Array} products - Array of products to create orders for
 * @returns {Array} - Array of created orders
 */
const createSampleOrders = async (products) => {
  try {
    console.log(`📋 Creating sample orders for ${products.length} products...`);

    if (!products || products.length === 0) {
      throw new Error("No products provided for order creation");
    }
    const sampleOrders = [
      {
        orderNumber: await generateUniqueOrderNumber(),
        customer: {
          firstName: "John",
          lastName: "Doe",
          email: "customer1@example.com",
          phone: "+1234567890",
        },
        items: [
          {
            product: products[0]._id,
            title: products[0].title,
            price: products[0].price,
            quantity: 1,
            image: products[0].images[0].url,
            serviceType: "Gaming Account",
            duration: "Lifetime",
            features: products[0].features,
            autoDelivery: products[0].autoDelivery,
            deliveryStatus: "delivered",
            delivered: true,
            deliveredAt: new Date(Date.now() - 3600000), // 1 hour ago
            credentials:
              "Username: user1_sample@steam.com\nPassword: samplepass123\n\nAccount delivered successfully!",
          },
        ],
        subtotal: products[0].price,
        tax: 0,
        total: products[0].price,
        currency: "USD",
        exchangeRate: 1,
        status: "delivered",
        paymentStatus: "confirmed",
        paymentMethod: "crypto",
        paymentInfo: {
          transactionId: "tx_sample_001",
          paidAt: new Date(Date.now() - 86400000), // 1 day ago
          amount: products[0].price,
          method: "manual",
        },
        paymentConfirmed: true,
        notes: "Sample order for testing purposes",
        deliveryInfo: {
          deliveredAt: new Date(Date.now() - 3600000), // 1 hour ago
          notes: "Auto-delivered successfully",
          method: "auto",
        },
        autoDeliveryEnabled: true,
        deliveredInventory: [],
        createdAt: new Date(Date.now() - 86400000), // 1 day ago
        updatedAt: new Date(Date.now() - 3600000), // 1 hour ago
      },
      {
        orderNumber: await generateUniqueOrderNumber(),
        customer: {
          firstName: "Jane",
          lastName: "Smith",
          email: "customer2@example.com",
          phone: "+1234567891",
        },
        items: [
          {
            product: products[1]._id,
            title: products[1].title,
            price: products[1].price,
            quantity: 1,
            image: products[1].images[0].url,
            serviceType: "Streaming Service",
            duration: "1 Month",
            features: products[1].features,
            autoDelivery: products[1].autoDelivery,
            deliveryStatus: "pending",
            delivered: false,
          },
        ],
        subtotal: products[1].price,
        tax: 0,
        total: products[1].price,
        currency: "USD",
        exchangeRate: 1,
        status: "pending",
        paymentStatus: "pending",
        paymentMethod: "bank_deposit",
        paymentInfo: {
          amount: products[1].price,
        },
        paymentConfirmed: false,
        notes: "Awaiting payment confirmation",
        autoDeliveryEnabled: true,
        deliveredInventory: [],
        paymentTimeout: {
          expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000), // 6 hours from now
          isExpired: false,
          notificationSent: false,
        },
        createdAt: new Date(Date.now() - 43200000), // 12 hours ago
        updatedAt: new Date(Date.now() - 43200000), // 12 hours ago
      },
      {
        orderNumber: await generateUniqueOrderNumber(),
        customer: {
          firstName: "Mike",
          lastName: "Johnson",
          email: "customer3@example.com",
          phone: "+1234567892",
        },
        items: [
          {
            product: products[2]._id,
            title: products[2].title,
            price: products[2].price,
            quantity: 1,
            image: products[2].images[0].url,
            serviceType: "Software License",
            duration: "1 Year",
            features: products[2].features,
            autoDelivery: products[2].autoDelivery,
            deliveryStatus: "pending",
            delivered: false,
          },
        ],
        subtotal: products[2].price,
        tax: 0,
        total: products[2].price,
        currency: "USD",
        exchangeRate: 1,
        status: "processing",
        paymentStatus: "confirmed",
        paymentMethod: "crypto",
        paymentInfo: {
          transactionId: "tx_sample_003",
          paidAt: new Date(Date.now() - 21600000), // 6 hours ago
          amount: products[2].price,
          method: "manual",
        },
        paymentConfirmed: true,
        notes: "Manual delivery required for software license",
        autoDeliveryEnabled: false,
        deliveredInventory: [],
        createdAt: new Date(Date.now() - 21600000), // 6 hours ago
        updatedAt: new Date(Date.now() - 10800000), // 3 hours ago
      },
    ];

    console.log(`💾 Inserting ${sampleOrders.length} orders into database...`);
    const result = await Order.insertMany(sampleOrders);
    console.log(`✅ Successfully created ${result.length} orders`);

    return result;
  } catch (error) {
    console.error("❌ Error creating sample orders:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      productsCount: products ? products.length : "undefined",
      products: products
        ? products.map((p) => ({ id: p._id, title: p.title }))
        : "undefined",
    });
    throw error;
  }
};

/**
 * Import all sample data
 * @returns {Object} - Object containing counts of created items
 */
const importSampleData = async () => {
  const createdCounts = {};

  try {
    console.log("🚀 Starting sample data import process...");

    // Clear existing sample data to avoid duplicates
    console.log("🧹 Clearing existing sample data...");
    await clearSampleData();
    console.log("✅ Sample data cleared successfully");

    // Create sample data in order
    console.log("📂 Creating sample categories...");
    const categories = await createSampleCategories();
    createdCounts.categories = categories.length;
    console.log(`✅ Created ${categories.length} categories`);

    console.log("🛍️ Creating sample products...");
    const products = await createSampleProducts(categories);
    createdCounts.products = products.length;
    console.log(`✅ Created ${products.length} products`);

    console.log("📦 Creating sample inventory...");
    const inventory = await createSampleInventory(products);
    createdCounts.inventory = inventory.length;
    console.log(`✅ Created ${inventory.length} inventory items`);

    console.log("📋 Creating sample orders...");
    const orders = await createSampleOrders(products);
    createdCounts.orders = orders.length;
    console.log(`✅ Created ${orders.length} orders`);

    console.log("🎉 Sample data import completed successfully!");
    console.log("📊 Final counts:", createdCounts);

    return createdCounts;
  } catch (error) {
    console.error("❌ Sample data import failed:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      createdCounts,
    });
    throw error;
  }
};

module.exports = {
  importSampleData,
  clearSampleData,
  createSampleCategories,
  createSampleProducts,
  createSampleInventory,
  createSampleOrders,
};
