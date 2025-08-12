const mongoose = require("mongoose");
const UserAccessToken = require("../models/UserAccessToken");
require("dotenv").config();

async function fixIndexes() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Drop the old accessToken index
    try {
      await UserAccessToken.collection.dropIndex("accessToken_1");
      console.log("Dropped old accessToken_1 index");
    } catch (error) {
      console.log(
        "accessToken_1 index not found or already dropped:",
        error.message
      );
    }

    // List current indexes
    const indexes = await UserAccessToken.collection.getIndexes();
    console.log("Current indexes after cleanup:", Object.keys(indexes));

    console.log("Index fix completed");
  } catch (error) {
    console.error("Error during index fix:", error);
  } finally {
    await mongoose.disconnect();
  }
}

fixIndexes();
