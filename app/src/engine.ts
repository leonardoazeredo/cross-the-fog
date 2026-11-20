// The one script the page loads for the engine's TypeScript modules: every converted module is imported here
// and handed to the IIFE files that follow as a window global, from a single bundle, so no module is
// ever copied into two bundles (a class would be two classes). index.html puts the tag where the first
// converted file used to load; a converted module reads no page global, at load or when called, because the
// unconverted files below the tag have not loaded when this script runs: what it needs comes in as arguments.
import { createFogGain, DEFOG_HALF_M } from "./fogGain.ts";
import { hex } from "./sha256.ts";

const page = globalThis as unknown as Record<string, unknown>;
page.Sha256 = { hex };
page.FogGain = { create: createFogGain, DEFOG_HALF_M };
