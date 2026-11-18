const { withSettingsGradle } = require("expo/config-plugins");

const MARKER = "// crossfog: the shared link/ module";

// mobile/android is generated and git-ignored, so the include lives here and is applied by every
// prebuild; the marker keeps a prebuild over an existing android/ from adding it twice.
function applyLinkProject(contents) {
  return contents.includes(MARKER)
    ? contents
    : `${contents}\n${MARKER}\ninclude ':link'\nproject(':link').projectDir = new File(rootDir, '../../link')\n`;
}

module.exports = function withLinkProject(config) {
  return withSettingsGradle(config, (c) => {
    c.modResults.contents = applyLinkProject(c.modResults.contents);
    return c;
  });
};
module.exports.applyLinkProject = applyLinkProject;
module.exports.MARKER = MARKER;
