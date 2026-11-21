// One handler per message type of a union, so a type with none is a compile error instead of a case nobody wrote.
export type Handlers<M extends { type: string }> = {
  [T in M["type"]]: (msg: Extract<M, { type: T }>) => void | Promise<void>;
};

// The handler for a message, or undefined for a type the map has no entry of its own for. An own-property check:
// a type named like a member of Object.prototype ("constructor", "toString") must not find a function there. The
// map is typed where it is declared (`satisfies Handlers<...>`); the message here may be of a wider union, as in
// the session, where the types the map lacks go to the page API.
export function handlerFor(
  handlers: object,
  msg: { type: string },
): (() => void | Promise<void>) | undefined {
  if (!Object.hasOwn(handlers, msg.type)) return undefined;
  const handler = (handlers as Record<string, (m: unknown) => void | Promise<void>>)[msg.type];
  return handler && (() => handler(msg));
}
