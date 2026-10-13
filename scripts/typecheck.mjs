import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const require = createRequire(join(root, "package.json"));
const tsc = require.resolve("typescript/bin/tsc");

function run(args) {
  const result = spawnSync(process.execPath, [tsc, ...args], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Workspace exports reference dist declarations, so refresh them before
// checking the complete Site, browser app, and test tree.
run(["-b", "--force", ...["rules-schema", "rules-data", "dice", "rules-core", "shared"].map((name) => join(root, "packages", name))]);
run(["--noEmit", "-p", join(root, "tsconfig.json")]);
