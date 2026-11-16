const { withAppBuildGradle } = require("expo/config-plugins");

// Gradle's React Native bundle task tracks only what lies under mobile/, but the page it ships is
// built from ../app and web-adapter into ../generated/web.ts by `pnpm generate`. Without this the
// task reports UP-TO-DATE after a page edit and the release build repackages the old page, and a raw
// gradlew or `expo run:android` never regenerates it at all. The Exec task below runs the generator
// with its sources declared, and the bundle tasks depend on it and on its output.
const MARKER = "// crossfog: the page sources are inputs of the bundle tasks";

const BLOCK = `
${MARKER}
def crossfogMobile = file("$rootDir/..")
def crossfogRepo = file("$rootDir/../..")
def crossfogPage = file("$crossfogRepo/generated/web.ts")
// build-web.ts reads CROSSFOG_E2E to put the dev tools in the page
def crossfogE2e = providers.environmentVariable("CROSSFOG_E2E").orElse("")

tasks.register("generateCrossfogPage", Exec) {
    workingDir crossfogMobile
    commandLine "pnpm", "generate"
    inputs.dir("$crossfogRepo/app")
    ["web-adapter", "src", "scripts", "licenses"].each { inputs.dir("$crossfogMobile/$it") }
    inputs.file("$crossfogMobile/package.json")
    inputs.file("$crossfogMobile/pnpm-lock.yaml")
    inputs.file("$crossfogRepo/LICENSE")
    inputs.property("crossfogE2e", crossfogE2e)
    outputs.file(crossfogPage)
    outputs.file("$crossfogRepo/generated/licenses.json")
}

tasks.matching { it.name ==~ /createBundle.*JsAndAssets/ }.configureEach {
    dependsOn("generateCrossfogPage")
    inputs.file(crossfogPage)
    inputs.property("crossfogE2e", crossfogE2e)
}
`;

// prebuild runs on an existing android/ too, so the block goes in once
function applyReleaseBundleInputs(contents) {
  return contents.includes(MARKER) ? contents : contents + BLOCK;
}

module.exports = (config) =>
  withAppBuildGradle(config, (c) => {
    c.modResults.contents = applyReleaseBundleInputs(c.modResults.contents);
    return c;
  });
module.exports.applyReleaseBundleInputs = applyReleaseBundleInputs;
module.exports.MARKER = MARKER;
