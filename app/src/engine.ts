// The one script the page loads for the engine's TypeScript modules: every converted module is imported here
// and handed to the IIFE files that follow as a window global, from a single bundle, so no module is
// ever copied into two bundles (a class would be two classes). index.html puts the tag where the first
// converted file used to load; a converted module reads an unconverted global only when it is called, never when
// this script runs, because the unconverted files below the tag have not loaded yet.
import { createFogGain, DEFOG_HALF_M } from "./fogGain.ts";
import { hex } from "./sha256.ts";

const page = globalThis as unknown as Record<string, unknown>;
page.Sha256 = { hex };
page.FogGain = { create: createFogGain, DEFOG_HALF_M };
