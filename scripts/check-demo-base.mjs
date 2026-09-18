#!/usr/bin/env node
/**
 * Checks that the built demo actually works from the subpath GitHub Pages
 * serves it from (`/threepointpf/`).
 *
 * This is the one thing the unit suite cannot see. The demo is published under a
 * project path, so a single site-absolute `/assets/...` reference, or missing
 * `dice/` assets, produces a live URL that loads a blank page or rolls with
 * untextured dice while every test still passes. So the real artifact is served
 * from a real subpath here and its own references are requested back.
 *
 * Usage: node scripts/check-demo-base.mjs [dist-dir]
 */
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

/** The project path Pages publishes the demo under. */
const BASE_PATH = "/threepointpf";

const distDir = resolve(process.argv[2] ?? "apps/web/dist");

const contentTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".glb": "model/gltf-binary",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
};

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

/**
 * A static handler that mounts the build at {@link BASE_PATH}, the way Pages
 * does, and refuses anything outside it.
 */
function serve(dist) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== BASE_PATH && !url.pathname.startsWith(`${BASE_PATH}/`)) {
      response.writeHead(404).end("not part of the demo");
      return;
    }
    let relative = decodeURIComponent(url.pathname.slice(BASE_PATH.length));
    if (relative === "" || relative.endsWith("/")) relative += "index.html";
    const file = join(dist, normalize(relative).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(dist)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error("not a file");
      response.writeHead(200, {
        "content-type": contentTypes[extname(file)] ?? "application/octet-stream",
        "content-length": info.size,
      });
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
}

/** Every `src`/`href` the document asks for, in order. */
function referencedAssets(html) {
  const references = [];
  for (const match of html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
    references.push(match[1]);
  }
  return references;
}

/** The subpath's own root-relative paths, e.g. `dice/textures/marble.webp`. */
async function firstFiles(directory, limit) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  return files.slice(0, limit).map((name) => join(directory, name));
}

const server = serve(distDir);
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}${BASE_PATH}`;

try {
  const index = await fetch(`${origin}/`);
  if (index.status !== 200) throw new Error(`${origin}/ answered ${index.status}`);
  const html = await index.text();
  if (!html.includes('id="root"')) fail("the served document is not the app shell");

  const references = referencedAssets(html);
  if (references.length === 0) fail("the served document references no assets at all");

  for (const reference of references) {
    if (reference.startsWith("/") || /^[a-z]+:/i.test(reference)) {
      // A site-absolute or external reference escapes the project path, which is
      // exactly what breaks under /threepointpf/.
      fail(`the document references ${reference}, which is not relative to the app`);
      continue;
    }
    const url = new URL(reference, `${origin}/`);
    const response = await fetch(url);
    if (response.status !== 200) {
      fail(`${reference} answered ${response.status} from the project path`);
      continue;
    }
    if (reference.endsWith(".js")) {
      const type = response.headers.get("content-type") ?? "";
      // A module script only executes when it is not served as octet-stream.
      if (!type.includes("javascript")) fail(`${reference} was served as ${type}`);
    }
  }

  // The 3D dice load their textures and sounds by path rather than by bundle, so
  // they are the assets most likely to be lost by a base-path change.
  const diceDir = join(distDir, "dice");
  const textures = await firstFiles(join(diceDir, "textures"), 3);
  const sounds = await firstFiles(join(diceDir, "sounds", "surfaces"), 2);
  if (textures.length === 0 || sounds.length === 0) {
    fail("the build carries no dice textures or sounds for the renderer to load");
  }
  for (const file of [...textures, ...sounds]) {
    const relative = file.slice(distDir.length + 1).split(/[\\/]/).join("/");
    const response = await fetch(`${origin}/${relative}`);
    if (response.status !== 200) {
      fail(`${relative} answered ${response.status} from the project path`);
    }
  }

  if (process.exitCode !== 1) {
    console.log(
      `Demo base check passed: ${references.length} document assets and ${
        textures.length + sounds.length
      } dice assets resolve from ${BASE_PATH}/`,
    );
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  server.close();
}
