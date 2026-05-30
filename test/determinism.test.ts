import { describe, expect, it } from "vitest";

import { evaluate } from "@/lib/evaluator";
import { FIXTURE_POOL } from "@/lib/fixture-pool";
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
  // 2.2: the golden fixture is byte-identical to the v1 source. This assertion
  // is removed in Phase 3 when src/lib/fixture-pool.ts is deleted.
  it("GOLDEN_POOL is byte-identical to the v1 FIXTURE_POOL", () => {
    expect(GOLDEN_POOL).toStrictEqual(FIXTURE_POOL);
  });

  describe.each(CASES)("$name", ({ give, want }) => {
    // Read-flip equivalence: the DB-shaped pool produces the exact same contract
    // as the hardcoded array — the core of the v1→v2 determinism guarantee.
    it("DB-shaped pool yields a byte-identical contract to FIXTURE_POOL", async () => {
      const fromFixture = await run(give, want, FIXTURE_POOL);
      const fromGolden = await run(give, want, GOLDEN_POOL);
      expect(fromGolden.contract).toBe(fromFixture.contract);
      expect(fromGolden.verdict).toBe(fromFixture.verdict);
      expect(fromGolden.counterparty_id).toBe(fromFixture.counterparty_id);
      expect(fromGolden.delta_pln).toBe(fromFixture.delta_pln);
    });

    // 2.1: lock the exact contract bytes against a committed snapshot so future
    // code changes that alter output are caught.
    it("contract matches the golden snapshot", async () => {
      const { contract } = await run(give, want, GOLDEN_POOL);
      expect(contract).toMatchSnapshot();
    });
  });
});
