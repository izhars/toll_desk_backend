// test.js - Simple script to test network upload
const fs = require('fs');
const path = require('path');

const NETWORK_PATH = '\\\\192.168.1.2\\appmedia\\20260423';

console.log('Testing Network Share...');
console.log(`Path: ${NETWORK_PATH}`);

// Check if accessible
if (fs.existsSync(NETWORK_PATH)) {
  console.log('✅ Network path exists');
  
  // Test write
  const testFile = path.join(NETWORK_PATH, `test-${Date.now()}.txt`);
  fs.writeFileSync(testFile, 'Test successful!');
  console.log('✅ File created successfully');
  
  fs.unlinkSync(testFile);
  console.log('✅ File deleted successfully');
  
  console.log('\n🎉 Network share is working perfectly!');
} else {
  console.log('❌ Network path not accessible');
  console.log('Run this command first:');
  console.log('net use \\\\192.168.1.2\\appmedia /user:IT Scaipl@2022');
}