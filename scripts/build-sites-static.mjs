import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const webRoot = join(repoRoot, "apps", "web");
const webRequire = createRequire(join(webRoot, "package.json"));
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run("pnpm", ["--recursive", "--workspace-concurrency=1", "--if-present", "--filter", "!@threepointpf/web", "build"], { shell: process.platform === "win32" });
await import("./copy-dice-assets.mjs");
run(process.execPath, [webRequire.resolve("typescript/bin/tsc"), "-p", join(webRoot, "tsconfig.json")]);

const viteCli = resolve(dirname(webRequire.resolve("vite")), "../../bin/vite.js");
run(process.execPath, [viteCli, "build", "--configLoader", "native", "--base=./", "--outDir", resolve(repoRoot, "dist"), "--emptyOutDir"], {
  cwd: webRoot,
  env: { ...process.env, VITE_APP_MODE: "browser" },
});
