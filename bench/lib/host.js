// The browser the page runs in, as far as the engine reads it: `window` is the Node global, and Leaflet is
// the stub next to this file. A test that needs the engine requires this first and then app/src/engine.ts.
"use strict";
global.window = global;
require("./leaflet-stub.js"); // defines global.L (which suggest.ts reads through the host) and global.fakeMap (which tests build maps with)
