const AdminUser = require("../models/AdminUser");

const createDefaultAdmin = async () => {
  try {
    // Check if any admin user exists
    const existingAdmin = await AdminUser.findOne();

    if (existingAdmin) {
      console.log("✅ Admin user already exists");
      return;
    }

    // Create default admin user
    const defaultAdmin = new AdminUser({
      email: process.env.ADMIN_EMAIL || "admin@zelyx.shop",
      password: process.env.ADMIN_PASSWORD || "admin123",
      firstName: "Admin",
      lastName: "User",
      role: "super_admin",
    });

    await defaultAdmin.save();
    console.log("✅ Default admin user created successfully");
    console.log(`📧 Email: ${defaultAdmin.email}`);
    console.log(`🔑 Password: ${process.env.ADMIN_PASSWORD || "admin123"}`);
    console.log("⚠️  Please change the default password after first login!");
  } catch (error) {
    console.error("❌ Error creating default admin user:", error.message);
  }
};

module.exports = createDefaultAdmin;
