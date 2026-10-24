require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Secure Token Exchange Gateway mapping directly to Discord OAuth API
app.post('/api/token', async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Authorization code missing' });
    }

    const response = await globalThis.fetch('https://discord.com', {
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
    
    if (data.error) {
      console.error("Discord Auth rejected handshake:", data);
      return res.status(400).json(data);
    }

    res.json({ access_token: data.access_token });
  } catch (err) {
    console.error('Server integration error:', err);
    res.status(500).json({ error: 'Internal server proxy link failed' });
  }
});

app.listen(PORT, () => console.log(`Server live at http://localhost:${PORT}`));
