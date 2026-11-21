/** Bundles the interface into public/ for hosts that serve static files (Vercel). */
import { rm } from "node:fs/promises";
import tailwind from "bun-plugin-tailwind";

await rm("public/index.html", { force: true });
await rm("public/assets", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["src/web/index.html"],
  outdir: "public",
  naming: { chunk: "assets/[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]", entry: "[dir]/[name].[ext]" },
  plugins: [tailwind],
  minify: true,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(result.outputs.map((output) => output.path).join("\n"));
