// Shared setup for component (jsdom) tests. Registers jest-dom matchers
// (toBeInTheDocument, toHaveValue, …) and unmounts React trees after each test
// so renders don't leak across cases. Loaded globally via vitest.config.ts
// test.setupFiles — it only adds matchers + cleanup, never a DOM environment,
// so node-environment specs are unaffected.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
