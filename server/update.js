// Pull the latest code from git, triggered from the phone.
//
// The mirror lives behind glass with no keyboard, so the alternative is SSHing
// in every time. This is the second place the server shells out (see
// display.js for the first) and it carries the same never-crash contract:
// every command is execFile with a timeout, and every failure comes back as a
// message rather than an exception.
//
// Deliberately not configurable from the request: no branch, no remote, no
// arguments of any kind reach git. The endpoint is unauthenticated like the
// rest of /settings, so the only thing it can ever do is fast-forward this
// checkout to whatever its own origin already points at.

const { execFile } = require('child_process');
const path = require('path');

const REPO = path.join(__dirname, '..');
const TIMEOUT_MS = 120000;

function git(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: REPO, timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim().slice(0, 300)));
      resolve(stdout.trim());
    });
  });
}

function npmInstall() {
  return new Promise((resolve) => {
    // Failure here is reported, not thrown: a pull that succeeded shouldn't be
    // reported as failed because npm had a bad day. The restart will surface it.
    execFile('npm', ['install', '--no-audit', '--no-fund'], { cwd: REPO, timeout: TIMEOUT_MS },
      (err, stdout, stderr) => resolve(err ? (stderr || err.message).trim().slice(0, 200) : null));
  });
}

async function run() {
  // A dirty tree means someone edited files on the mirror itself. Pulling over
  // that either fails confusingly or silently discards their work.
  const dirty = await git(['status', '--porcelain']);
  if (dirty) {
    return {
      ok: false,
      message: 'The mirror has uncommitted local changes. Pull skipped so nothing gets lost.',
    };
  }

  const before = await git(['rev-parse', 'HEAD']);
  // --ff-only: if the histories have diverged this refuses instead of opening
  // a merge that nobody is standing there to resolve.
  await git(['pull', '--ff-only']);
  const after = await git(['rev-parse', 'HEAD']);

  if (before === after) {
    return { ok: true, changed: false, message: 'Already up to date.' };
  }

  const changedFiles = (await git(['diff', '--name-only', before, after])).split('\n');
  const subject = await git(['log', '-1', '--pretty=%s']);

  // New dependencies would crash the server on restart if they aren't there.
  let npmError = null;
  if (changedFiles.includes('package-lock.json') || changedFiles.includes('package.json')) {
    npmError = await npmInstall();
  }

  return {
    ok: true,
    changed: true,
    from: before.slice(0, 7),
    to: after.slice(0, 7),
    files: changedFiles.length,
    subject,
    npmError,
    message: `Updated to ${after.slice(0, 7)} — ${subject}`,
  };
}

module.exports = { run };
