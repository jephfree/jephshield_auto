const express = require('express');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const crypto = require('crypto');
const fs = require('fs');

dotenv.config();

const app = express();
const premiumUsersFile = path.join(__dirname, 'premium-users.json');
const USD_PRICING = {
  default: 5.00,
  NG: 2.99,
  GH: 3.50,
  ZA: 3.50,
  KE: 3.50
};

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

async function getExchangeRate(toCurrency) {
  try {
    const res = await axios.get('https://open.er-api.com/v6/latest/USD');
    return res.data.rates[toCurrency] || null;
  } catch (err) {
    console.error('❌ Failed to fetch exchange rate:', err.message);
    return null;
  }
}

function getCountryFromIP(ip) {
  return axios.get(`https://ipapi.co/${ip}/json/`)
    .then(res => res.data.country || null)
    .catch(() => null);
}

const supportedCurrencies = ['USD', 'NGN', 'GHS', 'ZAR', 'KES'];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/verify-payment', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = req.headers['x-paystack-signature'];
  const hash = crypto.createHmac('sha512', secret).update(req.body).digest('hex');

  if (hash !== signature) {
    console.warn('⚠️ Invalid Paystack signature!');
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(req.body.toString());
  if (event.event === 'charge.success') {
    const email = event.data.customer.email;
    const amount = event.data.amount / 100;
    console.log(`✅ Payment verified for ${email}, amount: ${amount}`);
    addPremiumUser(email);
  }

  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('JephShield VPN Backend is running!');
});

app.get('/subscribe', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

app.post('/api/subscribe', async (req, res) => {
  const { email, currency, countryCode } = req.body;
  if (!email) return res.status(400).json({ message: 'Missing email' });

  const userIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const country = countryCode || await getCountryFromIP(userIP) || 'US';

  let finalCurrency = currency || {
    NG: 'NGN',
    GH: 'GHS',
    ZA: 'ZAR',
    KE: 'KES'
  }[country] || 'USD';

  if (!supportedCurrencies.includes(finalCurrency)) {
    finalCurrency = 'USD';
  }

  const priceUSD = USD_PRICING[country] || USD_PRICING.default;
  const exchangeRate = finalCurrency === 'USD' ? 1 : await getExchangeRate(finalCurrency) || 1;
  const finalAmount = Math.round(priceUSD * exchangeRate * 100); // in kobo/cents

  try {
    const response = await axios.post('https://api.paystack.co/transaction/initialize', {
      email,
      amount: finalAmount,
      currency: finalCurrency,
      callback_url: 'https://jephshield-auto.onrender.com/success'
    }, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const { authorization_url } = response.data.data;
    console.log(`🧾 Initialized ${finalCurrency} payment for ${email}: ${authorization_url}`);
    res.json({ authorization_url });

  } catch (err) {
    console.error('❌ Payment init failed:', err.response?.data || err.message);
    res.status(500).json({ message: 'Payment initialization failed' });
  }
});

app.get('/success', (req, res) => {
  res.send(`
    <h1>Payment Successful 🎉</h1>
    <p>Thank you for subscribing to JephShield VPN.</p>
    <a href="/subscribe">Back to Subscription</a>
  `);
});

app.get('/api/is-premium', (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ message: 'Missing email' });

  const isPremium = getPremiumUsers().includes(email);
  res.json({ email, isPremium });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`JephShield backend is running on port ${PORT}`);
});
