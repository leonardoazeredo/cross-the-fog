// app/index.html as the browser reads it: comments removed, so a script tag that is commented out is not found
// by a test that looks for it.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const withoutComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
const readPage = () => withoutComments(fs.readFileSync(path.join(__dirname, "..", "..", "app", "index.html"), "utf8"));

module.exports = { readPage, withoutComments };
