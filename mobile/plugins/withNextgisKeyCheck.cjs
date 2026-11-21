const { withAppBuildGradle } = require("expo/config-plugins");

// A release build with no NEXTGIS_OVERPASS_KEY would ship an app that asks overpass-api.de alone (the 39-68 s
// queue), and nothing would say so. The release bundle task stops the build instead; a debug build never reaches it,
// and CROSSFOG_E2E=1 (the emulator's release-built test app) does not need the key. The message names the
// variable and never its value.
const MARKER = "// crossfog: a release build needs the NextGIS key";

const BLOCK = `
${MARKER}
def crossfogNextgisKey = providers.environmentVariable("NEXTGIS_OVERPASS_KEY").orElse("")
def crossfogE2eBuild = providers.environmentVariable("CROSSFOG_E2E").orElse("")

tasks.matching { it.name ==~ /createBundle.*ReleaseJsAndAssets/ }.configureEach {
    doFirst {
        if (crossfogE2eBuild.get() != "1" && crossfogNextgisKey.get().isEmpty()) {
            throw new GradleException("NEXTGIS_OVERPASS_KEY is not set: a release build must be made with it")
        }
    }
}
`;

// prebuild runs on an existing android/ too, so the block goes in once
function applyNextgisKeyCheck(contents) {
  return contents.includes(MARKER) ? contents : contents + BLOCK;
}

module.exports = (config) =>
  withAppBuildGradle(config, (c) => {
    c.modResults.contents = applyNextgisKeyCheck(c.modResults.contents);
    return c;
  });
module.exports.applyNextgisKeyCheck = applyNextgisKeyCheck;
module.exports.MARKER = MARKER;
