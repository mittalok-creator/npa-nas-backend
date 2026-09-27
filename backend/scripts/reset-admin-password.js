#!/usr/bin/env node
/* Recovery path for a forgotten Admin password -- there is no email-based
   self-service reset (would need this backend to send email, one more
   moving part not worth it for a single-user system). Run this from
   whoever holds access to the NAS/container, e.g.:

     docker compose exec npa-nas-backend node scripts/reset-admin-password.js <new-password>

   Requires direct access to the running container -- exactly the same
   trust boundary as "who can touch the NAS" already implies. */
const path = require('path');
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

const db = require('../src/db');
const { hashPassword } = require('../src/lib/crypto');

async function main() {
  const newPassword = process.argv[2];
  if (!newPassword || newPassword.length < 8) {
    console.error('Usage: node scripts/reset-admin-password.js <new-password (min 8 chars)>');
    process.exit(1);
  }
  const admin = db.getAdmin();
  if (!admin) {
    console.error('No admin account exists yet -- use POST /api/admin/setup instead (first-time setup only).');
    process.exit(1);
  }
  const hash = await hashPassword(newPassword);
  db.updateAdminPassword(hash);
  console.log(`Password reset for admin account "${admin.username}". All existing sessions remain valid until they expire naturally -- restart the container if you also want to force everyone to re-login.`);
}

main().catch(err => { console.error(err); process.exit(1); });
