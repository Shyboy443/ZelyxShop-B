const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const AdminUser = require("../models/AdminUser");
require("dotenv").config({ path: "./.env" });

async function updateAdminPassword() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    const admin = await AdminUser.findOne({ role: "super_admin" });
    if (!admin) {
      console.log("No super admin found");
      return;
    }

    const newPassword = process.env.ADMIN_PASSWORD || "admin123";
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    admin.password = hashedPassword;
    await admin.save();

    console.log(`Updated super admin password for email: ${admin.email}`);
  } catch (error) {
    console.error("Error updating admin password:", error);
  } finally {
    mongoose.connection.close();
  }
}

updateAdminPassword();
