import { afterEach, describe, expect, it, vi } from "vitest";
import { warnClass } from "../../../src/flows/warn.js";

describe("warnClass", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  afterEach(() => warn.mockClear());

  it("logs the class of an Error and never its message", () => {
    warnClass("scope", "what", new TypeError("path /data/user/0"));
    expect(warn).toHaveBeenCalledWith("crossfog: scope what", "TypeError");
  });

  it("logs a subclass by its own name", () => {
    class Custom extends Error {
      override name = "CustomError";
    }
    warnClass("scope", "what", new Custom("x"));
    expect(warn).toHaveBeenCalledWith("crossfog: scope what", "CustomError");
  });

  it("logs unknown for a thrown value that is not an Error", () => {
    warnClass("scope", "what", "disk at /data is full");
    warnClass("scope", "what", { name: "Sneaky" });
    expect(warn.mock.calls.map((c) => c[1])).toEqual(["unknown", "unknown"]);
  });
});
