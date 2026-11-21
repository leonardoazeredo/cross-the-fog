// The browser the page runs in, as far as the engine reads it: `window` is the Node global, with no Leaflet. A test
// that needs the engine requires this first and then app/src/engine.ts; one that draws on a map or builds a route
// editor also requires ./leaflet-stub.js, which defines global.L and global.fakeMap.
"use strict";
global.window = global;
