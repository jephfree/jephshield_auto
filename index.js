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
      amount: amount * 100
    }, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const { authorization_url } = response.data.data;
    console.log(`Initialized payment for ${email}, redirecting to: ${authorization_url}`);

    return res.json({ authorization_url });

  } catch (error) {
    console.error('Payment init failed:', error.response?.data || error.message);
    return res.status(500).json({ message: 'Payment initialization failed' });
  }
});

// Route: Handle Paystack webhook
app.post('/verify-payment', (req, res) => {
  // TODO: Add signature verification here for security (optional)
  console.log('Webhook received:', req.body);

  res.status(200).send('Webhook acknowledged');
});

// Optional: Success route (for redirection after payment)
app.get('/success', (req, res) => {
  res.send('Payment successful. Thank you for subscribing to Jephshield VPN.');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Jephshield backend is running on port ${PORT}`);
});
