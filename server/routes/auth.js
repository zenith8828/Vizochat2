const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

let googleClient = null;
if (GOOGLE_CLIENT_ID) {
  const { OAuth2Client } = require('google-auth-library');
  googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
}

function issueToken(user) {
  return jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '30d' });
}

function findOrCreateUser({ google_id, username, email, profile_image }) {
  let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(google_id);
  const now = Date.now();
  if (!user) {
    user = {
      id: uuid(),
      google_id,
      username,
      email,
      profile_image,
      spendable_coins: 0,
      earned_coins: 0,
      account_status: 'active',
      ban_started_at: null,
      ban_expires_at: null,
      is_admin: 0,
      created_at: now,
      updated_at: now
    };
    db.prepare(`INSERT INTO users
      (id, google_id, username, email, profile_image, spendable_coins, earned_coins, account_status, ban_started_at, ban_expires_at, is_admin, created_at, updated_at)
      VALUES (@id, @google_id, @username, @email, @profile_image, @spendable_coins, @earned_coins, @account_status, @ban_started_at, @ban_expires_at, @is_admin, @created_at, @updated_at)`
    ).run(user);
  }
  return user;
}

// POST /api/auth/google  { id_token }
// Verifies the Google ID token server-side. Never trust a user object sent from the client.
router.post('/google', async (req, res) => {
  try {
    const { id_token } = req.body;
    if (!googleClient) {
      return res.status(400).json({ error: 'google_oauth_not_configured', message: 'Set GOOGLE_CLIENT_ID in .env, or use /api/auth/demo for local testing.' });
    }
    if (!id_token) return res.status(400).json({ error: 'id_token required' });

    const ticket = await googleClient.verifyIdToken({ idToken: id_token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();

    const user = findOrCreateUser({
      google_id: payload.sub,
      username: payload.name || payload.email.split('@')[0],
      email: payload.email,
      profile_image: payload.picture
    });

    const token = issueToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'google_verification_failed' });
  }
});

// POST /api/auth/demo  - only for local development/testing when GOOGLE_CLIENT_ID is not set.
router.post('/demo', (req, res) => {
  if (googleClient) {
    return res.status(400).json({ error: 'demo_login_disabled', message: 'Real Google OAuth is configured; use /api/auth/google.' });
  }
  const fakeId = 'demo-' + uuid();
  const user = findOrCreateUser({
    google_id: fakeId,
    username: 'Guest' + Math.floor(Math.random() * 9000 + 1000),
    email: fakeId + '@demo.local',
    profile_image: null
  });
  const token = issueToken(user);
  res.json({ token, user: publicUser(user), demo: true });
});

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    profile_image: u.profile_image,
    spendable_coins: u.spendable_coins,
    earned_coins: u.earned_coins,
    account_status: u.account_status,
    ban_expires_at: u.ban_expires_at,
    is_admin: !!u.is_admin
  };
}

module.exports = { router, publicUser };
