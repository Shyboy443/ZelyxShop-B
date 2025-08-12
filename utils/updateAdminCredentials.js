const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const AdminUser = require('../models/AdminUser');
require('dotenv').config();

async function updateAdminCredentials() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    const admin = await AdminUser.findOne({ role: 'super_admin' });
    if (!admin) {
      console.log('❌ No super_admin found');
      return;
    }
    
    console.log(`📧 Current admin email: ${admin.email}`);
    
    // Update email
    const newEmail = process.env.ADMIN_EMAIL || 'admin@zelyx.shop';
    admin.email = newEmail;
    
    // Update password
    const newPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    admin.password = hashedPassword;
    
    await admin.save();
    
    console.log(`✅ Updated admin credentials:`);
    console.log(`   Email: ${newEmail}`);
    console.log(`   Password: ${newPassword}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

updateAdminCredentials();