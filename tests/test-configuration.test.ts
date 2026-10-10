import { readdirSync } from "node:fs";
import { matchesGlob } from "node:path";
import { expect, it } from "vitest";
import config from "../vitest.config";

it("discovers every checked-in TS and TSX unit test with the default configuration", () => {
  const files = ["packages", "tests", "apps/web/tests"].flatMap((directory) =>
    readdirSync(directory, { recursive: true, encoding: "utf8" })
      .map((file) => `${directory}/${file.replaceAll("\\", "/")}`)
      .filter((file) => /\.test\.tsx?$/.test(file)),
  );
  expect(files.some((file) => file.endsWith(".test.tsx"))).toBe(true);
  const include = config.test?.include ?? [];
  expect(files.filter((file) => !include.some((pattern) => matchesGlob(file, pattern)))).toEqual([]);
  expect(include.some((pattern) => matchesGlob("tests/discord-delivery.test.mjs", pattern))).toBe(false);
  expect(include.some((pattern) => matchesGlob("tests/e2e/smoke.spec.ts", pattern))).toBe(false);
});
