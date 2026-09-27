/* Password hashing + session-token helpers only -- NOT the AES-GCM/PBKDF2
   envelope crypto that encrypts/decrypts the actual NPA data (that stays
   entirely client-side, in the app's own js/publish.js/js/app.js, and is
   never touched here -- this backend only ever sees the already-encrypted
   envelope as an opaque string). */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/* The raw token is shown to the browser exactly once (at login) and sent
   back as a Bearer header on every subsequent request. Only its SHA-256
   hash is ever stored server-side -- same principle as a password hash:
   a leaked database dump alone can't be replayed as a valid session. */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { hashPassword, verifyPassword, generateToken, hashToken };
