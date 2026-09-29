import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
if (mode !== "browser" && mode !== "hosted") {
  throw new Error("Usage: node scripts/build-web-mode.mjs <browser|hosted>");
}

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const web = join(root, "apps", "web");
const webRequire = createRequire(join(web, "package.json"));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: web, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await import("./copy-dice-assets.mjs");
run(process.execPath, [webRequire.resolve("typescript/bin/tsc"), "-p", join(web, "tsconfig.json")]);
const viteCli = resolve(dirname(webRequire.resolve("vite")), "../../bin/vite.js");
run(process.execPath, [viteCli, "build", "--configLoader", "native", ...(mode === "browser" ? ["--base=./"] : [])], {
  env: { ...process.env, VITE_APP_MODE: mode },
});
