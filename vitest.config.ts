import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@threepointpf/rules-schema": new URL("./packages/rules-schema/src/index.ts", import.meta.url).pathname,
      "@threepointpf/dice": new URL("./packages/dice/src/index.ts", import.meta.url).pathname,
      "@threepointpf/rules-core": new URL("./packages/rules-core/src/index.ts", import.meta.url).pathname,
      "@threepointpf/shared": new URL("./packages/shared/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
});
