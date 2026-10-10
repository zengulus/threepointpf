import { defineConfig, devices } from "@playwright/test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const webRequire = createRequire(new URL("./apps/web/package.json", import.meta.url));
const viteCli = resolve(dirname(webRequire.resolve("vite")), "../../bin/vite.js");
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  // Bound the real WebGL dice workload on CI and portable development machines.
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:4178",
    ...devices["Desktop Chrome"],
    launchOptions: executablePath ? { executablePath } : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    // Resolve the frontend's own Vite, without requiring Corepack on PATH.
    command: `"${process.execPath}" "${viteCli}" preview --host 127.0.0.1 --port 4178 --strictPort`,
    cwd: "./apps/web",
    url: "http://127.0.0.1:4178",
    reuseExistingServer: false,
  },
});
