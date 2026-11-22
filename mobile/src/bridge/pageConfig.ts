// The NextGIS Overpass key is from the build (app.config.ts extra), never from the page bundle:
// generated/web.ts is ignored and the key is to stay out of the repo. On Android this script,
// injected before content loads, can run after the page's own scripts, so overpass.ts reads the key
// for each request and the event tells main.js to offer NextGIS in the endpoint choice it has
// already drawn. Without a key, pageConfigScript returns undefined and WebShell injects nothing. The trailing
// `true;` is there because react-native-webview wants an injected script to end on a truthy value.
export function pageConfigScript(key: unknown): string | undefined {
  if (typeof key !== "string" || !key) return undefined;
  return `window.crossfogNextgisKey = ${JSON.stringify(key)};window.dispatchEvent(new Event("crossfog-nextgis-key"));true;`;
}

// The e2e build's stand-in: the page's requests to the street and elevation hosts go to the stand-in server instead,
// so the flows are repeatable and ask no live server. Injected only when the build named a stand-in (never in a release
// build, see scripts/web/standIn.ts); the page looks `fetch` up on the window for each request, so wrapping it here is
// enough.
export function standInScript(origin: unknown): string | undefined {
  if (typeof origin !== "string" || !origin) return undefined;
  const o = JSON.stringify(origin);
  return `(function(){var o=${o},f=window.fetch;window.fetch=function(i){var u=typeof i==="string"?i:i&&i.url,m;if(typeof u==="string"){m=/^https:\\/\\/(overpass-api\\.de|overpass\\.nextgis\\.com)(\\/.*)?$/.exec(u);if(m)return f.call(this,o+"/overpass"+(m[2]||""),arguments[1]);m=/^https:\\/\\/elevation-tiles-prod\\.s3\\.amazonaws\\.com\\/(.*)$/.exec(u);if(m)return f.call(this,o+"/elevation/"+m[1],arguments[1]);}return f.apply(this,arguments);};})();true;`;
}
