// StreetIndex.rectQuery's exact text: bench/cache/ is keyed on it (bench/lib/fetch-cache.js), so a
// change, even one that leaves the answer the same, makes every saved answer miss.
//   node bench/rect-query.test.js
"use strict";
const assert = require("node:assert/strict");
const { StreetIndex } = require("./lib/load.js");

const ONE_BOX = "[out:json][timeout:25];(way[highway~\"^(residential|unclassified|tertiary|secondary|primary|living_street|track|path|footway|cycleway|pedestrian|steps|trunk|trunk_link|primary_link|secondary_link|tertiary_link)$\"][access!~\"^(private|no|military)$\"][motorroad!=yes][foot!=no](51.0000,13.7000,51.0250,13.7250);way[highway=service][access!~\"^(private|no|military)$\"][motorroad!=yes][foot!=no][service!~\"^(driveway|parking_aisle)$\"](51.0000,13.7000,51.0250,13.7250);)->.all;.all out skel geom;.all out count;";

const TWO_BOXES = "[out:json][timeout:25];(way[highway~\"^(residential|unclassified|tertiary|secondary|primary|living_street|track|path|footway|cycleway|pedestrian|steps|trunk|trunk_link|primary_link|secondary_link|tertiary_link)$\"][access!~\"^(private|no|military)$\"][motorroad!=yes][foot!=no](51.0000,13.7000,51.0100,13.7100);way[highway=service][access!~\"^(private|no|military)$\"][motorroad!=yes][foot!=no][service!~\"^(driveway|parking_aisle)$\"](51.0000,13.7000,51.0100,13.7100);way[highway~\"^(residential|unclassified|tertiary|secondary|primary|living_street|track|path|footway|cycleway|pedestrian|steps|trunk|trunk_link|primary_link|secondary_link|tertiary_link)$\"][access!~\"^(private|no|military)$\"][motorroad!=yes][foot!=no](51.2000,13.8000,51.2100,13.9000);way[highway=service][access!~\"^(private|no|military)$\"][motorroad!=yes][foot!=no][service!~\"^(driveway|parking_aisle)$\"](51.2000,13.8000,51.2100,13.9000);)->.all;.all out skel geom;.all out count;";

assert.equal(StreetIndex.rectQuery([{ s: 51, w: 13.7, n: 51.025, e: 13.725 }]), ONE_BOX);
assert.equal(StreetIndex.rectQuery([{ s: 51, w: 13.7, n: 51.01, e: 13.71 }, { s: 51.2, w: 13.8, n: 51.21, e: 13.9 }]), TWO_BOXES);
console.log("rect-query: ok");
