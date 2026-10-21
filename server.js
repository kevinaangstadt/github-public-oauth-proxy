import express from 'express';
import cors from 'cors';

const app = express();
app.use(express.json());

// 1. Constrain CORS strictly to local development addresses
const ALLOWED_ORIGIN_REGEX = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server or requests matching local loopback
    if (!origin || ALLOWED_ORIGIN_REGEX.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS policy'));
    }
  },
  methods: ['POST']
}));

app.post('/authenticate', async (req, res) => {
  const { code, state } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Missing code parameter' });
  }

  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        state
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(400).json(data);
    }

    // --- SCOPE CREEP GUARD ---
    // If your assignment only deals with public data, data.scope MUST be empty.
    // GitHub returns an empty string "" (or undefined) when no scopes were requested.
    const grantedScopes = data.scope ? data.scope.split(',').map(s => s.trim()) : [];

    // Define what your proxy permits. For public repos, this should be empty.
    const ALLOWED_SCOPES = []; 

    const hasUnauthorizedScope = grantedScopes.some(s => !ALLOWED_SCOPES.includes(s));

    if (hasUnauthorizedScope) {
      // Optional security cleanup: Delete the token immediately so it can't be used
      await fetch(`https://api.github.com/applications/${process.env.GITHUB_CLIENT_ID}/grant`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`).toString('base64'),
          'Accept': 'application/vnd.github+json'
        },
        body: JSON.stringify({ access_token: data.access_token })
      }).catch(() => {}); // Best-effort revocation

      return res.status(403).json({
        error: 'invalid_scope',
        error_description: `Unauthorized scope requested: "${data.scope}". Do not request extra permissions.`
      });
    }

    // Only return the token if scope requirements are met
    res.json(data);

  } catch (err) {
    res.status(500).json({ error: 'Failed to exchange token with GitHub' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Auth proxy listening on port ${PORT}`));