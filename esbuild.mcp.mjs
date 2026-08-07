import { build } from "esbuild";

await build({
  entryPoints: ["mcp/server.ts"],
  outfile: "dist/mcp/server.mjs",
  bundle: true,
  packages: "external",
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
});
