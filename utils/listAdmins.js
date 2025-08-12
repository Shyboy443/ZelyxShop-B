const mongoose = require("mongoose");
const AdminUser = require("../models/AdminUser");
require("dotenv").config();

async function listAdmins() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");
    const admins = await AdminUser.find({}, { email: 1, role: 1 });
    console.log("Admin users:");
    admins.forEach((admin) => {
      console.log(
        `- ID: ${admin._id}, Email: ${admin.email}, Role: ${admin.role}`
      );
    });
    await mongoose.disconnect();
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

listAdmins();
