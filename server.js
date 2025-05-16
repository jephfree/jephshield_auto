require('dotenv').config(); // Load environment variables

const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

// Paystack Integration
const Paystack = require('paystack-api');
const paystack = Paystack(process.env.PAYSTACK_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// VPN Servers JSON path
const vpnPath = path.join(__dirname, 'vpnServers.json');
function loadVpnServers() {
  if (!fs.existsSync(vpnPath)) return [];
  return JSON.parse(fs.readFileSync(vpnPath));
}
function saveVpnServers(data) {
  fs.writeFileSync(vpnPath, JSON.stringify(data, null, 2));
}

// Admin Users JSON path
const usersPath = path.join(__dirname, 'users.json');
function loadUsers() {
  if (!fs.existsSync(usersPath)) return [];
  return JSON.parse(fs.readFileSync(usersPath));
}
function saveUsers(data) {
  fs.writeFileSync(usersPath, JSON.stringify(data, null, 2));
}

// === LOGIN endpoint ===
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();

  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

  res.json({ message: 'Login successful', subscribed: user.subscribed || false });
});

// === Admin Panel Page ===
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// === Serve Payment Form ===
app.get('/subscribe', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

// === Add new VPN Server ===
app.post('/api/vpn-servers', (req, res) => {
  const { country, location, ip, port, username, password } = req.body;

  if (!country || !location) {
    return res.status(400).json({ message: 'Country and location are required.' });
  }

  const vpnServers = loadVpnServers();
  const newServer = {
    id: vpnServers.length + 1,
    country,
    location,
    ip,
    port,
    username,
    password
  };

  vpnServers.push(newServer);
  saveVpnServers(vpnServers);

  res.json({ message: 'VPN server added successfully.' });
});

// === List VPN Servers ===
app.get('/api/vpn-servers', (req, res) => {
  const servers = loadVpnServers();
  res.json(servers);
});

// === Delete VPN Server ===
app.delete('/api/vpn-servers/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  let vpnServers = loadVpnServers();

  const index = vpnServers.findIndex(s => s.id === id);
  if (index === -1) {
    return res.status(404).json({ message: 'Server not found.' });
  }

  vpnServers.splice(index, 1);
  vpnServers = vpnServers.map((s, i) => ({ ...s, id: i + 1 }));

  saveVpnServers(vpnServers);
  res.json({ message: 'VPN server deleted successfully.' });
});

// === Paystack Subscription Route ===
app.post('/api/subscribe', async (req, res) => {
  const { email, amount } = req.body;

  try {
    const response = await paystack.transaction.initialize({
      email,
      amount: amount * 100,  // Paystack uses kobo
      currency: 'NGN',
      callback_url: process.env.CALLBACK_URL
    });

    res.json({ authorization_url: response.data.authorization_url });
  } catch (error) {
    console.error('Payment Init Error:', error);
    res.status(500).json({ message: 'Payment initialization failed' });
  }
});

// === Paystack Payment Verification & Mark User Subscribed ===
app.get('/verify-payment', async (req, res) => {
  const { reference } = req.query;
  console.log('VERIFY CALLBACK HIT – reference:', reference);

  if (!reference) {
    console.error('No reference query parameter!');
    return res.status(400).send('Missing payment reference.');
  }

  try {
    const result = await paystack.transaction.verify({ reference });
    console.log('Paystack verify result:', result);

    const status = result.data?.status || result.status;
    const email = result.data?.customer?.email;

    if (status === 'success' && email) {
      const users = loadUsers();
      const user = users.find(u => u.email === email);

      if (user) {
        user.subscribed = true;
        saveUsers(users);
        console.log(`User ${email} marked as subscribed.`);
      }

      return res.send('Payment verified successfully. Access granted.');
    } else {
      return res.send(`Payment not successful: ${status}`);
    }
  } catch (error) {
    console.error('Verification Error:', error);
    return res.status(500).send(`Error verifying payment: ${error.message}`);
  }
});

// Start Server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

