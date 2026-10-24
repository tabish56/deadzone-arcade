
require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

const DISCORD_TOKEN_URL =
  'https://discord.com/api/oauth2/token';

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

// Serve the existing game frontend.
app.use(express.static(path.join(__dirname, 'public')));

// Health check for local development and Render.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Exchange an Embedded App SDK authorization code.
app.post('/api/token', async (req, res) => {
  try {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.error('Discord OAuth environment variables are missing.');

      return res.status(500).json({
        error: 'server_configuration_error',
        message: 'Discord authentication is not configured.'
      });
    }

    const code = req.body?.code;

    if (typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'A valid authorization code is required.'
      });
    }

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code.trim()
    });

    // Exchange the code with Discord.
    const response = await fetch(DISCORD_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const responseText = await response.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      console.error(
        'Discord returned a non-JSON token response:',
        response.status
      );

      return res.status(502).json({
        error: 'discord_invalid_response',
        message: 'Discord returned an unexpected response.'
      });
    }

    if (!response.ok || !data.access_token) {
      console.error('Discord OAuth exchange failed:', {
        status: response.status,
        error: data.error || 'unknown_error',
        description: data.error_description || undefined
      });

      return res.status(502).json({
        error: 'discord_auth_failed',
        message: 'Discord authorization failed. Check server logs and OAuth configuration.'
      });
    }

    return res.json({
      access_token: data.access_token
    });
  } catch (error) {
    console.error('Token exchange error:', error.message);

    return res.status(500).json({
      error: 'internal_error',
      message: 'Unable to complete Discord authentication.'
    });
  }
});

// Start the server.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`DEADZONE server listening on port ${PORT}`);
});
