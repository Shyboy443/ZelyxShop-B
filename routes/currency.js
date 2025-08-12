const express = require('express');
const axios = require('axios');
const router = express.Router();

// Cache for exchange rates
let exchangeRateCache = {
  rates: null,
  lastUpdated: null,
  ttl: 3600000 // 1 hour in milliseconds
};

// @desc    Get current exchange rates
// @route   GET /api/currency/rates
// @access  Public
router.get('/rates', async (req, res) => {
  try {
    const now = new Date().getTime();
    
    // Check if we have cached rates that are still valid
    if (exchangeRateCache.rates && 
        exchangeRateCache.lastUpdated && 
        (now - exchangeRateCache.lastUpdated) < exchangeRateCache.ttl) {
      return res.json({
        success: true,
        data: {
          ...exchangeRateCache.rates,
          cached: true,
          lastUpdated: new Date(exchangeRateCache.lastUpdated)
        }
      });
    }

    // Try multiple exchange rate APIs for better reliability
    let response;
    let rates;
    
    try {
      // Try exchangerate-api.com first
      response = await axios.get(
        'https://api.exchangerate-api.com/v4/latest/LKR',
        { timeout: 5000 }
      );
      
      if (response.data && response.data.rates && response.data.rates.USD) {
        rates = {
          base: 'LKR',
          rates: {
            USD: response.data.rates.USD,
            LKR: 1
          },
          date: response.data.date || new Date().toISOString().split('T')[0]
        };
      } else {
        throw new Error('Invalid response from primary exchange rate API');
      }
    } catch (primaryError) {
      console.log('Primary exchange rate API failed, trying fallback...');
      
      try {
        // Fallback to fixer.io (free tier)
        response = await axios.get(
          'https://api.fixer.io/latest?base=USD&symbols=LKR',
          { timeout: 5000 }
        );
        
        if (response.data && response.data.rates && response.data.rates.LKR) {
          rates = {
            base: 'LKR',
            rates: {
              USD: 1 / response.data.rates.LKR, // Convert USD->LKR to LKR->USD
              LKR: 1
            },
            date: response.data.date || new Date().toISOString().split('T')[0]
          };
        } else {
          throw new Error('Invalid response from fallback exchange rate API');
        }
      } catch (fallbackError) {
        throw new Error('All exchange rate APIs failed');
      }
    }

    // Update cache
    exchangeRateCache = {
      rates,
      lastUpdated: now,
      ttl: 3600000
    };

    res.json({
      success: true,
      data: {
        ...rates,
        cached: false,
        lastUpdated: new Date(now)
      }
    });
  } catch (error) {
    console.error('Exchange rate API error:', error.message);
    
    // Return fallback rates if API fails
    const fallbackRates = {
      base: 'LKR',
      rates: {
        USD: 0.003, // Approximate fallback rate
        LKR: 1
      },
      date: new Date().toISOString().split('T')[0],
      fallback: true
    };

    res.json({
      success: true,
      data: {
        ...fallbackRates,
        cached: false,
        lastUpdated: new Date(),
        warning: 'Using fallback exchange rates due to API unavailability'
      }
    });
  }
});

// @desc    Convert amount between currencies
// @route   POST /api/currency/convert
// @access  Public
router.post('/convert', async (req, res) => {
  try {
    const { amount, from, to } = req.body;

    if (!amount || !from || !to) {
      return res.status(400).json({
        success: false,
        message: 'Amount, from, and to currencies are required'
      });
    }

    if (!['LKR', 'USD'].includes(from) || !['LKR', 'USD'].includes(to)) {
      return res.status(400).json({
        success: false,
        message: 'Only LKR and USD currencies are supported'
      });
    }

    // If same currency, return original amount
    if (from === to) {
      return res.json({
        success: true,
        data: {
          originalAmount: amount,
          convertedAmount: amount,
          from,
          to,
          rate: 1
        }
      });
    }

    // Get current rates
    const ratesResponse = await axios.get(
      `${req.protocol}://${req.get('host')}/api/currency/rates`
    );

    const rates = ratesResponse.data.data.rates;
    let convertedAmount;
    let rate;

    if (from === 'LKR' && to === 'USD') {
      rate = rates.USD;
      convertedAmount = amount * rate;
    } else if (from === 'USD' && to === 'LKR') {
      rate = 1 / rates.USD;
      convertedAmount = amount * rate;
    }

    res.json({
      success: true,
      data: {
        originalAmount: amount,
        convertedAmount: Math.round(convertedAmount * 100) / 100,
        from,
        to,
        rate: Math.round(rate * 1000000) / 1000000
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error converting currency',
      error: error.message
    });
  }
});

// @desc    Get supported currencies
// @route   GET /api/currency/supported
// @access  Public
router.get('/supported', (req, res) => {
  res.json({
    success: true,
    data: {
      currencies: [
        {
          code: 'LKR',
          name: 'Sri Lankan Rupee',
          symbol: 'Rs.',
          default: true
        },
        {
          code: 'USD',
          name: 'US Dollar',
          symbol: '$',
          default: false
        }
      ]
    }
  });
});

// @desc    Get currency API information
// @route   GET /api/currency
// @access  Public
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Currency API',
    endpoints: {
      rates: '/api/currency/rates',
      supported: '/api/currency/supported'
    }
  });
});

module.exports = router;