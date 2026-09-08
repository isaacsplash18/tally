"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { USERS } from "./constants";
import { supabase } from "./supabase";
import {
  centsToNumericString,
  computeModel,
  genesisMonday,
  startOfMonth,
  type FixedOutflowRow,
  type HouseholdModel,
  type HouseholdRows,
  type OutflowCadence,
  type PotLedgerRow,
  type SettingsRow,
  type SpendKind,
  type SpendRow,
  type UserBudgetRow,
} from "./engine";

const EMPTY_ROWS: HouseholdRows = {
  settings: [],
  userBudgets: [],
  fixedOutflows: [],
  spends: [],
  potLedger: [],
};

/** Household display order — Isaac, then Rachell. */
const USER_ORDER = USERS.map((u) => u.id);

/** Realtime bursts (a write fires INSERT + our own refetch) are coalesced. */
const REFETCH_DEBOUNCE_MS = 250;

/** Shape shared by the add / replace outflow helpers. */
export type OutflowInput = {
  name: string;
  amountCents: number;
  billingDay: number;
  cadence: OutflowCadence;
  /** 1..12 for yearly rows; ignored (forced to null) for monthly rows. */
  billingMonth: number | null;
};

export type HouseholdValue = {
  model: HouseholdModel;
  rows: HouseholdRows;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;

  addSpend: (input: {
    amountCents: number;
    note?: string | null;
    loggedBy: string;
    /** Spec § 16. Defaults to `personal`. */
    kind?: SpendKind;
  }) => Promise<void>;
  updateSpend: (
    id: string,
    patch: {
      amountCents?: number;
      note?: string | null;
      createdAt?: string;
      kind?: SpendKind;
    },
  ) => Promise<void>;
  deleteSpend: (id: string) => Promise<void>;

  insertSettings: (input: {
    monthlyBudgetCents: number;
    rolloverPct: number;
    currency?: string;
  }) => Promise<void>;

  /** Append-only: a personal weekly budget change is always a new row. */
  insertUserBudget: (userId: string, weeklyBudgetCents: number) => Promise<void>;

  addOutflow: (input: OutflowInput) => Promise<void>;
  deactivateOutflow: (id: string) => Promise<void>;
  replaceOutflow: (id: string, next: OutflowInput) => Promise<void>;

  redeemPot: (input: {
    amountCents: number;
    note?: string | null;
    loggedBy: string | null;
  }) => Promise<void>;
};

export const HouseholdContext = createContext<HouseholdValue | null>(null);

export function useHousehold(): HouseholdValue {
  const value = useContext(HouseholdContext);
  if (!value) {
    throw new Error("useHousehold must be used inside <HouseholdProvider>");
  }
  return value;
}

function messageOf(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Something went wrong.";
}

/** Normalise an outflow draft into the row shape, enforcing the cadence rule. */
function outflowPayload(input: OutflowInput) {
  const yearly = input.cadence === "yearly";
  return {
    name: input.name.trim(),
    amount: centsToNumericString(input.amountCents),
    billing_day: input.billingDay,
    cadence: input.cadence,
    billing_month: yearly ? input.billingMonth : null,
    active: true,
  };
}

/**
 * Fetches the five tables, folds them through the engine and exposes write
 * helpers. Refetch-everything is deliberate: at two users and a handful of
 * rows per week it is cheaper than reconciling deltas.
 */
export function useHouseholdState(): HouseholdValue {
  const [rows, setRows] = useState<HouseholdRows>(EMPTY_ROWS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Re-run the engine on a ticking clock so the open week closes on its own.
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Monotonic request id — concurrent refetches are fine, but only the newest
  // response is allowed to land.
  const requestId = useRef(0);

  const fetchAll = useCallback(async () => {
    const id = requestId.current + 1;
    requestId.current = id;
    try {
      // Genesis needs both settings and user_budgets, so those two go first.
      const [settingsRes, budgetsRes] = await Promise.all([
        supabase
          .from("settings")
          .select("*")
          .order("effective_from", { ascending: true }),
        supabase
          .from("user_budgets")
          .select("*")
          .order("effective_from", { ascending: true }),
      ]);
      if (settingsRes.error) throw settingsRes.error;
      if (budgetsRes.error) throw budgetsRes.error;
      const settings = (settingsRes.data ?? []) as SettingsRow[];
      const userBudgets = (budgetsRes.data ?? []) as UserBudgetRow[];

      // Spec § "Data access": spends only need to go back to the genesis
      // Monday — but month tracking buckets by calendar month, so pull from the
      // start of the genesis month to catch spends before the first Monday.
      const genesis = genesisMonday(settings, userBudgets);
      const spendsQuery = supabase
        .from("spends")
        .select("*")
        .order("created_at", { ascending: false });
      if (genesis !== null) {
        spendsQuery.gte("created_at", new Date(startOfMonth(genesis)).toISOString());
      }

      const [outflowsRes, spendsRes, ledgerRes] = await Promise.all([
        supabase
          .from("fixed_outflows")
          .select("*")
          .order("billing_day", { ascending: true }),
        spendsQuery,
        supabase
          .from("pot_ledger")
          .select("*")
          .order("created_at", { ascending: false }),
      ]);
      if (outflowsRes.error) throw outflowsRes.error;
      if (spendsRes.error) throw spendsRes.error;
      if (ledgerRes.error) throw ledgerRes.error;

      if (requestId.current !== id) return; // superseded by a newer refetch

      setRows({
        settings,
        userBudgets,
        fixedOutflows: (outflowsRes.data ?? []) as FixedOutflowRow[],
        spends: (spendsRes.data ?? []) as SpendRow[],
        potLedger: (ledgerRes.data ?? []) as PotLedgerRow[],
      });
      setNowMs(Date.now());
      setError(null);
    } catch (err) {
      if (requestId.current === id) setError(messageOf(err));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, []);

  /* Debounced refetch shared by the initial load, realtime and focus. */
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefetch = useCallback(
    (delayMs: number = REFETCH_DEBOUNCE_MS) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null;
        void fetchAll();
      }, delayMs);
    },
    [fetchAll],
  );

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  /* Initial load + Supabase realtime — both phones stay in sync without a tap. */
  useEffect(() => {
    scheduleRefetch(0);

    const channel = supabase.channel("tally-household");
    for (const table of [
      "settings",
      "user_budgets",
      "fixed_outflows",
      "spends",
      "pot_ledger",
    ]) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => scheduleRefetch(),
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [scheduleRefetch]);

  /* Focus / visibility — the belt to realtime's braces (and the PWA case where
     the socket was dropped while backgrounded). */
  useEffect(() => {
    const onFocus = () => scheduleRefetch(REFETCH_DEBOUNCE_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleRefetch();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [scheduleRefetch]);

  /* Keep "now" fresh so the countdown ticks and the week rolls at Sun 23:59. */
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const model = useMemo(
    () => computeModel(rows, nowMs, USER_ORDER),
    [rows, nowMs],
  );

  /* ---------------- writes ---------------- */

  const run = useCallback(
    // PostgREST builders are thenables, not real Promises — hence PromiseLike.
    async (op: () => PromiseLike<{ error: { message: string } | null }>) => {
      const { error: opError } = await op();
      if (opError) throw new Error(opError.message);
      await fetchAll();
    },
    [fetchAll],
  );

  const addSpend = useCallback<HouseholdValue["addSpend"]>(
    ({ amountCents, note, loggedBy, kind }) =>
      run(() =>
        supabase.from("spends").insert({
          amount: centsToNumericString(amountCents),
          note: note?.trim() ? note.trim() : null,
          logged_by: loggedBy,
          kind: kind ?? "personal",
        }),
      ),
    [run],
  );

  const updateSpend = useCallback<HouseholdValue["updateSpend"]>(
    (id, patch) => {
      const update: Record<string, unknown> = {};
      if (patch.amountCents !== undefined) {
        update.amount = centsToNumericString(patch.amountCents);
      }
      if (patch.note !== undefined) {
        update.note = patch.note?.trim() ? patch.note.trim() : null;
      }
      if (patch.createdAt !== undefined) update.created_at = patch.createdAt;
      if (patch.kind !== undefined) update.kind = patch.kind;
      return run(() => supabase.from("spends").update(update).eq("id", id));
    },
    [run],
  );

  const deleteSpend = useCallback<HouseholdValue["deleteSpend"]>(
    (id) => run(() => supabase.from("spends").delete().eq("id", id)),
    [run],
  );

  /* Spec write rule 1: settings is append-only and effective-dated. */
  const insertSettings = useCallback<HouseholdValue["insertSettings"]>(
    ({ monthlyBudgetCents, rolloverPct, currency }) =>
      run(() =>
        supabase.from("settings").insert({
          monthly_budget: centsToNumericString(monthlyBudgetCents),
          rollover_pct: rolloverPct,
          currency: currency ?? "SGD",
          effective_from: new Date().toISOString(),
        }),
      ),
    [run],
  );

  /* Spec write rule 2: user_budgets is append-only too — never UPDATE. */
  const insertUserBudget = useCallback<HouseholdValue["insertUserBudget"]>(
    (userId, weeklyBudgetCents) =>
      run(() =>
        supabase.from("user_budgets").insert({
          user_id: userId,
          weekly_budget: centsToNumericString(weeklyBudgetCents),
          effective_from: new Date().toISOString(),
        }),
      ),
    [run],
  );

  const addOutflow = useCallback<HouseholdValue["addOutflow"]>(
    (input) => run(() => supabase.from("fixed_outflows").insert(outflowPayload(input))),
    [run],
  );

  /* Spec write rule 3: removal is a soft-delete, never a DELETE. */
  const deactivateOutflow = useCallback<HouseholdValue["deactivateOutflow"]>(
    (id) =>
      run(() =>
        supabase
          .from("fixed_outflows")
          .update({ active: false, deactivated_at: new Date().toISOString() })
          .eq("id", id),
      ),
    [run],
  );

  /* Editing in place would rewrite history, so an edit is deactivate + insert. */
  const replaceOutflow = useCallback<HouseholdValue["replaceOutflow"]>(
    async (id, next) => {
      const deactivate = await supabase
        .from("fixed_outflows")
        .update({ active: false, deactivated_at: new Date().toISOString() })
        .eq("id", id);
      if (deactivate.error) throw new Error(deactivate.error.message);
      await run(() =>
        supabase.from("fixed_outflows").insert(outflowPayload(next)),
      );
    },
    [run],
  );

  /* Spec write rule 4: redemptions are inserted as a negative signed delta. */
  const redeemPot = useCallback<HouseholdValue["redeemPot"]>(
    ({ amountCents, note, loggedBy }) =>
      run(() =>
        supabase.from("pot_ledger").insert({
          amount: centsToNumericString(-Math.abs(amountCents)),
          type: "redeem",
          note: note?.trim() ? note.trim() : null,
          logged_by: loggedBy,
        }),
      ),
    [run],
  );

  return {
    model,
    rows,
    loading,
    error,
    refetch: fetchAll,
    addSpend,
    updateSpend,
    deleteSpend,
    insertSettings,
    insertUserBudget,
    addOutflow,
    deactivateOutflow,
    replaceOutflow,
    redeemPot,
  };
}
