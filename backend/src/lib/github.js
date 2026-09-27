/* Server-side GitHub dual-write: after SQLite is updated (the new
   database of record), this commits the same file contents straight into
   the NPA-DASHBOARD repo's data/ folder -- exactly what js/publish.js used
   to do client-side, ported to run here instead, since the browser no
   longer holds any GitHub-scoped credential after Admin auth moved to the
   NAS. Two independent reasons this dual-write is NOT optional: (1) the
   separate, out-of-scope RECOVERY-DASHBOARD portal reads these same
   data/*.json files only from npadashboard.alokmittal.net -- if this
   stopped updating them it would silently start serving stale data with
   no warning; (2) the app's own service worker only has a cached fallback
   for a browser that has already loaded successfully once, so a brand-new
   device needs GitHub Pages to still be a real, live "cold" fallback, not
   just a frozen historical copy.

   Deliberately does NOT maintain data/history/index.json on GitHub any
   more -- Version History now lives in this backend's own SQLite
   history_index table (see db.js), which is what the Admin's own UI reads
   from going forward. This lib's only job is keeping the plain data/*.json
   files (the ones a fresh page load / Recovery Dashboard actually fetches)
   in sync, nothing else.

   A dual-write failure is logged as a warning and returned to the caller,
   but never fails the publish response -- SQLite already has the data by
   the time this runs, so a transient GitHub/network hiccup here must not
   block the Admin from knowing their publish succeeded. */
const REPO_OWNER = process.env.GITHUB_REPO_OWNER || 'mittalok-creator';
const REPO_NAME = process.env.GITHUB_REPO_NAME || 'NPA-DASHBOARD';
const REPO_BRANCH = process.env.GITHUB_REPO_BRANCH || 'main';
const API_BASE = process.env.GITHUB_API_BASE || 'https://api.github.com';

function utf8ToBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

async function ghApi(path, options = {}) {
  const token = process.env.GITHUB_PAT;
  if (!token) throw new Error('GITHUB_PAT not configured -- dual-write skipped');
  const res = await fetch(API_BASE + path, {
    method: options.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch (e) {}
    const err = new Error(`GitHub API ${res.status} on ${path}${detail ? ': ' + detail : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/* files: [{path, content}] -- path here is the plain dataset name
   ("latest.json"), mapped to "data/<name>" in the repo, matching the
   existing GitHub Pages layout exactly (no change needed on the
   Recovery Dashboard / any consumer's fetch URLs). */
async function dualWriteToGitHub(files, commitMessage) {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await dualWriteOnce(files, commitMessage);
    } catch (err) {
      const isRefRace = err.status === 422;
      if (!isRefRace || attempt === MAX_ATTEMPTS) throw err;
    }
  }
}

async function dualWriteOnce(files, commitMessage) {
  const ref = await ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${REPO_BRANCH}`);
  const baseCommitSha = ref.object.sha;
  const baseCommit = await ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${baseCommitSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  const treeEntries = [];
  for (const f of files) {
    const blob = await ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`, {
      method: 'POST',
      body: { content: utf8ToBase64(f.content), encoding: 'base64' },
    });
    treeEntries.push({ path: `data/${f.path}`, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const tree = await ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`, {
    method: 'POST',
    body: { base_tree: baseTreeSha, tree: treeEntries },
  });

  const newCommit = await ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, {
    method: 'POST',
    body: { message: commitMessage, tree: tree.sha, parents: [baseCommitSha] },
  });

  await ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${REPO_BRANCH}`, {
    method: 'PATCH',
    body: { sha: newCommit.sha, force: false },
  });

  return { commitSha: newCommit.sha };
}

module.exports = { dualWriteToGitHub };
