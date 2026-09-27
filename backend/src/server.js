const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const adminRoutes = require('./routes/admin');
const dataRoutes = require('./routes/data');
const publishRoutes = require('./routes/publish');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' })); // a full NPA book envelope can run a few MB

/* CORS: only the app's own real origin(s) may call this API from a
   browser. Reachable from the public internet (Cloudflare Tunnel sits in
   front of this), but only this app's frontend is allowed to actually use
   it cross-origin. */
const allowedOrigins = (process.env.ADMIN_CORS_ORIGIN || 'https://npadashboard.alokmittal.net')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS: origin not allowed'));
  },
}));

/* Reachable from the public internet by requirement -- rate-limit the one
   endpoint an attacker could actually brute-force (there's exactly one
   admin account, so this is the whole attack surface for credential
   guessing). */
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
app.use('/api/admin/login', loginLimiter);

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/admin', adminRoutes);
app.use('/api/data', dataRoutes);
app.use('/api', publishRoutes); // GET /api/history[/:file], POST /api/publish

app.use((err, req, res, next) => {
  if (err && /CORS/.test(err.message)) return res.status(403).json({ error: 'origin_not_allowed' });
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

const PORT = Number(process.env.PORT || 4100);
app.listen(PORT, () => {
  console.log(`npa-nas-backend listening on :${PORT}`);
});

module.exports = app;
