import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FILES } from "virtual:static";
import { startServer } from "./app";
import { PUBLIC_DIR } from "./paths";

// Entry point of the hosted build. `bun run build` bundles this file, its dependencies and the built
// interface into one self-contained script, so the host only has to run it.
for (const [path, base64] of Object.entries(FILES)) {
  const target = join(PUBLIC_DIR, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(base64, "base64"));
}

startServer();
