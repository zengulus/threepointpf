import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Windows npm/Corepack launchers are batch files. Resolve their Node target
// instead of using a shell: checkout and install paths may contain spaces, &,
// or other shell metacharacters, which must remain ordinary path characters.
export function packageManagerCommand(command, {
  platform = process.platform,
  execPath = process.execPath,
  env = process.env,
  exists = existsSync,
  readFile = readFileSync,
} = {}) {
  if (/\.[cm]?js$/i.test(command)) return [execPath, command];
  if (platform !== "win32") return [command];

  const winPath = path.win32;
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
  const extensions = Object.entries(env).find(([key]) => key.toLowerCase() === "pathext")?.[1] ?? ".COM;.EXE;.BAT;.CMD";
  const directories = /[\\/]/.test(command) ? [""] : pathValue.split(";").map((value) => value.replace(/^"|"$/g, ""));
  const names = winPath.extname(command) ? [command] : extensions.split(";").filter(Boolean).map((extension) => command + extension.toLowerCase());
  const executable = directories.flatMap((directory) => names.map((name) => winPath.join(directory, name))).find((candidate) => exists(candidate));
  if (!executable) return [command]; // Preserve ENOENT so the caller can try pnpm.
  if (!/\.(?:cmd|bat)$/i.test(executable)) return [executable];

  // Both Corepack's %~dp0 and npm cmd-shim's %dp0% refer to the shim's folder.
  // Only accept a literal quoted JS path. Never interpret arbitrary batch code
  // or expand environment variables from it.
  const source = readFile(executable, "utf8");
  const targets = [...source.matchAll(/"%(?:~dp0|dp0%)([^"\r\n%]*\.[cm]?js)"/gi)]
    .map((match) => winPath.resolve(winPath.dirname(executable), match[1].replace(/^[\\/]+/, "")));
  const uniqueTargets = [...new Set(targets)];
  if (uniqueTargets.length !== 1 || !exists(uniqueTargets[0])) {
    throw new Error(`Cannot safely resolve the Node entrypoint in ${executable}. Run pnpm install:ci with the pinned pnpm version.`);
  }
  return [execPath, uniqueTargets[0]];
}
