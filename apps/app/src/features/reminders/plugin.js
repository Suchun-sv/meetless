// Local notifications only (A1 reminders). Free Personal Team signing has no push, so the
// aps-environment entitlement and the remote-notification background mode that
// expo-notifications adds are removed again. Mods run in reverse registration order, so these
// two are registered before expo-notifications' own plugin and therefore run after it.
const { withEntitlementsPlist, withInfoPlist, withPlugins } = require('expo/config-plugins');

module.exports = function withLocalNotificationsOnly(config) {
  config = withEntitlementsPlist(config, (c) => {
    delete c.modResults['aps-environment'];
    return c;
  });
  config = withInfoPlist(config, (c) => {
    const modes = c.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      const rest = modes.filter((m) => m !== 'remote-notification');
      if (rest.length) c.modResults.UIBackgroundModes = rest;
      else delete c.modResults.UIBackgroundModes;
    }
    return c;
  });
  return withPlugins(config, ['expo-notifications']);
};
