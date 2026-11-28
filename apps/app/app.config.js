// Extends app.json. The reminders feature (A1) ships a config plugin that strips aps-environment
// (free Personal Team signing has no push); it is applied once the file exists.
// MEETLESS_SERVER_URL (at build or export time): the server the native and desktop sign-in form starts
// with (`extra.serverUrl`); unset, the form starts empty. Never committed: it names a private host.
const fs = require('fs');
const path = require('path');

const REMINDERS_PLUGIN = './src/features/reminders/plugin.js';

module.exports = ({ config }) => {
  const plugins = [...(config.plugins ?? [])];
  if (fs.existsSync(path.join(__dirname, REMINDERS_PLUGIN))) plugins.push(REMINDERS_PLUGIN);
  const extra = { ...(config.extra ?? {}), ...(process.env.MEETLESS_SERVER_URL ? { serverUrl: process.env.MEETLESS_SERVER_URL } : {}) };
  return { ...config, plugins, extra };
};
