const http = require('http');
const { exec } = require('child_process');
const readline = require('readline');

// Replace these with your actual values from Vercel env vars
const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3333/callback';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET env vars.');
  console.error('Run: GMAIL_CLIENT_ID=xxx GMAIL_CLIENT_SECRET=yyy node scripts/gmail-auth.js');
  process.exit(1);
}

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log('\n🔐 Gmail OAuth Re-Authorization\n');
console.log('Opening browser for Google login...');
console.log('If it does not open, paste this URL manually:\n');
console.log(authUrl + '\n');

// Try to open browser
exec(`open "${authUrl}"`);

// Start local server to catch the callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');

  if (!code) {
    res.end('No code found. Try again.');
    return;
  }

  res.end('<h2>✅ Authorization received! Check your terminal for the refresh token.</h2>');

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await tokenRes.json();

  if (tokens.error) {
    console.error('❌ Error getting tokens:', tokens);
    server.close();
    return;
  }

  console.log('\n✅ SUCCESS! Your new refresh token:\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(tokens.refresh_token);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('👉 Go to Vercel → Settings → Environment Variables');
  console.log('   Update GMAIL_REFRESH_TOKEN with the value above.\n');

  server.close();
});

server.listen(3333, () => {
  console.log('Waiting for Google to redirect to localhost:3333...\n');
});
