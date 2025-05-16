const express = require('express');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Route: Root
app.get('/', (req, res) => {
  res.send('Jephshield Backend is running!');
});

// Route: Serve payment.html
app.get('/subscribe', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

// Route: Initialize payment via Paystack
app.post('/api/subscribe', async (req, res) => {
  const { email, amount } = req.body;

  if (!email || !amount) {
    return res.status(400).json({ message: 'Missing email or amount' });
  }

  try {
    const response = await axios.post('https://api.paystack.co/transaction/initialize', {
      email: email,
      amount: amount * 100  // Paystack expects amount in kobo (so multiply by 100)
    }, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const { authorization_url } = response.data.data;

    return res.json({ authorization_url });

  } catch (error) {
    console.error('Paystack initialize payment error:', error.response?.data || error.message);
    return res.status(500).json({ message: 'Payment initialization failed' });
  }
});

// Route: Handle Paystack payment verification webhook (optional but recommended)
app.post('/verify-payment', (req, res) => {
  // You will handle webhook events here
  // For now, just acknowledge receipt
  res.status(200).send('Webhook received');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Jephshield backend is running on port ${PORT}`);
});
