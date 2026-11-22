import { expect, it } from "vitest";
import { bundleAdapter } from "../../../scripts/web/bundleAdapter.js";

// The page's origin is https and the app needs Android 10 or later (minSdk 29), whose WebView has SubtleCrypto,
// so the page hashes with it alone and no second hashing library is bundled or left to resolve at runtime.
it("bundles the page adapter with no hashing library and hashes through SubtleCrypto", async () => {
  const text = await bundleAdapter({ devTools: false });
  expect(text).not.toContain("@noble");
  expect(text).toContain("crypto.subtle.digest");
});
