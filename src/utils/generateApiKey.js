const crypto = require('crypto');

/**
 * Generate secure API keys
 * Usage: node src/utils/generateApiKey.js [count]
 */

function generateApiKey(prefix = 'cls') {
  const randomBytes = crypto.randomBytes(32);
  const key = randomBytes.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  return `${prefix}_${key}`;
}

// Get count from command line args
const count = parseInt(process.argv[2]) || 1;

console.log('\n🔑 Generated API Keys:\n');

for (let i = 0; i < count; i++) {
  const key = generateApiKey();
  console.log(`${i + 1}. ${key}`);
}

console.log('\n💡 Add these to your .env file:');
const keys = Array.from({ length: count }, () => generateApiKey()).join(',');
console.log(`API_KEYS=${keys}\n`);

module.exports = generateApiKey;
