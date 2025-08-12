const mongoose = require("mongoose");
const UserAccessToken = require("../models/UserAccessToken");
require("dotenv").config();

async function cleanupTokens() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Find and delete records with null tokens
    const result = await UserAccessToken.deleteMany({ token: null });
    console.log(`Deleted ${result.deletedCount} records with null tokens`);

    // Check for any remaining problematic records
    const nullTokens = await UserAccessToken.find({
      token: null,
    }).countDocuments();
    console.log(`Remaining records with null tokens: ${nullTokens}`);

    // List all indexes
    const indexes = await UserAccessToken.collection.getIndexes();
    console.log("Current indexes:", Object.keys(indexes));

    console.log("Cleanup completed");
  } catch (error) {
    console.error("Error during cleanup:", error);
  } finally {
    await mongoose.disconnect();
  }
}

cleanupTokens();
