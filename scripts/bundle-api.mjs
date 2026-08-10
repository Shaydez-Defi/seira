import { build } from "esbuild";
import { rmSync } from "node:fs";

await rmSync("api/index.js", { force: true });
await build({
  entryPoints: ["scripts/api-entry.ts"],
  outfile: "api/index.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: false,
  define: {
    "process.env.VERCEL": JSON.stringify("1"),
  },
});
console.log("bundled api/index.ts -> api/index.js");
