import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./sites-env.mjs";
import { readExecutionProfile } from "./execution-profile.mjs";
import { packageManagerCommand } from "./package-manager-command.mjs";

if (readExecutionProfile() === "managed-linux" && process.env.SITES_INSTALL_LOCK_HELD !== "1") {
  const result = spawnSync("bash", [path.join(projectRoot, "scripts/install-ci.sh")], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

// Keep installer writes within the checkout on restricted portable hosts too.
// These paths affect only this process and its children, not the user's config.
const runtimeRoot = process.env.SITES_RUNTIME_ROOT || path.join(projectRoot, ".sites-runtime");
process.env.COREPACK_HOME ||= path.join(runtimeRoot, "corepack");
process.env.XDG_CACHE_HOME = path.join(runtimeRoot, "cache");
process.env.XDG_DATA_HOME = path.join(runtimeRoot, "data");
process.env.XDG_CONFIG_HOME = path.join(runtimeRoot, "config");
for (const directory of [process.env.COREPACK_HOME, process.env.XDG_CACHE_HOME, process.env.XDG_DATA_HOME, process.env.XDG_CONFIG_HOME]) {
  mkdirSync(directory, { recursive: true });
}
const store = path.join(runtimeRoot, "pnpm", "store");

// This is a pnpm workspace: npm ci cannot install its workspace:* dependencies.
// Reuse the invoking pnpm when possible; npm/direct invocations use Corepack's
// packageManager pin. Never silently select a different package-manager version.
const { packageManager } = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const expectedVersion = /^pnpm@([^+]+)/.exec(packageManager)?.[1];
if (!expectedVersion) throw new Error("package.json must pin a pnpm version.");
const activePnpm = process.env.npm_config_user_agent?.startsWith("pnpm/") && process.env.npm_execpath;
let command = activePnpm
  ? packageManagerCommand(activePnpm)
  : [...packageManagerCommand("corepack"), "pnpm"];
let version = spawnSync(command[0], [...command.slice(1), "--version"], { cwd: projectRoot, encoding: "utf8" });
if (!activePnpm && version.error?.code === "ENOENT") {
  command = packageManagerCommand("pnpm");
  version = spawnSync(command[0], [...command.slice(1), "--version"], { cwd: projectRoot, encoding: "utf8" });
}
if (version.error) throw version.error;
if (version.status !== 0 || version.stdout.trim() !== expectedVersion) {
  process.stderr.write(version.stderr || "");
  throw new Error(`Dependency setup requires pnpm ${expectedVersion}; enable Corepack and run pnpm install:ci.`);
}

if (!["SHARP_IGNORE_GLOBAL_LIBVIPS", "SHARP_FORCE_GLOBAL_LIBVIPS", "npm_config_build_from_source", "NPM_CONFIG_BUILD_FROM_SOURCE"]
  .some((key) => key in process.env)) process.env.SHARP_IGNORE_GLOBAL_LIBVIPS = "1";

const installed = spawnSync(command[0], [...command.slice(1), "install", "--frozen-lockfile", "--prod=false", "--prefer-offline", "--store-dir", store], {
  cwd: projectRoot,
  env: { ...process.env, CI: "true" },
  stdio: "inherit",
});
if (installed.error) throw installed.error;
if (installed.signal) process.kill(process.pid, installed.signal);
if (installed.status !== 0 || installed.signal) process.exit(installed.status || 1);

try {
  accessSync(path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "vinext.cmd" : "vinext"),
    process.platform === "win32" ? constants.F_OK : constants.X_OK);
} catch {
  console.error("pnpm install succeeded but the local vinext executable is unavailable.");
  process.exitCode = 69;
}
