import { expect, it } from "vitest";
import { packageManagerCommand } from "../scripts/package-manager-command.mjs";

const execPath = String.raw`C:\Program Files\nodejs\node.exe`;
function windows(files: Record<string, string>, env: Record<string, string> = {}) {
  return {
    platform: "win32" as const, execPath, env: { NODE_ENV: "test" as const, ...env },
    exists: (file: unknown) => Object.hasOwn(files, String(file)),
    readFile: ((file: unknown) => files[String(file)]) as typeof import("node:fs").readFileSync,
  };
}

it("resolves a Corepack shim from Windows PATH without shell evaluation", () => {
  const directory = String.raw`C:\Tools & utilities\node`;
  const shim = `${directory}\\corepack.cmd`;
  const target = `${directory}\\node_modules\\corepack\\dist\\corepack.js`;
  expect(packageManagerCommand("corepack", windows({
    [shim]: String.raw`node "%~dp0\node_modules\corepack\dist\corepack.js" %*`,
    [target]: "",
  }, { Path: `"${directory}"`, PATHEXT: ".EXE;.CMD" }))).toEqual([execPath, target]);
});

it("resolves npm's pnpm cmd-shim and preserves percent signs in the installation path", () => {
  const directory = String.raw`C:\Users\name%percent & spaces\AppData\Roaming\npm`;
  const shim = `${directory}\\pnpm.cmd`;
  const target = `${directory}\\node_modules\\pnpm\\bin\\pnpm.cjs`;
  expect(packageManagerCommand(shim, windows({
    [shim]: String.raw`"%_prog%" "%dp0%\node_modules\pnpm\bin\pnpm.cjs" %*`,
    [target]: "",
  }))).toEqual([execPath, target]);
});

it("resolves Corepack's pnpm shim with a relative parent path", () => {
  const shim = String.raw`C:\corepack\shims\pnpm.cmd`;
  const target = String.raw`C:\corepack\dist\pnpm.js`;
  const invocation = String.raw`node "%~dp0\..\dist\pnpm.js" %*`;
  expect(packageManagerCommand(shim, windows({ [shim]: `${invocation}\n${invocation}`, [target]: "" }))).toEqual([execPath, target]);
});

it.each(["js", "cjs", "mjs"])("keeps an invoking pnpm .%s entrypoint as a Node argument", (extension) => {
  const script = `C:\\Tools & utilities\\pnpm.${extension}`;
  expect(packageManagerCommand(script, windows({}))).toEqual([execPath, script]);
});

it("preserves native Windows pnpm executables and Linux launchers", () => {
  const native = String.raw`C:\Tools\pnpm.exe`;
  expect(packageManagerCommand(native, windows({ [native]: "" }))).toEqual([native]);
  expect(packageManagerCommand("pnpm", windows({ [native]: "" }, { PATH: String.raw`C:\Tools` }))).toEqual([native]);
  expect(packageManagerCommand("pnpm", { platform: "linux" })).toEqual(["pnpm"]);
});

it("leaves an absent Corepack command for the installer's ENOENT fallback", () => {
  expect(packageManagerCommand("corepack", windows({}))).toEqual(["corepack"]);
});

it.each([
  String.raw`call "%OTHER_PROGRAM%" %*`,
  String.raw`node "%~dp0\missing.cjs" %*`,
  String.raw`node "%~dp0\one.cjs" %*` + "\n" + String.raw`node "%~dp0\two.cjs" %*`,
])("rejects unsupported or ambiguous batch launchers rather than executing a shell", (source) => {
  const shim = String.raw`C:\Tools\pnpm.cmd`;
  expect(() => packageManagerCommand(shim, windows({
    [shim]: source,
    [String.raw`C:\Tools\one.cjs`]: "",
    [String.raw`C:\Tools\two.cjs`]: "",
  }))).toThrow("Cannot safely resolve the Node entrypoint");
});
