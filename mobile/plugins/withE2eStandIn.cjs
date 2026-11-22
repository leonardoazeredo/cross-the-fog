const { withAndroidManifest } = require("expo/config-plugins");

// The e2e build talks to the stand-in server (scripts/standin.ts) over plain http on the emulator's host address,
// which Android refuses unless the app allows cleartext traffic. Only a build made with CROSSFOG_E2E_STANDIN gets
// the attribute, and only beside CROSSFOG_E2E=1; every other build keeps Android's default, which refuses it.
function applyStandIn(androidManifest) {
  const app = androidManifest.manifest.application?.[0];
  if (!app) throw new Error("AndroidManifest.xml has no <application>");
  app.$ = { ...app.$, "android:usesCleartextTraffic": "true" };
  return androidManifest;
}

module.exports = (config) => {
  if (!process.env.CROSSFOG_E2E_STANDIN) return config;
  if (process.env.CROSSFOG_E2E !== "1") {
    throw new Error("CROSSFOG_E2E_STANDIN is for the e2e build: set CROSSFOG_E2E=1 as well");
  }
  return withAndroidManifest(config, (c) => {
    c.modResults = applyStandIn(c.modResults);
    return c;
  });
};
module.exports.applyStandIn = applyStandIn;
