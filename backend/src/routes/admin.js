const express = require('express');
const db = require('../db');
const { hashPassword, verifyPassword, generateToken, hashToken } = require('../lib/crypto');
const { requireAdmin } = require('../middleware/auth');

const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 24);

const router = express.Router();

/* One-time bootstrap -- only succeeds while admin_account is empty, so no
   default/baked-in credential ever ships in the image. Alok runs this
   exactly once, right after first deploying the container, to set his own
   real username/password. */
router.post('/setup', async (req, res) => {
  const existing = db.getAdmin();
  if (existing) return res.status(409).json({ error: 'admin_already_configured' });
  const { username, password } = req.body || {};
  if (!username || !password || String(password).length < 8) {
    return res.status(400).json({ error: 'username_and_password_min_8_chars_required' });
  }
  const hash = await hashPassword(password);
  db.createAdmin(String(username).trim(), hash);
  res.json({ ok: true });
});

router.post('/login', async (req, res) => {
  const admin = db.getAdmin();
  if (!admin) return res.status(409).json({ error: 'admin_not_configured' });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username_and_password_required' });
  if (String(username).trim().toLowerCase() !== admin.username.toLowerCase()) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const ok = await verifyPassword(password, admin.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  const token = generateToken();
  db.createSession(hashToken(token), SESSION_TTL_HOURS);
  res.json({ token, login: admin.username });
});

router.post('/logout', requireAdmin, (req, res) => {
  db.deleteSession(req.sessionTokenHash);
  res.json({ ok: true });
});

router.get('/me', requireAdmin, (req, res) => {
  const admin = db.getAdmin();
  res.json({ login: admin.username });
});

module.exports = router;
