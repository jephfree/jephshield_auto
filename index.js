const express = require('express');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const crypto = require('crypto');
const fs = require('fs');

dotenv.config();

const app = express();
const premiumUsersFile = path.join(__dirname, 'premium-users.json');
const USD_PRICE = 2.99; // Monthly premium cost in USD

// Load premium users
function getPremiumUsers() {
  try {
    return JSON.parse(fs.readFileSync(premiumUsersFile, 'utf8'));
  } catch {
    return [];
  }
}

// Save new premium user
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

// Routes
app.get('/', (req, res) => {
  res.send('Jephshield backend is running!');
});

app.get('/subscribe', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

app.get('/api/is-premium', (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ message: 'Missing email' });

  const isPremium = getPremiumUsers().includes(email);
  res.json({ email, isPremium });
});

// Initialize payment
app.post('/api/subscribe', async (req, res) => {
  const { email, amount } = req.body;
  if (!email || !amount || amount < 100) {
    return res.status(400).json({ message: 'Invalid email or amount' });
  }

  try {
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: Math.round(amount * 100),
        currency: 'NGN',
        callback_url: 'https://jephshield-auto.onrender.com/success'
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const { authorization_url } = response.data.data;
    console.log(`🧾 Initialized NGN payment for ${email}: ${authorization_url}`);
    res.json({ authorization_url });

  } catch (err) {
    console.error('❌ Payment init failed:', err.response?.data || err.message);
    res.status(500).json({ message: 'Payment initialization failed' });
  }
});

// Paystack webhook
app.post('/verify-payment', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.body)
    .digest('hex');

  if (hash !== signature) {
    console.warn('⚠️ Invalid Paystack signature!');
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(req.body.toString());
  if (event.event === 'charge.success') {
    const email = event.data.customer.email;
    const amountPaid = event.data.amount / 100;
    const currency = event.data.currency;

    try {
      const usdRate = await axios.get('https://open.er-api.com/v6/latest/USD');
      const conversionRate = usdRate.data.rates[currency] || null;

      if (conversionRate) {
        const paidInUSD = amountPaid / conversionRate;
        if (paidInUSD >= USD_PRICE) {
          addPremiumUser(email);
          console.log(`✅ ${email} marked as premium (paid ${paidInUSD.toFixed(2)} USD)`);
        } else {
          console.warn(`⚠️ ${email} paid less than required: $${paidInUSD.toFixed(2)} USD`);
        }
      } else {
        console.error(`❌ Currency ${currency} not found in exchange rates`);
      }
    } catch (err) {
      console.error('❌ Failed to fetch exchange rates:', err.message);
    }
  }

  res.sendStatus(200);
});

// Success page
app.get('/success', (req, res) => {
  res.send(`
    <h1>Payment Successful 🎉</h1>
    <p>Thank you for subscribing to Jephshield VPN.</p>
    <a href="/subscribe">Back to subscription page</a>
  `);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Jephshield backend is running on port ${PORT}`);
});
