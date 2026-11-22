import { createStandIn } from "./standin/server.js";

// Usage: tsx scripts/standin.ts [port]   (the emulator reaches the host as 10.0.2.2)
const port = Number(process.argv[2] ?? 8787);
createStandIn().listen(port, "0.0.0.0", () => {
  console.log(
    `${new Date().toISOString().slice(11, 19)} standin: listening on port ${port}, logging no request`,
  );
});
