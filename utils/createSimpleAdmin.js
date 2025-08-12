const mongoose = require("mongoose");
const AdminUser = require("../models/AdminUser");
require("dotenv").config({ path: "./.env" });

async function createSimpleAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Delete all existing admin users
    await AdminUser.deleteMany({});
    console.log("Deleted all existing admin users");

    // Create the simple admin user
    const adminUser = new AdminUser({
      email: "admin@gmail.com",
      password: "ashen443",
      firstName: "Admin",
      lastName: "User",
      role: "super_admin",
      active: true,
    });

    await adminUser.save();
    console.log("Created simple admin user with email: admin@gmail.com");
  } catch (error) {
    console.error("Error creating simple admin:", error);
  } finally {
    mongoose.connection.close();
  }
}

createSimpleAdmin();
