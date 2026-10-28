import { createServer } from "vite-plus";

/**
 * Run the dev server and point the Cloudflare quick tunnel at the port it
 * actually bound. Vite auto-selects the next free port when 5173 is occupied,
 * so the tunnel reads `resolvedUrls` after `listen()` instead of assuming the
 * configured default. Running the server in-process also lets SIGINT/SIGTERM
 * close it cleanly rather than orphaning a Vite child.
 */
const server = await createServer();
await server.listen();
// Programmatic servers do not print the banner themselves; learners and the
// terminal need to see the actual port when 5173 was occupied.
server.printUrls();
const url = server.resolvedUrls?.local[0];
if (!url) {
  await server.close();
  throw new Error("Dev server did not expose a local URL.");
}

let tunnel: Bun.Subprocess | null = null;
try {
  tunnel = Bun.spawn(
    ["cloudflared", "tunnel", "--url", url.replace(/\/+$/, "")],
    {
      stdio: ["inherit", "inherit", "inherit"],
    },
  );
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(
    `Cloudflare tunnel unavailable (${reason}); ` +
      `the dev server is still running at ${url}.`,
  );
}

let closing = false;
/** Close the listener before exiting so the chosen port is immediately reusable. */
async function shutdown(code: number): Promise<void> {
  if (closing) return;
  closing = true;
  tunnel?.kill();
  await server.close();
  process.exit(code);
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

const code = tunnel ? await tunnel.exited : await new Promise<number>(() => {});
await shutdown(code);
