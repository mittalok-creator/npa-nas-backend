const { hashToken } = require('../lib/crypto');
const db = require('../db');

/* Gates every Admin-only route (publish/history). Reads the Bearer token,
   looks up its hash (never the raw token) against admin_sessions, and lets
   getValidSession() itself prune anything already expired. There is
   exactly one admin account in this whole system -- a valid, unexpired
   session token IS the authorization, no separate role/permission check
   needed. */
function requireAdmin(req, res, next) {
  const header = req.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(header);
  if (!m) return res.status(401).json({ error: 'missing_token' });
  const session = db.getValidSession(hashToken(m[1]));
  if (!session) return res.status(401).json({ error: 'invalid_or_expired_token' });
  req.sessionTokenHash = hashToken(m[1]);
  next();
}

module.exports = { requireAdmin };
