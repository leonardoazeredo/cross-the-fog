// One handler per message type of a union, so a type with none is a compile error instead of a case nobody wrote.
export type Handlers<M extends { type: string }> = {
  [T in M["type"]]: (msg: Extract<M, { type: T }>) => void | Promise<void>;
};

// The handler for a message, or undefined for a type the map has no entry of its own for. An own-property check:
// a type named like a member of Object.prototype ("constructor", "toString") must not find a function there.
export function handlerFor<M extends { type: string }>(
  handlers: Handlers<M>,
  msg: M,
): (() => void | Promise<void>) | undefined {
  if (!Object.hasOwn(handlers, msg.type)) return undefined;
  const handler = handlers[msg.type as M["type"]] as (m: M) => void | Promise<void>;
  return () => handler(msg);
}
