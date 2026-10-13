// @vitest-environment jsdom
import { createRequire } from "node:module";
import { resolve } from "node:path";
import React, { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(cleanup);

it("renders interactive UI with the frontend's React runtime and matching renderer", () => {
  const webRequire = createRequire(resolve("apps/web/package.json"));
  expect(React.version).toBe(webRequire("react/package.json").version);
  function Counter() {
    const [count, setCount] = useState(0);
    return React.createElement("button", { onClick: () => setCount(count + 1) }, `Count ${count}`);
  }
  render(React.createElement(Counter));
  fireEvent.click(screen.getByRole("button", { name: "Count 0" }));
  expect(screen.getByRole("button", { name: "Count 1" })).toBeDefined();
});
