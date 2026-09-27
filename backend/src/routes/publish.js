const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { dualWriteToGitHub } = require('../lib/github');

const router = express.Router();

/* Reads only the cleartext plainHash field off an encrypted envelope --
   never the ciphertext, never the PIN -- to reproduce the exact
   "did the NPA book itself actually change" detection js/publish.js used
   to do client-side against GitHub's own blob shas. A fresh random
   salt/iv on every encryption means the ciphertext (and blob sha) differs
   on every publish even when the plaintext is byte-identical; plainHash
   (SHA-256 of the pre-compression plaintext) is what's actually stable. */
function readPlainHash(contentString) {
  try {
    const envelope = JSON.parse(contentString);
    return envelope && envelope.enc === 1 ? (envelope.plainHash || null) : null;
  } catch (e) {
    return null;
  }
}

router.get('/history', requireAdmin, (req, res) => {
  res.json(db.listHistory());
});

router.get('/history/:file', requireAdmin, (req, res) => {
  const row = db.getHistoryByFile(req.params.file);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.type('application/json').send(row.content);
});

/* Body: { files: [{path, content, label}], meta: {asOnDate, rowCount, npaLabel, publishedBy} }
   Mirrors js/publish.js's publishDataOnce() contract closely on purpose --
   the response field names (commitSha, historyFile, versionId, npaChanged,
   commitMessage) match exactly what confirmPublish() in js/app.js already
   expects, so that function needs no changes for this cutover. */
router.post('/publish', requireAdmin, async (req, res) => {
  const { files, meta } = req.body || {};
  if (!Array.isArray(files) || !files.length) {
    return res.status(400).json({ error: 'files_array_required' });
  }
  for (const f of files) {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') {
      return res.status(400).json({ error: 'each_file_needs_path_and_content_strings' });
    }
  }

  const m = meta || {};
  const latestFile = files.find(f => f.path === 'latest.json');
  let npaChanged = true;
  let historyFileName = null;

  if (latestFile) {
    const existing = db.getDataset('latest.json');
    const newHash = readPlainHash(latestFile.content);
    npaChanged = !(existing && existing.plain_hash && newHash && existing.plain_hash === newHash);
  }

  const safeDate = String(m.asOnDate || 'unknown').replace(/[^0-9-]/g, '');
  historyFileName = npaChanged ? `history/${safeDate}-${Date.now()}.json` : null;

  try {
    db.publishTxn(
      files.map(f => ({ path: f.path, content: f.content, plainHash: f.path === 'latest.json' ? readPlainHash(f.content) : null, updatedBy: m.publishedBy })),
      npaChanged && latestFile ? {
        file: historyFileName, content: latestFile.content, date: m.asOnDate || null,
        rowCount: m.rowCount || null, publishedBy: m.publishedBy || null, isRollback: !!m.isRollback,
      } : null
    );
  } catch (err) {
    return res.status(500).json({ error: 'db_write_failed', message: err.message });
  }

  const parts = [];
  if (npaChanged && latestFile) parts.push(m.npaLabel || `NPA data (${(m.rowCount || 0).toLocaleString('en-IN')} accounts)`);
  files.forEach(f => { if (f.label && f.path !== 'latest.json') parts.push(f.label); });
  const commitMessage = m.isRollback
    ? (m.commitMessage || 'Rollback NPA data')
    : (parts.length ? `Publish: ${parts.join(' + ')}` : (m.commitMessage || 'Publish data update'));

  let dualWriteWarning = null;
  try {
    await dualWriteToGitHub(files.map(f => ({ path: f.path, content: f.content })), commitMessage);
  } catch (err) {
    // Logged, not fatal -- SQLite (the real database of record now) already
    // has the data. GitHub is the read-only fallback tier, not the source
    // of truth, so a transient failure here must never block the Admin
    // from seeing their publish as successful.
    console.error('[dual-write] GitHub sync failed:', err.message);
    dualWriteWarning = 'Published to the database, but the GitHub backup copy could not be updated (' + err.message + '). Will retry automatically on the next publish.';
  }

  res.json({
    commitSha: 'nas-' + Date.now().toString(36),
    historyFile: historyFileName,
    versionId: historyFileName,
    npaChanged,
    commitMessage,
    dualWriteWarning,
  });
});

module.exports = router;
