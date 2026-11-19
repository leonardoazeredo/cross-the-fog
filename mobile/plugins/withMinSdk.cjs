const { withProjectBuildGradle } = require("expo/config-plugins");

// The link is TLS 1.3 only and the platform's own TLS 1.3 engine starts at API 29; the watch app's
// watch/app/build.gradle.kts says the same number.
const MIN_SDK = 29;
const MARKER = "// crossfog: minSdk for the local link";
const ANCHOR = 'apply plugin: "expo-root-project"';

// mobile/android is generated and git-ignored, so the value lives here and every prebuild applies it.
// expo-root-project fills minSdkVersion only when the build does not define it, so it is defined first;
// the marker keeps a prebuild over an existing android/ from adding it twice.
function applyMinSdk(contents) {
  if (contents.includes(MARKER)) return contents;
  if (!contents.includes(ANCHOR)) {
    throw new Error(
      `withMinSdk: the root build.gradle has no ${ANCHOR} line to set minSdkVersion before`,
    );
  }
  return contents.replace(ANCHOR, `${MARKER}\next { minSdkVersion = ${MIN_SDK} }\n${ANCHOR}`);
}

module.exports = function withMinSdk(config) {
  return withProjectBuildGradle(config, (c) => {
    c.modResults.contents = applyMinSdk(c.modResults.contents);
    return c;
  });
};
module.exports.applyMinSdk = applyMinSdk;
module.exports.MIN_SDK = MIN_SDK;
module.exports.MARKER = MARKER;
