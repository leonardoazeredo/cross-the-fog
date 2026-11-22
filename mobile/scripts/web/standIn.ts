// The origin of the e2e stand-in server (scripts/standin.ts), which the e2e build may reach in place of the street and
// elevation hosts. It exists only in a build made with CROSSFOG_E2E=1 as well: a release bundle never names it,
// in its content security policy or anywhere else.

const ORIGIN = /^http:\/\/(10\.0\.2\.2|127\.0\.0\.1|localhost):\d{2,5}$/;

export function standInOrigin(env: Record<string, string | undefined>): string | undefined {
  const origin = env.CROSSFOG_E2E_STANDIN;
  if (!origin) return undefined;
  if (env.CROSSFOG_E2E !== "1") {
    throw new Error("CROSSFOG_E2E_STANDIN is for the e2e build: set CROSSFOG_E2E=1 as well");
  }
  if (!ORIGIN.test(origin)) {
    throw new Error(
      "CROSSFOG_E2E_STANDIN must be http://10.0.2.2:<port> (or 127.0.0.1, localhost)",
    );
  }
  return origin;
}
