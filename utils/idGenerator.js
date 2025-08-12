const crypto = require("crypto");
const mongoose = require("mongoose");

/**
 * Generate a cryptographically secure, unpredictable ID
 * @param {string} prefix - Prefix for the ID (e.g., 'ZLX', 'DLV')
 * @param {number} length - Length of the random part (default: 12)
 * @returns {string} - Secure ID with prefix
 */
function generateSecureId(prefix = "", length = 12) {
  // Generate random bytes and convert to base36 (0-9, a-z)
  const randomBytes = crypto.randomBytes(Math.ceil(length * 0.75));
  const randomString = randomBytes
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "") // Remove special characters
    .toUpperCase()
    .substring(0, length);

  return `${prefix}${randomString}`;
}

/**
 * Generate a unique order number
 * @returns {Promise<string>} - Unique order number
 */
async function generateUniqueOrderNumber() {
  const Order = mongoose.model("Order");
  let orderNumber;
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 10;

  while (!isUnique && attempts < maxAttempts) {
    orderNumber = generateSecureId("ZLX", 10);

    // Check if this order number already exists
    const existingOrder = await Order.findOne({ orderNumber });
    if (!existingOrder) {
      isUnique = true;
    }
    attempts++;
  }

  if (!isUnique) {
    throw new Error(
      "Failed to generate unique order number after multiple attempts"
    );
  }

  return orderNumber;
}

/**
 * Generate a unique delivery ID
 * @returns {Promise<string>} - Unique delivery ID
 */

/**
 * Generate a secure transaction ID
 * @param {string} prefix - Prefix for the transaction ID
 * @returns {string} - Secure transaction ID
 */
function generateTransactionId(prefix = "TXN") {
  return generateSecureId(prefix, 16);
}

/**
 * Generate a secure reference ID for various purposes
 * @param {string} prefix - Prefix for the reference ID
 * @param {number} length - Length of the random part
 * @returns {string} - Secure reference ID
 */
function generateReferenceId(prefix = "REF", length = 8) {
  return generateSecureId(prefix, length);
}

module.exports = {
  generateSecureId,
  generateUniqueOrderNumber,
  generateTransactionId,
  generateReferenceId,
};
