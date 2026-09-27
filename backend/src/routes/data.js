const express = require('express');
const db = require('../db');

/* Public, no auth -- same trust model as today's data/*.json files on
   GitHub Pages: the file itself is public, real security is entirely the
   client-side PIN-derived encryption (this backend never sees the PIN and
   stores/serves the envelope as an opaque string). */
const ALLOWED_NAMES = new Set([
  'latest.json', 'pnpa.json', 'pnpa-weekly.json', 'pnpa-monthly.json', 'kcc-overdue.json',
]);

const router = express.Router();

router.get('/:name', (req, res) => {
  const name = req.params.name;
  if (!ALLOWED_NAMES.has(name)) return res.status(404).json({ error: 'unknown_dataset' });
  const row = db.getDataset(name);
  if (!row) return res.status(404).json({ error: 'not_found' });
  // Live banking data must never be served stale while genuinely online --
  // this header stops Cloudflare's edge/any intermediate proxy from caching
  // a response independent of the client's own cache-busting query string,
  // same "never stale while online" principle the app's own service worker
  // already enforces for this same data one layer up.
  res.set('Cache-Control', 'no-store');
  // content is already a complete JSON string (the encrypted envelope) --
  // send it through untouched rather than re-stringifying a parsed copy.
  res.type('application/json').send(row.content);
});

module.exports = router;
