import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // UI tests exercise the React 18 frontend, not the React 19 hosting shell.
  // Resolve the renderer and JSX runtime to the same copy as its components.
  resolve: {
    alias: {
      react: fileURLToPath(new URL("./apps/web/node_modules/react", import.meta.url)),
      "react-dom": fileURLToPath(new URL("./apps/web/node_modules/react-dom", import.meta.url)),
      "@testing-library/react": fileURLToPath(new URL("./apps/web/node_modules/@testing-library/react", import.meta.url)),
      "@threepointpf/rules-schema": new URL("./packages/rules-schema/src/index.ts", import.meta.url).pathname,
      "@threepointpf/rules-data": new URL("./packages/rules-data/src/index.ts", import.meta.url).pathname,
      "@threepointpf/dice": new URL("./packages/dice/src/index.ts", import.meta.url).pathname,
      "@threepointpf/rules-core": new URL("./packages/rules-core/src/index.ts", import.meta.url).pathname,
      "@threepointpf/shared": new URL("./packages/shared/src/index.ts", import.meta.url).pathname,
    },
  },
  oxc: { jsx: { runtime: "automatic" } },
  // Unit tests don't need the hosting shell's Tailwind/PostCSS build pipeline.
  css: { postcss: { plugins: [] } },
  test: {
    include: ["packages/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}", "apps/web/tests/**/*.test.{ts,tsx}"],
    environment: "node",
    // DOM-heavy character sheets otherwise compete with every rules suite on
    // large-core/shared runners. Keep the default command predictable there.
    maxWorkers: 2,
    testTimeout: 20_000,
  },
});
