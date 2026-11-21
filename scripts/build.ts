/**
 * Hosted build, in two steps:
 * 1. bundle the interface into public/;
 * 2. bundle the server (src/server/cloud.ts) with all its dependencies and the contents of public/ into
 *    build/server.js, so the deployment does not depend on how the host traces node_modules or static files.
 */
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";

function check(result: Awaited<ReturnType<typeof Bun.build>>) {
  if (result.success) return;
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await rm("public/index.html", { force: true });
await rm("public/assets", { recursive: true, force: true });
await rm("build", { recursive: true, force: true });

check(
  await Bun.build({
    entrypoints: ["src/web/index.html"],
    outdir: "public",
    naming: { chunk: "assets/[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]", entry: "[dir]/[name].[ext]" },
    plugins: [tailwind],
    minify: true,
  }),
);

const files: Record<string, string> = {};
for (const path of await readdir("public", { recursive: true })) {
  const file = Bun.file(join("public", path));
  if ((await file.stat()).isFile()) files[path] = Buffer.from(await file.arrayBuffer()).toString("base64");
}

check(
  await Bun.build({
    entrypoints: ["src/server/cloud.ts"],
    outdir: "build",
    naming: "server.js",
    target: "bun",
    plugins: [
      {
        name: "static-files",
        setup(build) {
          build.onResolve({ filter: /^virtual:static$/ }, () => ({ path: "static", namespace: "virtual" }));
          build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
            contents: `export const FILES = ${JSON.stringify(files)};`,
            loader: "js",
          }));
        },
      },
    ],
  }),
);

console.log(`interface: ${Object.keys(files).length} arquivos; servidor: ${(Bun.file("build/server.js").size / 1e6).toFixed(1)} MB`);
