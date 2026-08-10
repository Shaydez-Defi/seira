import { build } from "esbuild";
import { rmSync } from "node:fs";

await rmSync("packages/frontend/api/index.js", { force: true });
await build({
  entryPoints: ["scripts/api-entry.ts"],
  outfile: "packages/frontend/api/index.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: false,
  define: {
    "process.env.VERCEL": JSON.stringify("1"),
  },
});
console.log("bundled scripts/api-entry.ts -> packages/frontend/api/index.js");
