// The Electron fuses every packaged build flips (electron-builder.config.cjs, afterPack). Shared with
// the build scripts, so a hot update (src/main/hot-update.ts) names the shell it needs: same Electron,
// same main-process ABI, same fuses.
const FUSES = {
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  onlyLoadAppFromAsar: true,
};

/** The fuses as one stable string, e.g. "enableNodeCliInspectArguments=0,...". */
const fusesKey = () =>
  Object.keys(FUSES)
    .sort()
    .map((k) => `${k}=${FUSES[k] ? 1 : 0}`)
    .join(',');

module.exports = { FUSES, fusesKey };
