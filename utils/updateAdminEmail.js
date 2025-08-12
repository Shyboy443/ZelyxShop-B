const mongoose = require('mongoose');
const AdminUser = require('../models/AdminUser');
require('dotenv').config();

async function updateAdminEmail() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    const admin = await AdminUser.findOne({ role: 'super_admin' });
    if (admin) {
      admin.email = process.env.ADMIN_EMAIL;
      await admin.save();
      console.log(`✅ Updated admin email to ${process.env.ADMIN_EMAIL}`);
    } else {
      console.log('❌ No super_admin found');
    }
    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

updateAdminEmail();