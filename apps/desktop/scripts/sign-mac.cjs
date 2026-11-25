// macOS code signing, called from electron-builder's afterPack (electron-builder.config.cjs), before
// the zip and dmg are made. Adapted from Gleeok's app/build-hooks/vmp-sign.cjs (its macOS part;
// Meetless uses stock Electron, so there is no castLabs VMP step).
//
// electron-builder does not sign (mac.identity is null: there is no Apple developer identity), so it
// happens here. With MAC_SIGN_IDENTITY (the self-signed "Meetless Self-Signed" certificate the
// release workflow imports into a temporary keychain, MAC_SIGN_KEYCHAIN) every version keeps the
// same code identity, so the keychain and privacy permissions keep trusting it across updates.
// Without one (a local build) it signs ad hoc ("-"), which is enough for Apple silicon to run it.
const { execFileSync } = require('node:child_process');

/** The codesign arguments for `app` under `env`. */
function signArgs(app, env = process.env) {
  const identity = env.MAC_SIGN_IDENTITY || '-';
  const keychain = env.MAC_SIGN_KEYCHAIN ? ['--keychain', env.MAC_SIGN_KEYCHAIN] : [];
  return ['--force', '--deep', '--sign', identity, ...keychain, app];
}

function signMac(app) {
  const args = signArgs(app);
  console.log(`  sign-mac: ${args[3] === '-' ? 'ad hoc' : args[3]} ${app}`);
  execFileSync('codesign', args, { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', app], { stdio: 'inherit' });
}

module.exports = signMac;
module.exports.signArgs = signArgs;
