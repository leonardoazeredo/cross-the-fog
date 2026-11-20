// The one script the page loads for the engine's TypeScript modules: every converted module is imported here
// and handed to the IIFE files that follow as a window global, from a single bundle, so no module is
// ever copied into two bundles (a class would be two classes). index.html puts the tag before the
// unconverted files that read these globals. A converted module reads no page global, at load or when
// called, because those files have not loaded when this script runs: what it needs comes in as arguments.
import { createFogGain, DEFOG_HALF_M } from "./fogGain.ts";
import { type PageWindow, pageGlobals } from "./pageGlobals.ts";
import { hex } from "./sha256.ts";

const page = globalThis as unknown as PageWindow;
// pako, IndexedDB, fetch and the NextGIS key are looked up on `page` when the functions that need them run, not when this line does.
Object.assign(page, pageGlobals(page));
page.Sha256 = { hex };
page.FogGain = { create: createFogGain, DEFOG_HALF_M };
