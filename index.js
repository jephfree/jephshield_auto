const express = require('express');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const crypto = require('crypto');
const fs = require('fs');

dotenv.config();

const app = express();
const premiumUsersFile = path.join(__dirname, 'premium-users.json');
const trialsFile = path.join(__dirname, 'trial-devices.json');

// USD base prices by country
const PRICES_USD = {
  NG: 2.99,
  GH: 3.5,
  US: 5,
  GB: 5,
  DEFAULT: 5
};

// Multipliers
const PLAN_MULTIPLIERS = {
  monthly: 1,
  '3months': 3,
  yearly: 12
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Premium User Helpers ---
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

// --- Trial Helpers ---
function getTrialDevices() {
  try {
    const data = fs.readFileSync(trialsFile, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveTrialDevices(devices) {
  fs.writeFileSync(trialsFile, JSON.stringify(devices, null, 2));
}

// Detect country from IP
async function detectCountry(ip) {
  try {
    const res = await axios.get(`https://ipapi.co/${ip}/json/`);
    return res.data.country_code || 'DEFAULT';
  } catch {
    return 'DEFAULT';
  }
}

// USD to NGN exchange
async function getNairaRate() {
  try {
    const res = await axios.get('https://open.er-api.com/v6/latest/USD');
    return res.data.rates['NGN'] || 1500;
  } catch {
    console.warn('Fallback exchange rate used (NGN = 1500)');
    return 1500;
  }
}

// --- Verify Paystack payment ---
app.post('/verify-payment', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = req.headers['x-paystack-signature'];
  const hash = crypto.createHmac('sha512', secret).update(req.body).digest('hex');

  if (hash !== signature) return res.status(401).send('Invalid signature');

  const event = JSON.parse(req.body.toString());
  if (event.event === 'charge.success') {
    const email = event.data.customer.email;
    addPremiumUser(email);
    console.log(`✅ Payment verified: ${email}`);
  }

  res.sendStatus(200);
});

// --- Routes ---
app.get('/', (req, res) => {
  res.send('JephShield backend running');
});

app.get('/subscribe', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

// --- Subscribe and initialize payment ---
app.post('/api/subscribe', async (req, res) => {
  const { email, plan } = req.body;
  if (!email || !plan) {
    return res.status(400).json({ message: 'Email and plan are required' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.connection.remoteAddress;
  const country = await detectCountry(ip);
  const baseUSD = PRICES_USD[country] || PRICES_USD.DEFAULT;
  const multiplier = PLAN_MULTIPLIERS[plan] || 1;
  const totalUSD = baseUSD * multiplier;

  const exchangeRate = await getNairaRate();
  const amountNGN = Math.round(totalUSD * exchangeRate * 100); // Paystack uses kobo

  try {
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: amountNGN,
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
    console.log(`🧾 Initialized NGN payment for ${email} (${plan}): ${authorization_url}`);
    return res.json({ authorization_url });

  } catch (err) {
    const errorData = err.response?.data || err.message;
    console.error('❌ Payment init failed:', errorData);

    return res.status(500).json({
      message: 'Payment initialization failed',
      error: errorData
    });
  }
});

// --- Free Trial ---
app.post('/api/start-trial', (req, res) => {
  const { deviceId, email } = req.body;
  if (!deviceId || !email) {
    return res.status(400).json({ message: 'Device ID and email are required' });
  }

  const trialDevices = getTrialDevices();

  if (trialDevices[deviceId]) {
    const trialStart = new Date(trialDevices[deviceId].start);
    const now = new Date();
    const diffDays = (now - trialStart) / (1000 * 60 * 60 * 24);

    if (diffDays < 3) {
      return res.status(403).json({
        message: 'Trial already active',
        trialActive: true,
        expiresInDays: (3 - diffDays).toFixed(1)
      });
    } else {
      return res.status(403).json({ message: 'Trial expired', trialActive: false });
    }
  }

  trialDevices[deviceId] = { email, start: new Date().toISOString() };
  saveTrialDevices(trialDevices);

  return res.json({ message: 'Trial started', trialActive: true, expiresInDays: 3 });
});

// --- Success Page ---
app.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

// --- Check Premium ---
app.get('/api/is-premium', (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ message: 'Email is required' });

  const isPremium = getPremiumUsers().includes(email);
  res.json({ email, isPremium });
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`JephShield backend is running on port ${PORT}`);
});
