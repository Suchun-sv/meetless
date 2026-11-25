// Meetless's entry point (package.json "main"). A packaged build may run a hot update from the beta
// channel (src/main/hot-update.ts): the verified copy in <userData>/hot/<commit>/dist that pick.cjs
// chooses. Otherwise, and always in a dev run, the bundled main. A hot copy that does not report
// ready within BOOT_TIMEOUT_MS is marked bad and the app restarts into the bundled code.
const { app } = require('electron');
const path = require('node:path');
const { pickHot, markBad, markReady } = require('./pick.cjs');

const BOOT_TIMEOUT_MS = 45_000;

let hot = null;
if (app.isPackaged && process.env.MEETLESS_NO_HOT !== '1') {
  try {
    // As main.cjs does, so both see the same userData.
    if (process.env.MEETLESS_USER_DATA_DIR) app.setPath('userData', process.env.MEETLESS_USER_DATA_DIR);
    const hotDir = path.join(app.getPath('userData'), 'hot');
    const picked = pickHot(hotDir, __dirname);
    if (picked) {
      const timer = setTimeout(() => {
        markBad(hotDir, picked.commit);
        app.relaunch();
        app.exit(0);
      }, BOOT_TIMEOUT_MS);
      timer.unref?.();
      hot = picked;
      globalThis.__meetlessHot = {
        commit: picked.commit,
        ready() {
          clearTimeout(timer);
          markReady(hotDir, picked.commit);
        },
      };
    }
  } catch {
    hot = null;
  }
}
require(hot ? hot.main : './main/main.cjs');
