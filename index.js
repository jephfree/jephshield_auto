const express = require('express');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const crypto = require('crypto');
const fs = require('fs');

dotenv.config();

const app = express();

const premiumUsersFile = path.join(__dirname, 'premium-users.json');

// Helper functions to manage premium users
function getPremiumUsers() {
  try {
    const data = fs.readFileSync(premiumUsersFile, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function addPremiumUser(email) {
  const users = getPremiumUsers();
  if (!users.includes(email)) {
    users.push(email);
    fs.writeFileSync(premiumUsersFile, JSON.stringify(users, null, 2));
  }
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Webhook route with raw body and signature verification
app.post('/verify-payment', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = req.headers['x-paystack-signature'];

  const hash = crypto
    .createHmac('sha512', secret)
    .update(req.body)
    .digest('hex');

  if (hash !== signature) {
    console.warn('⚠️ Invalid Paystack signature!');
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(req.body.toString());

  if (event.event === 'charge.success') {
    const customerEmail = event.data.customer.email;
    const amountPaid = event.data.amount / 100;

    console.log(`✅ Payment verified for ${customerEmail}, amount: ₦${amountPaid}`);

    // Add user to premium list
    addPremiumUser(customerEmail);

    return res.status(200).send('Payment processed');
  }

  res.status(200).send('Unhandled event');
});

// Root route
app.get('/', (req, res) => {
  res.send('Jephshield Backend is running!');
});

// Serve subscription page
app.get('/subscribe', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

// Initialize payment route
app.post('/api/subscribe', async (req, res) => {
  const { email, amount } = req.body;

  if (!email || !amount) {
    return res.status(400).json({ message: 'Missing email or amount' });
  }

  try {
    const response = await axios.post('https://api.paystack.co/transaction/initialize', {
      email,
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

// Friendly success page
app.get('/success', (req, res) => {
  res.send(`
    <h1>Payment Successful 🎉</h1>
    <p>Thank you for subscribing to Jephshield VPN.</p>
    <p>Your premium access is now activated.</p>
    <a href="/subscribe">Back to subscription page</a>
  `);
});

// Route: Check premium status
app.get('/api/is-premium', (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res.status(400).json({ message: 'Missing email' });
  }

  const users = getPremiumUsers();
  const isPremium = users.includes(email);

  res.json({ email, isPremium });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Jephshield backend is running on port ${PORT}`);
});
