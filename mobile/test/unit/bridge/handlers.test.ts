import { expect, it, vi } from "vitest";
import { handlerFor } from "../../../src/bridge/handlers.js";

const ready = vi.fn();
const handlers = { ready };

it("finds the handler of a type the map has, and calls it with the message", () => {
  const msg = { v: 1, type: "ready" };
  handlerFor(handlers, msg)?.();
  expect(ready).toHaveBeenCalledExactlyOnceWith(msg);
});

// A lookup that read inherited keys would find a function for these.
it.each(["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf", "nope"])(
  "finds no handler for the type %s",
  (type) => {
    expect(handlerFor(handlers, { type })).toBeUndefined();
  },
);

it("finds no handler for a type that is not a string, even one that reads as a key", () => {
  for (const type of [["ready"], { toString: () => "ready" }, 1, null, undefined]) {
    expect(handlerFor(handlers, { type } as unknown as { type: string })).toBeUndefined();
  }
});
