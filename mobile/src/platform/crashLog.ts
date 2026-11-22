import { File, Paths } from "expo-file-system";

// Only the error's class is written: a message can hold a position, an export id or a path, and no pattern
// catches every shape of those. A name that is no plain identifier is as free-form as a message.
const CLASS_NAME = /^[A-Za-z_$][\w$]{0,63}$/;

function errorClass(error: unknown): string {
  return error instanceof Error && CLASS_NAME.test(error.name) ? error.name : "unknown";
}

export async function logCrash(error: unknown): Promise<void> {
  try {
    const line = `${new Date().toISOString()}\t${errorClass(error)}\n`;
    await new File(Paths.document, "crash.log").write(line, { append: true });
  } catch {
    // swallow — throwing here would recurse back into the global error handler
  }
}
