import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const web = join(root, "apps", "web");
const rootRequire = createRequire(join(root, "package.json"));
const webRequire = createRequire(join(web, "package.json"));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Refresh declarations even when a recovered checkout has stale build-info files.
run(process.execPath, [rootRequire.resolve("typescript/bin/tsc"), "-b", "--force",
  ...["rules-schema", "rules-data", "dice", "rules-core", "shared"].map((name) => join(root, "packages", name)),
]);
run("pnpm", ["--recursive", "--workspace-concurrency=1", "--if-present", "--filter", "!@threepointpf/web", "build"], { shell: process.platform === "win32" });
await import("./copy-dice-assets.mjs");
run(process.execPath, [webRequire.resolve("typescript/bin/tsc"), "-p", join(web, "tsconfig.json")]);
const viteCli = resolve(dirname(webRequire.resolve("vite")), "../../bin/vite.js");
run(process.execPath, [viteCli, "build", "--configLoader", "native", "--base=/campaign/", "--outDir", join(root, "public", "campaign"), "--emptyOutDir"], {
  cwd: web,
  env: { ...process.env, VITE_APP_MODE: "hosted" },
});
run(process.execPath, [join(root, "scripts", "run-framework.mjs"), "build"]);
