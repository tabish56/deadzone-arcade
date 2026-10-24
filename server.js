require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Explicitly import the downloaded network handler
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/token', async (req, res) => {
  try {
    const { code } = req.body;
    const response = await fetch('https://discord.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
      }),
    });
    const data = await response.json();
    res.json({ access_token: data.access_token });
  } catch (err) {
    res.status(500).json({ error: 'Connection error' });
  }
});

app.listen(PORT, () => console.log(`Server live at http://localhost:${PORT}`));
