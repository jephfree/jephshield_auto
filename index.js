const express = require('express');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const crypto = require('crypto');
const fs = require('fs');
const { parseISO, addDays, formatISO } = require('date-fns');

dotenv.config();

const app = express();
const premiumUsersFile = path.join(__dirname, 'premium-users.json');
const trialsFile = path.join(__dirname, 'trial-devices.json');
const premiumDeviceMapFile = path.join(__dirname, 'premium-device-map.json');
const serverUsageFile = path.join(__dirname, 'server_usage.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// USD base prices by country
const PRICES_USD = {
  NG: 2.99,
  GH: 3.5,
  US: 5,
  GB: 5,
  DEFAULT: 5
};

// Plan multipliers
const PLAN_MULTIPLIERS = {
  monthly: 1,
  '3months': 3,
  yearly: 12
};

const MAX_USERS_PER_SERVER = 25;

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

function getPremiumDeviceMap() {
  try {
    const data = fs.readFileSync(premiumDeviceMapFile, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function savePremiumDeviceMap(map) {
  fs.writeFileSync(premiumDeviceMapFile, JSON.stringify(map, null, 2));
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

function getServerUsage() {
  try {
    const data = fs.readFileSync(serverUsageFile, 'utf8');
    return JSON.parse(data);
  } catch {
    return { 'game-optimized-trial': [] };
  }
}

function saveServerUsage(data) {
  fs.writeFileSync(serverUsageFile, JSON.stringify(data, null, 2));
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

// --- Webhook Verification ---
app.post('/verify-payment', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = req.headers['x-paystack-signature'];
  const hash = crypto.createHmac('sha512', secret).update(req.body).digest('hex');

  if (hash !== signature) return res.status(401).send('Invalid signature');

  const event = JSON.parse(req.body.toString());
  if (event.event === 'charge.success') {
    const email = event.data.customer.email;
    const metadata = event.data.metadata || {};
    const deviceId = metadata.deviceId;

    if (email && deviceId) {
      addPremiumUser(email);
      const deviceMap = getPremiumDeviceMap();
      deviceMap[email] = deviceId;
      savePremiumDeviceMap(deviceMap);
      console.log(`✅ Payment verified: ${email} (Device: ${deviceId})`);
    } else {
      console.warn('⚠️ Missing email or deviceId in webhook metadata');
    }
  }

  res.sendStatus(200);
});

// --- Homepage ---
app.get('/', (req, res) => {
  res.send('JephShield backend running');
});

app.get('/subscribe', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

app.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

// --- Payment Initialization ---
app.post('/api/subscribe', async (req, res) => {
  const { email, plan, deviceId } = req.body;
  if (!email || !plan || !deviceId) {
    return res.status(400).json({ message: 'Email, plan, and device ID are required' });
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
        callback_url: 'https://jephshield-auto.onrender.com/success',
        metadata: {
          deviceId
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const { authorization_url } = response.data.data;
    console.log(`🧾 Initialized NGN payment for ${email} (${plan})`);
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
  const premiumMap = getPremiumDeviceMap();

  if (premiumMap[email] && premiumMap[email] !== deviceId) {
    return res.status(403).json({ message: 'Premium account already used on another device' });
  }

  if (trialDevices[deviceId]) {
    const trialStart = new Date(trialDevices[deviceId].start);
    const now = new Date();
    const diffDays = (now - trialStart) / (1000 * 60 * 60 * 24);

    if (diffDays < 3) {
      return res.status(403).json({
        message: 'Trial already active',
        trialActive: true,
        expiresIn: `${(3 - diffDays).toFixed(1)} days`
      });
    } else {
      return res.status(403).json({ message: 'Trial expired', trialActive: false });
    }
  }

  trialDevices[deviceId] = { email, start: new Date().toISOString() };
  saveTrialDevices(trialDevices);

  return res.json({ message: 'Trial started', trialActive: true, expiresIn: '3 days' });
});

// --- Premium Check ---
app.get('/api/is-premium', (req, res) => {
  const { email, deviceId } = req.query;
  if (!email || !deviceId) return res.status(400).json({ message: 'Email and device ID required' });

  const users = getPremiumUsers();
  const premiumMap = getPremiumDeviceMap();

  const isPremium = users.includes(email) && premiumMap[email] === deviceId;
  res.json({ email, isPremium });
});

// --- Trial Server Assignment with Usage Tracking ---
app.post('/api/get-trial-server', (req, res) => {
  const usageData = getServerUsage();
  const servers = usageData['game-optimized-trial'] || [];

  const available = servers.find(server => server.current_users < server.capacity);

  if (!available) {
    return res.status(503).json({ message: 'All trial servers are full. Please try again later.' });
  }

  // Increment current user count
  available.current_users += 1;
  saveServerUsage(usageData);

  // Calculate expiry: created_at + 7 days
  const expiresAt = formatISO(addDays(parseISO(available.created_at), 7), { representation: 'date' });

  const response = {
    server: {
      ip: available.ip,
      username: available.username,
      password: available.password,
      location: available.location,
      tags: available.tags,
      expires: expiresAt
    }
  };

  res.json(response);
});

// --- Server List for UI or Other Use ---
const vpnServers = [
  {
    name: "Trial Server 1",
    location: "France",
    ip: "51.159.125.25",
    username: "fastssh.com-jeph3",
    password: "134679",
    expires: "2025-06-20"
  },
  {
    name: "Trial Server 2",
    location: "France",
    ip: "51.159.125.25",
    username: "fastssh.com-jeph4",
    password: "134679",
    expires: "2025-06-20"
  },
  {
    name: "Trial Server 3",
    location: "France",
    ip: "51.159.125.25",
    username: "fastssh.com-jeph6",
    password: "134679",
    expires: "2025-06-20"
  },
  {
    name: "Trial Server 4",
    location: "South Africa",
    ip: "sa2.vpnjantit.com:1024",
    username: "jephfree-vpnjantit.com",
    password: "WireGuard (use private key)",
    expires: "2025-06-21"
  }
];

// Route to serve VPN server list (if needed)
app.get("/servers", (req, res) => {
  res.json(vpnServers);
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`JephShield backend is running on port ${PORT}`);
});
