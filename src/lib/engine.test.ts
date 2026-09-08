import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeModel,
  fixedTotalCents,
  formatCents,
  formatWeekRange,
  genesisMonday,
  mondayStart,
  outflowCadenceLabel,
  redeemBlockReason,
  sgtDateKey,
  sgtEpoch,
  userBudgetCentsAt,
  userGenesisMonday,
  weeksInMonth,
  type FixedOutflowRow,
  type HouseholdRows,
  type PotLedgerRow,
  type SettingsRow,
  type SpendRow,
  type UserBudgetRow,
} from "./engine";

/* ------------------------------------------------------------------ *
 * Fixtures — mirror the live Supabase seed
 * ------------------------------------------------------------------ */

const ISAAC = "11111111-1111-4111-8111-111111111111";
const RACHELL = "22222222-2222-4222-8222-222222222222";
const ORDER = [ISAAC, RACHELL];

/** ISO-8601 UTC string for an SGT wall-clock instant. */
function iso(
  y: number,
  m: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0,
  ms = 0,
): string {
  return new Date(sgtEpoch(y, m, d, h, mi, s, ms)).toISOString();
}

const SEED_EFFECTIVE_FROM = iso(2026, 8, 1);

const SEED_SETTINGS: SettingsRow = {
  id: "settings-seed",
  monthly_budget: "4000.00",
  rollover_pct: 50,
  currency: "SGD",
  effective_from: SEED_EFFECTIVE_FROM,
  created_at: SEED_EFFECTIVE_FROM,
};

/** Both users seeded at 350.00/week effective 2026-08-01T00:00+08. */
const SEED_USER_BUDGETS: UserBudgetRow[] = ORDER.map((userId, i) => ({
  id: `budget-seed-${i}`,
  user_id: userId,
  weekly_budget: "350.00",
  effective_from: SEED_EFFECTIVE_FROM,
  created_at: SEED_EFFECTIVE_FROM,
}));

const WEEKLY = 35000; // 350.00 in cents

function outflow(
  over: Partial<FixedOutflowRow> & { name: string; amount: string; billing_day: number },
): FixedOutflowRow {
  return {
    id: `outflow-${over.name}`,
    cadence: "monthly",
    billing_month: null,
    active: true,
    created_at: SEED_EFFECTIVE_FROM,
    deactivated_at: null,
    ...over,
  };
}

const SEED_OUTFLOWS: FixedOutflowRow[] = [
  outflow({ name: "Netflix", amount: "19.98", billing_day: 3 }),
  outflow({ name: "Transit", amount: "120.00", billing_day: 5 }),
  outflow({ name: "Phone", amount: "25.00", billing_day: 12 }),
  outflow({ name: "Insurance", amount: "180.00", billing_day: 15 }),
];

const SEED_FIXED_TOTAL = 34498;

let spendSeq = 0;
function spend(
  amount: string,
  whenIso: string,
  loggedBy: string = ISAAC,
  note = "test",
): SpendRow {
  spendSeq += 1;
  return {
    id: `spend-${spendSeq}`,
    amount,
    note,
    logged_by: loggedBy,
    created_at: whenIso,
  };
}

let ledgerSeq = 0;
function ledger(
  amount: string,
  whenIso: string,
  type: PotLedgerRow["type"] = "redeem",
): PotLedgerRow {
  ledgerSeq += 1;
  return {
    id: `ledger-${ledgerSeq}`,
    amount,
    type,
    note: "omakase",
    logged_by: null,
    created_at: whenIso,
  };
}

function rows(overrides: Partial<HouseholdRows> = {}): HouseholdRows {
  return {
    settings: [SEED_SETTINGS],
    userBudgets: SEED_USER_BUDGETS,
    fixedOutflows: SEED_OUTFLOWS,
    spends: [],
    potLedger: [],
    ...overrides,
  };
}

function model(overrides: Partial<HouseholdRows> = {}, now = NOW) {
  return computeModel(rows(overrides), now, ORDER);
}

/** Tue 2026-09-15 12:00 SGT — six closed weeks, one open (Sep 14–20). */
const NOW = sgtEpoch(2026, 9, 15, 12, 0);

/* ------------------------------------------------------------------ *
 * SGT date maths
 * ------------------------------------------------------------------ */

describe("SGT week bucketing", () => {
  it("keeps Sunday 23:59:59.999 SGT in the week that is closing", () => {
    const sundayLastMs = sgtEpoch(2026, 8, 9, 23, 59, 59, 999);
    assert.equal(sgtDateKey(mondayStart(sundayLastMs)), "2026-08-03");
  });

  it("moves Monday 00:00:00.000 SGT into the new week", () => {
    const mondayFirstMs = sgtEpoch(2026, 8, 10, 0, 0, 0, 0);
    assert.equal(sgtDateKey(mondayStart(mondayFirstMs)), "2026-08-10");
  });

  it("buckets by SGT, not by UTC (Sun 22:00 SGT is Sun 14:00 UTC)", () => {
    // 2026-08-09T16:30Z is Mon 2026-08-10 00:30 SGT → next week.
    assert.equal(
      sgtDateKey(mondayStart(Date.parse("2026-08-09T16:30:00.000Z"))),
      "2026-08-10",
    );
    // 2026-08-09T15:30Z is Sun 2026-08-09 23:30 SGT → still the closing week.
    assert.equal(
      sgtDateKey(mondayStart(Date.parse("2026-08-09T15:30:00.000Z"))),
      "2026-08-03",
    );
  });

  it("buckets spends on either side of the boundary into different weeks", () => {
    const m = model({
      spends: [
        spend("10.00", iso(2026, 8, 9, 23, 59, 59, 999)),
        spend("20.00", iso(2026, 8, 10, 0, 0, 0, 0)),
      ],
    });
    assert.equal(m.weeksByKey["2026-08-03"].spentCents, 1000);
    assert.equal(m.weeksByKey["2026-08-10"].spentCents, 2000);
  });

  it("counts Mondays per month: Aug 2026 → 5, Sep 2026 → 4", () => {
    assert.equal(weeksInMonth("2026-08"), 5);
    assert.equal(weeksInMonth("2026-09"), 4);
    assert.equal(weeksInMonth("2026-02"), 4); // Feb 2026 starts on a Sunday
    assert.equal(weeksInMonth("2026-06"), 5);
  });

  it("assigns a week to the month containing its Monday", () => {
    const m = model();
    // Mon 2026-08-31 → Sun 2026-09-06 belongs to August.
    assert.equal(m.weeksByKey["2026-08-31"].monthKey, "2026-08");
    assert.equal(m.monthsByKey["2026-08"].weeks.length, 5);
  });
});

/* ------------------------------------------------------------------ *
 * Genesis
 * ------------------------------------------------------------------ */

describe("genesis", () => {
  it("starts each user at the first Monday covered by settings AND their budget", () => {
    assert.equal(
      sgtDateKey(userGenesisMonday(rows().settings, SEED_USER_BUDGETS, ISAAC)!),
      "2026-08-03",
    );
    assert.equal(
      sgtDateKey(genesisMonday(rows().settings, SEED_USER_BUDGETS)!),
      "2026-08-03",
    );
  });

  it("delays a user whose budget row lands later than the settings row", () => {
    const late: UserBudgetRow = {
      id: "budget-late",
      user_id: RACHELL,
      weekly_budget: "200.00",
      effective_from: iso(2026, 8, 20),
      created_at: iso(2026, 8, 20),
    };
    const m = model({ userBudgets: [SEED_USER_BUDGETS[0], late] });

    assert.equal(m.usersById[ISAAC].genesisWeekKey, "2026-08-03");
    assert.equal(m.usersById[RACHELL].genesisWeekKey, "2026-08-24");
    // Weeks before Rachell's genesis carry only Isaac's slice.
    assert.equal(m.weeksByKey["2026-08-03"].userWeeks.length, 1);
    assert.equal(m.weeksByKey["2026-08-24"].userWeeks.length, 2);
  });

  it("has no weeks at all when a user has no budget row", () => {
    const m = computeModel(
      { ...rows(), userBudgets: [] },
      NOW,
      ORDER,
    );
    assert.equal(m.weeks.length, 0);
    assert.equal(m.genesisWeekKey, null);
  });
});

/* ------------------------------------------------------------------ *
 * Personal weekly budgets
 * ------------------------------------------------------------------ */

describe("personal weekly budgets", () => {
  it("gives each user their own plain weekly envelope", () => {
    const m = model();
    const w = m.weeksByKey["2026-08-03"];
    assert.equal(w.userWeeksById[ISAAC].budgetCents, WEEKLY);
    assert.equal(w.userWeeksById[RACHELL].budgetCents, WEEKLY);
    assert.equal(w.envelopeCents, WEEKLY * 2);
  });

  it("does not derive the envelope from monthly_budget or fixed outflows", () => {
    const m = model({ fixedOutflows: [] });
    assert.equal(m.weeksByKey["2026-08-03"].userWeeksById[ISAAC].budgetCents, WEEKLY);
    // September has 4 Mondays vs August's 5 — the envelope is unaffected.
    assert.equal(m.weeksByKey["2026-09-07"].userWeeksById[ISAAC].budgetCents, WEEKLY);
  });

  it("resolves budgets by effective_from at the week's Monday", () => {
    const bump: UserBudgetRow = {
      id: "budget-bump",
      user_id: ISAAC,
      weekly_budget: "500.00",
      effective_from: iso(2026, 8, 19, 9, 30), // mid-week of Aug 17
      created_at: iso(2026, 8, 19, 9, 30),
    };
    const m = model({ userBudgets: [...SEED_USER_BUDGETS, bump] });

    // Weeks whose Monday precedes the change keep the old budget.
    assert.equal(m.weeksByKey["2026-08-17"].userWeeksById[ISAAC].budgetCents, WEEKLY);
    // Weeks starting after it get the new one.
    assert.equal(m.weeksByKey["2026-08-24"].userWeeksById[ISAAC].budgetCents, 50000);
    // Rachell is untouched by Isaac's change.
    assert.equal(m.weeksByKey["2026-08-24"].userWeeksById[RACHELL].budgetCents, WEEKLY);

    assert.equal(userBudgetCentsAt([...SEED_USER_BUDGETS, bump], ISAAC, NOW), 50000);
    assert.equal(userBudgetCentsAt([...SEED_USER_BUDGETS, bump], RACHELL, NOW), WEEKLY);
  });

  it("attributes spends to the person who logged them", () => {
    const m = model({
      spends: [
        spend("100.00", iso(2026, 8, 5, 12, 0), ISAAC),
        spend("40.00", iso(2026, 8, 6, 12, 0), RACHELL),
      ],
    });
    const w = m.weeksByKey["2026-08-03"];
    assert.equal(w.userWeeksById[ISAAC].spentCents, 10000);
    assert.equal(w.userWeeksById[RACHELL].spentCents, 4000);
    assert.equal(w.spentCents, 14000); // household combined
  });
});

/* ------------------------------------------------------------------ *
 * Per-person carry independence
 * ------------------------------------------------------------------ */

describe("per-person carry chaining", () => {
  it("keeps Isaac's overspend off Rachell's envelope", () => {
    const m = model({
      spends: [
        spend("400.00", iso(2026, 8, 5, 12, 0), ISAAC), // over by 50.00
        spend("100.00", iso(2026, 8, 5, 12, 0), RACHELL), // comfortably under
      ],
    });

    const w1 = m.weeksByKey["2026-08-03"];
    assert.equal(w1.userWeeksById[ISAAC].resultCents, -5000);
    assert.equal(w1.userWeeksById[RACHELL].resultCents, 25000);

    const w2 = m.weeksByKey["2026-08-10"];
    assert.equal(w2.userWeeksById[ISAAC].carryInCents, -5000);
    assert.equal(w2.userWeeksById[ISAAC].effectiveEnvelopeCents, WEEKLY - 5000);
    assert.equal(w2.userWeeksById[RACHELL].carryInCents, 0, "surplus never carries");
    assert.equal(w2.userWeeksById[RACHELL].effectiveEnvelopeCents, WEEKLY);
  });

  it("chains one person's debt across several weeks and a month boundary", () => {
    const m = model({
      spends: [
        spend("400.00", iso(2026, 8, 5, 12, 0), ISAAC), // −50.00
        spend("340.00", iso(2026, 8, 12, 12, 0), ISAAC), // env 300 → −40.00
        spend("400.00", iso(2026, 9, 1, 12, 0), ISAAC), // Aug-31 week → −50.00
      ],
    });

    assert.equal(m.weeksByKey["2026-08-10"].userWeeksById[ISAAC].effectiveEnvelopeCents, 30000);
    assert.equal(m.weeksByKey["2026-08-10"].userWeeksById[ISAAC].resultCents, -4000);
    assert.equal(m.weeksByKey["2026-08-17"].userWeeksById[ISAAC].carryInCents, -4000);
    // Week of Mon Aug 31 overspends; the Sep 7 week (a September week) absorbs it.
    assert.equal(m.weeksByKey["2026-08-31"].userWeeksById[ISAAC].resultCents, -5000);
    assert.equal(m.weeksByKey["2026-09-07"].userWeeksById[ISAAC].carryInCents, -5000);
    assert.equal(m.weeksByKey["2026-09-07"].userWeeksById[ISAAC].effectiveEnvelopeCents, 30000);
  });
});

/* ------------------------------------------------------------------ *
 * Per-person freeze / streak, shared pot
 * ------------------------------------------------------------------ */

describe("per-person freeze, streak and the shared pot", () => {
  it("earns each person 50% of their own surplus", () => {
    const m = model({
      spends: [
        spend("150.00", iso(2026, 8, 5, 12, 0), ISAAC), // +200.00
        spend("250.00", iso(2026, 8, 5, 12, 0), RACHELL), // +100.00
      ],
    });
    const w = m.weeksByKey["2026-08-03"];
    assert.equal(w.userWeeksById[ISAAC].earnCents, 10000);
    assert.equal(w.userWeeksById[RACHELL].earnCents, 5000);
    assert.equal(w.earnCents, 15000);
  });

  it("freezes only the overspender, and the pot still grows from the other", () => {
    const m = model({
      spends: [
        // Isaac: over in W1, under in W2 (thaw), under in W3 (earns again).
        spend("400.00", iso(2026, 8, 5, 12, 0), ISAAC),
        spend("100.00", iso(2026, 8, 12, 12, 0), ISAAC),
        spend("150.00", iso(2026, 8, 19, 12, 0), ISAAC),
        // Rachell: steady 250 every week — never frozen.
        spend("250.00", iso(2026, 8, 5, 12, 0), RACHELL),
        spend("250.00", iso(2026, 8, 12, 12, 0), RACHELL),
        spend("250.00", iso(2026, 8, 19, 12, 0), RACHELL),
      ],
    });

    const i1 = m.weeksByKey["2026-08-03"].userWeeksById[ISAAC];
    const i2 = m.weeksByKey["2026-08-10"].userWeeksById[ISAAC];
    const i3 = m.weeksByKey["2026-08-17"].userWeeksById[ISAAC];

    assert.ok(i1.resultCents < 0);
    assert.equal(i1.earnCents, 0, "over-budget week banks nothing");
    // W2 absorbs W1's overspend as carry-in but still closes under budget.
    assert.equal(i2.carryInCents, i1.resultCents);
    assert.ok(i2.resultCents > 0);
    assert.equal(i2.earnCents, 0, "thaw week earns nothing");
    assert.ok(i3.earnCents > 0, "earning resumes after the thaw");

    // Rachell earned in all three weeks regardless of Isaac's freeze.
    for (const key of ["2026-08-03", "2026-08-10", "2026-08-17"]) {
      assert.equal(m.weeksByKey[key].userWeeksById[RACHELL].earnCents, 5000);
    }

    assert.equal(m.usersById[ISAAC].frozen, false, "thawed by W2");
    assert.equal(m.usersById[RACHELL].frozen, false);
    assert.equal(
      m.earnedTotalCents,
      m.usersById[ISAAC].earnedTotalCents + m.usersById[RACHELL].earnedTotalCents,
    );
    assert.equal(m.potBalanceCents, m.earnedTotalCents);
  });

  it("reports the household as frozen while only one person is frozen", () => {
    const m = model({
      // Week of Sep 7 is the last closed week; Rachell blows it.
      spends: [spend("900.00", iso(2026, 9, 9, 12, 0), RACHELL)],
    });
    assert.equal(m.usersById[RACHELL].frozen, true);
    assert.equal(m.usersById[ISAAC].frozen, false);
    assert.equal(m.frozen, true);
    assert.deepEqual(m.frozenUserIds, [RACHELL]);
  });

  it("tracks each person's own streak", () => {
    const m = model({
      spends: [
        spend("400.00", iso(2026, 8, 19, 12, 0), ISAAC), // W3 over → streak 0
      ],
    });
    // Six closed weeks (Aug 3 … Sep 7). Isaac: 2 clean, 1 over, 3 clean → 3.
    assert.equal(m.usersById[ISAAC].streak, 3);
    assert.equal(m.usersById[ISAAC].longestStreak, 3);
    // Rachell never overspends → 6.
    assert.equal(m.usersById[RACHELL].streak, 6);
    assert.equal(m.usersById[RACHELL].longestStreak, 6);
  });

  it("banks nothing for the open week", () => {
    const m = model({ spends: [spend("50.00", iso(2026, 9, 15, 9, 0), ISAAC)] });
    const open = m.currentWeek!;
    assert.equal(open.key, "2026-09-14");
    assert.equal(open.status, "open");
    assert.equal(open.earnCents, 0);
    assert.ok(open.userWeeksById[ISAAC].resultCents > 0); // still live
  });

  it("uses the week's own rollover_pct when earning", () => {
    const bumped: SettingsRow = {
      id: "settings-rollover",
      monthly_budget: "4000.00",
      rollover_pct: 100,
      currency: "SGD",
      effective_from: iso(2026, 8, 24),
      created_at: iso(2026, 8, 24),
    };
    const m = model({
      settings: [SEED_SETTINGS, bumped],
      spends: [
        spend("150.00", iso(2026, 8, 5, 12, 0), ISAAC),
        spend("150.00", iso(2026, 8, 26, 12, 0), ISAAC),
      ],
    });
    assert.equal(m.weeksByKey["2026-08-03"].userWeeksById[ISAAC].earnCents, 10000); // 50%
    assert.equal(m.weeksByKey["2026-08-24"].userWeeksById[ISAAC].earnCents, 20000); // 100%
  });
});

/* ------------------------------------------------------------------ *
 * Pot ledger and redemption
 * ------------------------------------------------------------------ */

describe("pot ledger", () => {
  it("subtracts negative redeem rows from the derived earnings", () => {
    const base = model();
    const withRedeem = model({ potLedger: [ledger("-50.00", iso(2026, 9, 1, 20, 0))] });
    assert.equal(withRedeem.ledgerTotalCents, -5000);
    assert.equal(withRedeem.potBalanceCents, base.earnedTotalCents - 5000);
  });

  it("supports signed adjust rows in either direction", () => {
    const m = model({
      potLedger: [
        ledger("-50.00", iso(2026, 9, 1, 20, 0), "redeem"),
        ledger("12.34", iso(2026, 9, 2, 20, 0), "adjust"),
      ],
    });
    assert.equal(m.ledgerTotalCents, -5000 + 1234);
  });

  it("blocks redemption while EITHER person is frozen", () => {
    const isaacFrozen = model({
      spends: [spend("900.00", iso(2026, 9, 9, 12, 0), ISAAC)],
    });
    assert.equal(isaacFrozen.frozen, true);
    assert.match(
      redeemBlockReason(isaacFrozen, 1000, () => "Isaac") ?? "",
      /Isaac went over budget/,
    );

    const rachellFrozen = model({
      spends: [spend("900.00", iso(2026, 9, 9, 12, 0), RACHELL)],
    });
    assert.notEqual(redeemBlockReason(rachellFrozen, 1000), null);

    const clean = model();
    assert.equal(clean.frozen, false);
    assert.equal(redeemBlockReason(clean, 1000), null);
  });

  it("blocks empty and oversized redemptions", () => {
    assert.match(
      redeemBlockReason({ frozenUserIds: [], potBalanceCents: 5000 }, 6000) ?? "",
      /more than the pot holds/i,
    );
    assert.equal(
      redeemBlockReason({ frozenUserIds: [], potBalanceCents: 5000 }, 0),
      "Enter an amount to redeem.",
    );
    assert.equal(
      redeemBlockReason({ frozenUserIds: [], potBalanceCents: 5000 }, 5000),
      null,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Fixed outflows: windowing and cadence
 * ------------------------------------------------------------------ */

describe("fixed outflow windowing", () => {
  it("totals the seeded monthly outflows at 344.98 every month", () => {
    assert.equal(fixedTotalCents(SEED_OUTFLOWS, "2026-08"), SEED_FIXED_TOTAL);
    assert.equal(fixedTotalCents(SEED_OUTFLOWS, "2026-09"), SEED_FIXED_TOTAL);
  });

  it("excludes outflows created after the month ends", () => {
    const late = outflow({
      name: "Gym",
      amount: "60.00",
      billing_day: 20,
      created_at: iso(2026, 9, 5),
    });
    assert.equal(fixedTotalCents([...SEED_OUTFLOWS, late], "2026-08"), SEED_FIXED_TOTAL);
    assert.equal(
      fixedTotalCents([...SEED_OUTFLOWS, late], "2026-09"),
      SEED_FIXED_TOTAL + 6000,
    );
  });

  it("keeps a soft-deleted outflow in the months before it was deactivated", () => {
    const dropped: FixedOutflowRow = {
      ...SEED_OUTFLOWS[0],
      id: "dropped",
      active: false,
      deactivated_at: iso(2026, 9, 10),
    };
    const list = [dropped, ...SEED_OUTFLOWS.slice(1)];
    assert.equal(fixedTotalCents(list, "2026-08"), SEED_FIXED_TOTAL);
    assert.equal(fixedTotalCents(list, "2026-09"), SEED_FIXED_TOTAL);
    assert.equal(fixedTotalCents(list, "2026-10"), SEED_FIXED_TOTAL - 1998);
  });
});

describe("yearly outflow cadence", () => {
  const insurance = outflow({
    name: "Car insurance",
    amount: "1200.00",
    billing_day: 9,
    cadence: "yearly",
    billing_month: 3,
  });

  it("counts a yearly outflow in full, only in its billing month", () => {
    // All seed rows are created 2026-08-01, so the comparison months are 2027's.
    const list = [...SEED_OUTFLOWS, insurance];
    assert.equal(fixedTotalCents(list, "2027-02"), SEED_FIXED_TOTAL);
    assert.equal(fixedTotalCents(list, "2027-03"), SEED_FIXED_TOTAL + 120000);
    assert.equal(fixedTotalCents(list, "2027-04"), SEED_FIXED_TOTAL);
    // Same again the following year — it is not a one-off.
    assert.equal(fixedTotalCents(list, "2028-03"), SEED_FIXED_TOTAL + 120000);
    // Before any row was created, nothing counts at all.
    assert.equal(fixedTotalCents(list, "2026-03"), 0);
  });

  it("still respects the created/deactivated window in the billing month", () => {
    const late = { ...insurance, id: "late", created_at: iso(2026, 4, 1) };
    assert.equal(fixedTotalCents([late], "2026-03"), 0);
    assert.equal(fixedTotalCents([late], "2027-03"), 120000);
  });

  it("labels cadence for the month view", () => {
    assert.equal(
      outflowCadenceLabel({ cadence: "yearly", billingMonth: 3, billingDay: 9 }),
      "yearly · bills in Mar",
    );
    assert.equal(
      outflowCadenceLabel({ cadence: "monthly", billingMonth: null, billingDay: 3 }),
      "monthly · bills on the 3rd",
    );
  });

  it("surfaces the yearly bill in the month model only in March", () => {
    const marchNow = sgtEpoch(2027, 3, 10, 12, 0);
    const m = model({ fixedOutflows: [...SEED_OUTFLOWS, insurance] }, marchNow);
    const feb = m.monthsByKey["2027-02"];
    const mar = m.monthsByKey["2027-03"];
    assert.equal(feb.fixedOutflows.some((o) => o.name === "Car insurance"), false);
    assert.equal(mar.fixedOutflows.some((o) => o.name === "Car insurance"), true);
    assert.equal(mar.fixedTotalCents, SEED_FIXED_TOTAL + 120000);
  });
});

/* ------------------------------------------------------------------ *
 * Monthly tracking
 * ------------------------------------------------------------------ */

describe("monthly tracking", () => {
  it("measures spends + fixed outflows against the tracking target", () => {
    const m = model({
      spends: [
        spend("100.00", iso(2026, 8, 5, 12, 0), ISAAC),
        spend("250.00", iso(2026, 8, 20, 12, 0), RACHELL),
      ],
    });
    const aug = m.monthsByKey["2026-08"];
    assert.equal(aug.monthlyBudgetCents, 400000);
    assert.equal(aug.fixedTotalCents, SEED_FIXED_TOTAL);
    assert.equal(aug.spentCents, 35000);
    assert.equal(aug.spentByUser[ISAAC], 10000);
    assert.equal(aug.spentByUser[RACHELL], 25000);
    assert.equal(aug.trackedTotalCents, 35000 + SEED_FIXED_TOTAL);
    assert.equal(aug.remainingCents, 400000 - 35000 - SEED_FIXED_TOTAL);
  });

  it("goes negative when the tracking target is blown", () => {
    const m = model({ spends: [spend("4000.00", iso(2026, 8, 20, 12, 0), ISAAC)] });
    const aug = m.monthsByKey["2026-08"];
    assert.equal(aug.remainingCents, 400000 - 400000 - SEED_FIXED_TOTAL);
    assert.ok(aug.remainingCents < 0);
  });

  it("buckets tracking spends by CALENDAR month while weeks stay Monday-based", () => {
    // Mon 2026-08-31 is an August WEEK, but Tue 2026-09-01 is a September MONTH.
    const m = model({
      spends: [
        spend("60.00", iso(2026, 8, 31, 12, 0), ISAAC), // Aug week, Aug month
        spend("40.00", iso(2026, 9, 2, 12, 0), ISAAC), // Aug week, Sep month
      ],
    });

    const augWeek = m.weeksByKey["2026-08-31"];
    assert.equal(augWeek.monthKey, "2026-08");
    assert.equal(augWeek.spentCents, 10000, "both spends sit in the Aug-31 week");

    assert.equal(m.monthsByKey["2026-08"].spentCents, 6000);
    assert.equal(m.monthsByKey["2026-09"].spentCents, 4000);
  });

  it("enumerates every calendar month from genesis to now", () => {
    const m = model();
    assert.deepEqual(m.months.map((x) => x.key), ["2026-08", "2026-09"]);
    assert.equal(m.currentMonthKey, "2026-09");
  });

  it("a settings row inserted mid-month changes THAT month's target immediately", () => {
    // NOW is Tue 2026-09-15 — this lands mid-September, the current month.
    const midMonthChange: SettingsRow = {
      id: "settings-midmonth",
      monthly_budget: "5000.00",
      rollover_pct: 50,
      currency: "SGD",
      effective_from: iso(2026, 9, 10),
      created_at: iso(2026, 9, 10),
    };
    const m = model({
      settings: [SEED_SETTINGS, midMonthChange],
      spends: [spend("100.00", iso(2026, 9, 5, 12, 0), ISAAC)],
    });
    const sep = m.monthsByKey["2026-09"];
    assert.equal(sep.monthlyBudgetCents, 500000, "Sep target picks up the mid-month row");
    assert.equal(sep.remainingCents, 500000 - sep.trackedTotalCents);
  });

  it("a past month's target is unaffected by a later settings change", () => {
    const midMonthChange: SettingsRow = {
      id: "settings-midmonth",
      monthly_budget: "5000.00",
      rollover_pct: 50,
      currency: "SGD",
      effective_from: iso(2026, 9, 10),
      created_at: iso(2026, 9, 10),
    };
    const m = model({ settings: [SEED_SETTINGS, midMonthChange] });
    const aug = m.monthsByKey["2026-08"];
    assert.equal(
      aug.monthlyBudgetCents,
      400000,
      "August already ended before the Sep-10 row's effective_from — it keeps the seed target",
    );
  });

  it("resolves a week's rollover_pct by its own Monday, not a mid-week settings change", () => {
    // effective Wed 2026-09-02 — inside the Mon 2026-08-31 week (§ 2), but
    // after that week's own Monday, and it changes September's tracking
    // target (§ 3: a spend's month, not its week's month, governs tracking).
    const midWeekChange: SettingsRow = {
      id: "settings-midweek",
      monthly_budget: "4500.00",
      rollover_pct: 80,
      currency: "SGD",
      effective_from: iso(2026, 9, 2),
      created_at: iso(2026, 9, 2),
    };
    const m = model({
      settings: [SEED_SETTINGS, midWeekChange],
      spends: [spend("150.00", iso(2026, 8, 31, 12, 0), ISAAC)],
    });

    const week = m.weeksByKey["2026-08-31"];
    assert.equal(week.rolloverPct, 50, "week's Monday precedes the change — old rollover_pct");
    assert.equal(
      week.userWeeksById[ISAAC].earnCents,
      10000, // (35000 - 15000) * 50%, not 80%
      "earn is banked at the old rollover_pct despite the mid-week change",
    );

    // Meanwhile September's tracking target (a different concern, § 13) DOES
    // pick up the same row, since it lands before September's end.
    assert.equal(m.monthsByKey["2026-09"].monthlyBudgetCents, 450000);
  });
});

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

describe("formatting", () => {
  it("formats SGD without currency-code clutter", () => {
    assert.equal(formatCents(123456), "$1,234.56");
    assert.equal(formatCents(0), "$0.00");
    assert.equal(formatCents(-500), "-$5.00");
    assert.equal(formatCents(35000), "$350.00");
  });

  it("formats week ranges compactly", () => {
    assert.equal(
      formatWeekRange(sgtEpoch(2026, 8, 3), sgtEpoch(2026, 8, 9, 23, 59, 59, 999)),
      "3–9 Aug",
    );
    assert.equal(
      formatWeekRange(sgtEpoch(2026, 8, 31), sgtEpoch(2026, 9, 6, 23, 59, 59, 999)),
      "31 Aug – 6 Sep",
    );
    assert.equal(
      formatWeekRange(sgtEpoch(2026, 12, 28), sgtEpoch(2027, 1, 3, 23, 59, 59, 999)),
      "28 Dec 2026 – 3 Jan 2027",
    );
  });
});

/* ------------------------------------------------------------------ *
 * Empty state
 * ------------------------------------------------------------------ */

describe("empty state", () => {
  it("returns a safe model with no rows at all", () => {
    const m = computeModel(
      {
        settings: [],
        userBudgets: [],
        fixedOutflows: [],
        spends: [],
        potLedger: [],
      },
      NOW,
      ORDER,
    );
    assert.equal(m.weeks.length, 0);
    assert.equal(m.currentWeek, null);
    assert.equal(m.currency, "SGD");
    assert.equal(m.potBalanceCents, 0);
    assert.equal(m.frozen, false);
    assert.equal(m.users.length, 2);
    assert.equal(m.usersById[ISAAC].streak, 0);
  });
});
