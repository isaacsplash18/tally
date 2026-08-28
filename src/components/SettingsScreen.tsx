"use client";

import { useState } from "react";

import { ErrorBanner, ScreenSkeleton, Spinner } from "@/components/Feedback";
import Sheet from "@/components/Sheet";
import { amountToCents, centsToBuffer } from "@/lib/amountInput";
import { MAX_BILLING_DAY, USERS } from "@/lib/constants";
import {
  fixedTotalCents,
  formatCents,
  formatMonthLabel,
  monthName,
  outflowCadenceLabel,
  parseCents,
  sgtMonthKey,
  userBudgetCentsAt,
  type FixedOutflowRow,
  type OutflowCadence,
} from "@/lib/engine";
import { useSession } from "@/lib/session";
import { useHousehold } from "@/lib/useHousehold";

export default function SettingsScreen() {
  const { model, rows, loading, error, refetch } = useHousehold();
  const { userId, setUserId } = useSession();
  const other = USERS.find((user) => user.id !== userId) ?? USERS[0];

  if (loading && rows.settings.length === 0) return <ScreenSkeleton />;

  const monthKey = model.currentMonthKey ?? sgtMonthKey(model.nowMs);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="text-xl font-bold tracking-tight text-brand">Settings</h1>

      {error ? <ErrorBanner message={error} onRetry={() => void refetch()} /> : null}

      <WeeklyBudgetsCard />
      <TrackingCard monthKey={monthKey} />
      <OutflowsCard />

      <section className="rounded-3xl border border-border bg-surface px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Currency</p>
            <p className="text-xs text-muted">Single-currency household</p>
          </div>
          <span className="rounded-full bg-border/60 px-3 py-1 text-sm font-semibold text-muted">
            {model.currency}
          </span>
        </div>
      </section>

      <button
        type="button"
        onClick={() => setUserId(other.id)}
        className="rounded-2xl border border-border bg-surface py-3.5 text-base font-semibold text-brand transition active:bg-brand/5"
      >
        Switch to {other.name}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Personal weekly budgets — one editor per person, INSERT-only
 * ------------------------------------------------------------------ */

function WeeklyBudgetsCard() {
  return (
    <section className="rounded-3xl border border-border bg-surface px-5 py-5">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-[0.14em] text-muted">
        Weekly budgets
      </h2>
      <p className="mb-4 text-xs leading-snug text-muted">
        Each person spends from their own weekly envelope. Overspend carries
        into that person&apos;s next week; surplus goes to the shared pot.
      </p>

      <div className="flex flex-col gap-5">
        {USERS.map((user) => (
          <WeeklyBudgetEditor key={user.id} userId={user.id} name={user.name} />
        ))}
      </div>

      <p className="mt-4 text-xs leading-snug text-muted">
        Saving adds a new effective-dated row — past weeks keep the budget they
        were actually run with.
      </p>
    </section>
  );
}

function WeeklyBudgetEditor({ userId, name }: { userId: string; name: string }) {
  const { model, rows, insertUserBudget } = useHousehold();
  const current = model.usersById[userId]?.weeklyBudgetCents ?? 0;
  const [buffer, setBuffer] = useState(() => centsToBuffer(current));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const cents = amountToCents(buffer);
  // Live preview: the effective row today, and what this edit would become.
  const effectiveNow = userBudgetCentsAt(rows.userBudgets, userId, model.nowMs);
  const dirty = cents !== current;

  async function save() {
    if (cents <= 0) {
      setFailure("Weekly budget must be more than zero.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await insertUserBudget(userId, cents);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
        {name}
        <input
          type="text"
          inputMode="decimal"
          value={buffer}
          onChange={(e) => setBuffer(e.target.value.replace(/[^0-9.]/g, ""))}
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-lg font-semibold tabular-nums text-foreground outline-none focus:border-brand"
        />
      </label>

      <p className="mt-1.5 text-xs tabular-nums text-muted">
        Now {formatCents(effectiveNow)} / week
        {dirty ? (
          <span className="text-brand"> → {formatCents(cents)} from next week</span>
        ) : null}
      </p>

      {failure ? <div className="mt-2"><ErrorBanner message={failure} /></div> : null}

      <button
        type="button"
        onClick={() => void save()}
        disabled={busy || !dirty}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-3 text-sm font-semibold text-background transition active:scale-[0.99] disabled:opacity-35"
      >
        {busy ? <Spinner className="border-t-background" /> : null}
        {saved ? "Saved" : `Save ${name}'s budget`}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Household tracking target + rollover
 * ------------------------------------------------------------------ */

function TrackingCard({ monthKey }: { monthKey: string }) {
  const { model, rows, insertSettings } = useHousehold();
  const [budget, setBudget] = useState(() => centsToBuffer(model.monthlyBudgetCents));
  const [rollover, setRollover] = useState(() => String(model.rolloverPct));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const budgetCents = amountToCents(budget);
  const rolloverPct = Math.max(0, Math.min(100, Number(rollover) || 0));

  const fixed = fixedTotalCents(rows.fixedOutflows, monthKey);
  const spent = model.monthsByKey[monthKey]?.spentCents ?? 0;
  const remaining = budgetCents - fixed - spent;

  const dirty =
    budgetCents !== model.monthlyBudgetCents || rolloverPct !== model.rolloverPct;

  async function save() {
    if (budgetCents <= 0) {
      setFailure("Monthly tracking target must be more than zero.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await insertSettings({
        monthlyBudgetCents: budgetCents,
        rolloverPct,
        currency: model.currency,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-border bg-surface px-5 py-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-muted">
        Household
      </h2>

      <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
        Monthly budget (tracking target)
        <input
          type="text"
          inputMode="decimal"
          value={budget}
          onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))}
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-lg font-semibold tabular-nums text-foreground outline-none focus:border-brand"
        />
      </label>
      <p className="mt-1.5 text-xs leading-snug text-muted">
        Tracking only. It does not feed the weekly envelopes — the Month screen
        measures spends + fixed outflows against it.
      </p>

      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted">
        Rollover to pot (%)
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          value={rollover}
          onChange={(e) => setRollover(e.target.value)}
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-lg font-semibold tabular-nums text-foreground outline-none focus:border-brand"
        />
      </label>
      <p className="mt-1.5 text-xs leading-snug text-muted">
        Share of each person&apos;s weekly surplus banked into the shared pot.
      </p>

      <div className="mt-4 rounded-2xl bg-background px-4 py-3">
        <p className="text-xs text-muted">
          {formatMonthLabel(monthKey)} · {formatCents(budgetCents)} −{" "}
          {formatCents(fixed)} fixed − {formatCents(spent)} spent
        </p>
        <p
          className={`mt-1 text-2xl font-bold tabular-nums ${
            remaining < 0 ? "text-red" : "text-brand"
          }`}
        >
          {formatCents(remaining)}
          <span className="ml-1 text-sm font-medium text-muted">
            {remaining < 0 ? "over target" : "left"}
          </span>
        </p>
      </div>

      {failure ? <div className="mt-3"><ErrorBanner message={failure} /></div> : null}

      <button
        type="button"
        onClick={() => void save()}
        disabled={busy || !dirty}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-3.5 text-base font-semibold text-background transition active:scale-[0.99] disabled:opacity-35"
      >
        {busy ? <Spinner className="border-t-background" /> : null}
        {saved ? "Saved" : "Save household settings"}
      </button>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Fixed outflows
 * ------------------------------------------------------------------ */

type OutflowDraft = {
  id: string | null;
  name: string;
  amount: string;
  billingDay: string;
  cadence: OutflowCadence;
  billingMonth: string;
};

const BLANK_DRAFT: OutflowDraft = {
  id: null,
  name: "",
  amount: "",
  billingDay: "1",
  cadence: "monthly",
  billingMonth: "1",
};

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

function OutflowsCard() {
  const { rows, addOutflow, deactivateOutflow, replaceOutflow } = useHousehold();
  const [draft, setDraft] = useState<OutflowDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const active = rows.fixedOutflows.filter((row) => row.active);
  const monthlyTotal = active
    .filter((row) => row.cadence === "monthly")
    .reduce((sum, row) => sum + parseCents(row.amount), 0);
  const yearlyTotal = active
    .filter((row) => row.cadence === "yearly")
    .reduce((sum, row) => sum + parseCents(row.amount), 0);

  async function save() {
    if (!draft) return;
    const amountCents = amountToCents(draft.amount);
    const day = Number(draft.billingDay);
    const monthNo = Number(draft.billingMonth);
    if (!draft.name.trim()) {
      setFailure("Give the outflow a name.");
      return;
    }
    if (amountCents <= 0) {
      setFailure("Amount must be more than zero.");
      return;
    }
    if (!Number.isInteger(day) || day < 1 || day > MAX_BILLING_DAY) {
      setFailure(`Billing day must be between 1 and ${MAX_BILLING_DAY}.`);
      return;
    }
    if (
      draft.cadence === "yearly" &&
      (!Number.isInteger(monthNo) || monthNo < 1 || monthNo > 12)
    ) {
      setFailure("Pick the month a yearly bill lands in.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const next = {
        name: draft.name,
        amountCents,
        billingDay: day,
        cadence: draft.cadence,
        billingMonth: draft.cadence === "yearly" ? monthNo : null,
      };
      if (draft.id) await replaceOutflow(draft.id, next);
      else await addOutflow(next);
      setDraft(null);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setRemoving(id);
    try {
      await deactivateOutflow(id);
    } finally {
      setRemoving(null);
    }
  }

  function edit(row: FixedOutflowRow) {
    setFailure(null);
    setDraft({
      id: row.id,
      name: row.name,
      amount: centsToBuffer(parseCents(row.amount)),
      billingDay: String(row.billing_day),
      cadence: row.cadence,
      billingMonth: String(row.billing_month ?? 1),
    });
  }

  return (
    <section className="rounded-3xl border border-border bg-surface px-5 py-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">
          Fixed outflows
        </h2>
        <span className="text-right text-xs font-semibold tabular-nums text-amber">
          {formatCents(monthlyTotal)}/mo
          {yearlyTotal > 0 ? (
            <span className="block font-medium text-muted">
              + {formatCents(yearlyTotal)}/yr
            </span>
          ) : null}
        </span>
      </div>

      {active.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted">
          No recurring bills yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {active.map((row) => (
            <li key={row.id} className="flex items-center gap-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium">{row.name}</p>
                <p className="text-xs text-muted">
                  {formatCents(parseCents(row.amount))} ·{" "}
                  {outflowCadenceLabel({
                    cadence: row.cadence,
                    billingMonth: row.billing_month,
                    billingDay: row.billing_day,
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => edit(row)}
                className="rounded-full px-2.5 py-1 text-xs font-semibold text-brand transition active:bg-border"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void remove(row.id)}
                disabled={removing === row.id}
                className="rounded-full px-2.5 py-1 text-xs font-semibold text-red transition active:bg-red/10 disabled:opacity-40"
              >
                {removing === row.id ? "…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => {
          setFailure(null);
          setDraft(BLANK_DRAFT);
        }}
        className="mt-4 w-full rounded-2xl border border-brand/25 bg-brand/5 py-3 text-sm font-semibold text-brand transition active:bg-brand/10"
      >
        + Add fixed outflow
      </button>

      <p className="mt-3 text-xs leading-snug text-muted">
        Monthly bills count in every month; yearly bills count in full only in
        their billing month. Removing soft-deletes and editing replaces, so past
        months keep the numbers they were actually tracked against.
      </p>

      <Sheet
        open={draft !== null}
        title={draft?.id ? "Replace outflow" : "New fixed outflow"}
        onClose={() => setDraft(null)}
      >
        <div className="flex flex-col gap-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">
            Name
            <input
              type="text"
              value={draft?.name ?? ""}
              maxLength={40}
              placeholder="Netflix"
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, name: e.target.value } : d))
              }
              className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-base font-normal text-foreground outline-none placeholder:text-muted/70 focus:border-brand"
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-muted">
            Amount
            <input
              type="text"
              inputMode="decimal"
              value={draft?.amount ?? ""}
              placeholder="19.98"
              onChange={(e) =>
                setDraft((d) =>
                  d ? { ...d, amount: e.target.value.replace(/[^0-9.]/g, "") } : d,
                )
              }
              className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-lg font-semibold tabular-nums text-foreground outline-none focus:border-brand"
            />
          </label>

          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Cadence
            <div
              role="radiogroup"
              aria-label="Cadence"
              className="mt-1 flex rounded-2xl bg-border/50 p-1"
            >
              {(["monthly", "yearly"] as const).map((cadence) => {
                const isActive = draft?.cadence === cadence;
                return (
                  <button
                    key={cadence}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() =>
                      setDraft((d) => (d ? { ...d, cadence } : d))
                    }
                    className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold capitalize transition ${
                      isActive
                        ? "bg-surface text-brand shadow-sm"
                        : "text-muted active:text-foreground"
                    }`}
                  >
                    {cadence}
                  </button>
                );
              })}
            </div>
          </div>

          {draft?.cadence === "yearly" ? (
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">
              Billing month
              <select
                value={draft.billingMonth}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, billingMonth: e.target.value } : d))
                }
                className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-base font-semibold text-foreground outline-none focus:border-brand"
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m} value={String(m)}>
                    {monthName(m)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="text-xs font-semibold uppercase tracking-wide text-muted">
            Billing day (1–{MAX_BILLING_DAY})
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_BILLING_DAY}
              value={draft?.billingDay ?? "1"}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, billingDay: e.target.value } : d))
              }
              className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-lg font-semibold tabular-nums text-foreground outline-none focus:border-brand"
            />
          </label>

          {failure ? <ErrorBanner message={failure} /> : null}

          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-2xl bg-brand py-3.5 text-base font-semibold text-background transition active:scale-[0.99] disabled:opacity-40"
          >
            {busy ? <Spinner className="border-t-background" /> : null}
            {draft?.id ? "Replace" : "Add"}
          </button>
        </div>
      </Sheet>
    </section>
  );
}
