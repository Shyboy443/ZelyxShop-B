const express = require('express');
const app = express();

console.log('Testing currency route loading...');

try {
  const currencyRoute = require('./routes/currency');
  console.log('✅ Currency route loaded successfully');
  console.log('Currency route type:', typeof currencyRoute);
  console.log('Currency route methods:', Object.getOwnPropertyNames(currencyRoute));
  
  app.use('/api/currency', currencyRoute);
  
  const port = 3001;
  app.listen(port, () => {
    console.log(`Test server running on port ${port}`);
    console.log('Testing currency endpoint...');
    
    // Test the endpoint
    const http = require('http');
    const options = {
      hostname: 'localhost',
      port: port,
      path: '/api/currency/rates',
      method: 'GET'
    };
    
    const req = http.request(options, (res) => {
      console.log(`Status: ${res.statusCode}`);
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        console.log('Response:', data);
        process.exit(0);
      });
    });
    
    req.on('error', (e) => {
      console.error('Request error:', e.message);
      process.exit(1);
    });
    
    req.end();
  });
  
} catch (error) {
  console.error('❌ Currency route loading failed:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}