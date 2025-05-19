const express = require('express');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const crypto = require('crypto');

dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware: Capture raw body + parse JSON
app.post('/verify-payment', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = req.headers['x-paystack-signature'];

  const hash = crypto
    .createHmac('sha512', secret)
    .update(req.body) // Buffer
    .digest('hex');

  if (hash !== signature) {
    console.warn('⚠️ Invalid Paystack signature!');
    return res.status(401).send('Invalid signature');
  }

  // ✅ Parse the raw body into JSON
  const event = JSON.parse(req.body.toString());

  if (event.event === 'charge.success') {
    const customerEmail = event.data.customer.email;
    const amountPaid = event.data.amount / 100;

    console.log(`✅ Payment verified for ${customerEmail}, amount: ₦${amountPaid}`);

    // TODO: Mark user as premium here

    return res.status(200).send('Payment processed');
  }

  res.status(200).send('Unhandled event');
});

// Route: Root
app.get('/', (req, res) => {
  res.send('Jephshield Backend is running!');
});

// Route: Serve payment.html using /subscribe
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
      amount: amount * 100,
      callback_url: 'https://jephshield-auto.onrender.com/success'
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

// Route: Success page after payment
app.get('/success', (req, res) => {
  res.send('Payment successful. Thank you for subscribing to Jephshield VPN.');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Jephshield backend is running on port ${PORT}`);
});
