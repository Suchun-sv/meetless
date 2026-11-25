// Which code the packaged app runs (boot.cjs): the newest verified hot update in <userData>/hot,
// or the bundled dist/. Plain CommonJS with no Electron, so boot.cjs can require it before anything else.
const fs = require('node:fs');
const path = require('node:path');

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** The hot state file: `current` (commit to run), `booting` (started, not yet ready), `bad` (failed to start). */
function readState(hotDir) {
  const s = readJson(path.join(hotDir, 'state.json')) || {};
  return { current: typeof s.current === 'string' ? s.current : null, booting: typeof s.booting === 'string' ? s.booting : null, bad: Array.isArray(s.bad) ? s.bad.filter((x) => typeof x === 'string').slice(-20) : [] };
}

function writeState(hotDir, s) {
  fs.mkdirSync(hotDir, { recursive: true });
  const tmp = path.join(hotDir, 'state.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, path.join(hotDir, 'state.json'));
}

const sameShell = (a, b) => !!a && !!b && a.electron === b.electron && a.fuses === b.fuses && (a.abi == null || b.abi == null || String(a.abi) === String(b.abi));

/** Marks `commit` as one that failed to start: never run again, and not current any more. */
function markBad(hotDir, commit) {
  const s = readState(hotDir);
  if (!s.bad.includes(commit)) s.bad.push(commit);
  if (s.current === commit) s.current = null;
  if (s.booting === commit) s.booting = null;
  writeState(hotDir, s);
}

/**
 * The hot copy to run, or null for the bundled code. A copy runs only when it was verified when it
 * was unpacked (`.verified`), was built for this shell (`bundledDir/shell.json`), is newer than the
 * bundled code, and did not fail to start: a copy marked `booting` from the last start never said it
 * was ready, so it is marked bad here and the bundled code runs instead.
 */
function pickHot(hotDir, bundledDir) {
  const s = readState(hotDir);
  if (!s.current) return null;
  const commit = s.current;
  if (s.booting === commit || s.bad.includes(commit)) {
    markBad(hotDir, commit);
    return null;
  }
  const dist = path.join(hotDir, commit, 'dist');
  const main = path.join(dist, 'main', 'main.cjs');
  const build = readJson(path.join(dist, 'build.json'));
  const bundled = readJson(path.join(bundledDir, 'build.json'));
  const ok =
    fs.existsSync(path.join(hotDir, commit, '.verified')) &&
    fs.existsSync(main) &&
    sameShell(readJson(path.join(dist, 'shell.json')), readJson(path.join(bundledDir, 'shell.json'))) &&
    build && bundled && Date.parse(build.built) > Date.parse(bundled.built);
  if (!ok) {
    // A release installed over an older hot copy, or one for another shell: back to the bundled code.
    writeState(hotDir, { ...s, current: null, booting: null });
    return null;
  }
  writeState(hotDir, { ...s, booting: commit });
  return { commit, main };
}

/** The hot copy started: boot keeps using it. */
function markReady(hotDir, commit) {
  const s = readState(hotDir);
  if (s.booting === commit) writeState(hotDir, { ...s, booting: null });
}

module.exports = { pickHot, markBad, markReady, readState, writeState, sameShell };
