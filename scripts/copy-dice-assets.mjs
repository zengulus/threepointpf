// The 3D dice renderer loads textures and impact sounds from a runtime path
// (`assetPath`, configured as `/dice/`), not from the bundle. Copy its `public/`
// directory into the web app's static directory so both `vite dev` and the built
// app can serve them.
//
// The copy is generated output: it is gitignored and refreshed on every build.
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(repoRoot, "apps", "web", "public", "dice");
const webRequire = createRequire(join(repoRoot, "apps", "web", "package.json"));

let source;
try {
  source = join(
    dirname(webRequire.resolve("@3d-dice/dice-box-threejs/package.json")),
    "public",
  );
} catch {
  console.error(
    "Cannot locate @3d-dice/dice-box-threejs; run `pnpm install` before building the web app.",
  );
  process.exit(1);
}

const exists = await stat(source).then(
  () => true,
  () => false,
);
if (!exists) {
  console.error(`Expected dice assets at ${source}`);
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.log(`Copied 3D dice assets to ${target}`);
