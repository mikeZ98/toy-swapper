import { describe, expect, it } from "vitest";

import { evaluate } from "@/lib/evaluator";
import type { Counterparty } from "@/types";

import { GOLDEN_POOL } from "./fixtures/counterparty-pool";

// v1 default (PRD OQ-3 / FAIRNESS_THRESHOLD_PCT). Fixed here so the suite is
// hermetic — no env, no API key (stub path), no DB.
const THRESHOLD_PCT = 20;

// Representative inputs, one per verdict branch, verified against the seeded
// pool via the deterministic stub path.
const CASES: { name: string; give: string; want: string }[] = [
  { name: "FAIR", give: "wózek spacerowy", want: "rowerek biegowy" },
  { name: "NEEDS BALANCING", give: "autko resorak", want: "klocki LEGO Duplo" },
  { name: "NO MATCH", give: "qwerty zxcvb", want: "asdfg hjkl" },
];

const run = (give: string, want: string, pool: Counterparty[]) =>
  evaluate(give, want, pool, { thresholdPct: THRESHOLD_PCT });

describe("counterparty pool migration — determinism", () => {
  describe.each(CASES)("$name", ({ give, want }) => {
    // Lock the exact contract bytes against a committed snapshot so future code
    // changes that alter output are caught. The seeded DB rows are tied to this
    // same GOLDEN_POOL by supabase/tests/counterparties.test.sql.
    it("contract matches the golden snapshot", async () => {
      const { contract } = await run(give, want, GOLDEN_POOL);
      expect(contract).toMatchSnapshot();
    });
  });
});
