"use client";

import { useState } from "react";

import { ErrorBanner, ScreenSkeleton } from "@/components/Feedback";
import { userName } from "@/lib/constants";
import {
  formatCents,
  formatMonthLabel,
  outflowCadenceLabel,
  spentFraction,
  type MonthModel,
  type WeekModel,
} from "@/lib/engine";
import { useHousehold } from "@/lib/useHousehold";

export default function MonthScreen() {
  const { model, loading, error, refetch } = useHousehold();
  // `null` means "follow the current month" — no effect needed, the fallback is
  // derived at render time.
  const [monthKey, setMonthKey] = useState<string | null>(null);

  if (loading && model.months.length === 0) return <ScreenSkeleton />;

  const keys = model.months.map((m) => m.key);
  const fallback = model.currentMonthKey ?? keys[keys.length - 1];
  const active =
    monthKey && keys.includes(monthKey)
      ? monthKey
      : keys.includes(fallback ?? "")
        ? fallback
        : keys[keys.length - 1];
  const month = active ? model.monthsByKey[active] : undefined;
  const index = active ? keys.indexOf(active) : -1;

  return (
    <div className="flex flex-1 flex-col gap-5">
      {error ? <ErrorBanner message={error} onRetry={() => void refetch()} /> : null}

      <header className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          disabled={index <= 0}
          onClick={() => setMonthKey(keys[index - 1])}
          className="rounded-full border border-border bg-surface px-3 py-2 text-sm font-semibold transition active:bg-border disabled:opacity-30"
        >
          ‹
        </button>
        <h1 className="text-xl font-bold tracking-tight text-brand">
          {active ? formatMonthLabel(active) : "Month"}
        </h1>
        <button
          type="button"
          aria-label="Next month"
          disabled={index < 0 || index >= keys.length - 1}
          onClick={() => setMonthKey(keys[index + 1])}
          className="rounded-full border border-border bg-surface px-3 py-2 text-sm font-semibold transition active:bg-border disabled:opacity-30"
        >
          ›
        </button>
      </header>

      {month ? <MonthBody month={month} /> : (
        <p className="rounded-2xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          No months yet — set a budget in Settings.
        </p>
      )}
    </div>
  );
}

function MonthBody({ month }: { month: MonthModel }) {
  const { model } = useHousehold();
  const over = month.remainingCents < 0;

  return (
    <>
      <section className="rounded-3xl border border-border bg-surface px-5 py-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Tracking target
        </p>
        <Row label="Monthly budget" value={formatCents(month.monthlyBudgetCents)} />
        <Row
          label="Fixed outflows this month"
          value={`−${formatCents(month.fixedTotalCents)}`}
          tone="amber"
        />
        <Row
          label="Spent this month"
          value={`−${formatCents(month.spentCents)}`}
          tone="amber"
        />
        <div className="my-3 border-t border-border" />
        <Row
          label={over ? "Over target by" : "Left against target"}
          value={formatCents(over ? -month.remainingCents : month.remainingCents)}
          strong
          tone={over ? "red" : undefined}
        />
        <p className="mt-2 text-xs leading-snug text-muted">
          Tracking only — the weekly envelopes are each person&apos;s own budget
          and are not derived from this number.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted">
          Spent by
        </h2>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {model.userIds.map((id) => (
            <li key={id} className="flex items-center justify-between px-4 py-3">
              <span className="text-base font-medium">{userName(id)}</span>
              <span className="text-base font-semibold tabular-nums">
                {formatCents(month.spentByUser[id] ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted">
          Fixed outflows
        </h2>
        {month.fixedOutflows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted">
            None for this month.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {month.fixedOutflows.map((row) => (
              <li key={row.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-medium">{row.name}</p>
                  <p className="text-xs text-muted">
                    {outflowCadenceLabel(row)}
                    {row.active ? "" : " · ending"}
                  </p>
                </div>
                <span className="shrink-0 text-base font-semibold tabular-nums text-muted">
                  {formatCents(row.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-[0.14em] text-muted">
          Weeks
        </h2>
        <p className="mb-3 text-xs text-muted">
          One bar per person, against their own envelope. Weeks belong to the
          month containing their Monday.
        </p>
        {month.weeks.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted">
            No week starts in this month yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {month.weeks.map((week) => (
              <WeekBars key={week.key} week={week} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * Two thin bars per week, one per person against their own envelope. A single
 * household bar would be meaningless now that the envelope is personal.
 */
function WeekBars({ week }: { week: WeekModel }) {
  return (
    <li>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">
          {week.label}
          {week.status === "open" ? (
            <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
              open
            </span>
          ) : null}
        </span>
        <span className="tabular-nums text-muted">
          {formatCents(week.spentCents)} household
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {week.userWeeks.map((uw) => {
          const fraction = spentFraction(uw);
          const over = uw.resultCents < 0;
          const width = `${Math.min(100, Math.max(0, fraction * 100))}%`;
          // Closed weeks read as a verdict (green under / red over); the open
          // week is still in play, so it gets the neutral brand colour.
          const fill =
            uw.status === "open" ? "bg-brand" : over ? "bg-red" : "bg-brand-accent";

          return (
            <div key={uw.userId} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {userName(uw.userId)}
              </span>
              <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-border/70">
                <div className={`h-full rounded-full ${fill}`} style={{ width }} />
                {fraction > 1 ? (
                  <span className="absolute inset-y-0 right-0 w-1.5 bg-red" />
                ) : null}
              </div>
              <span
                className={`w-28 shrink-0 text-right text-[11px] tabular-nums ${
                  over ? "text-red" : "text-muted"
                }`}
              >
                {formatCents(uw.spentCents)} / {formatCents(uw.effectiveEnvelopeCents)}
              </span>
            </div>
          );
        })}
      </div>
    </li>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "amber" | "red";
}) {
  const toneClass =
    tone === "amber" ? "text-amber" : tone === "red" ? "text-red" : "";
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className={`text-sm ${strong ? "font-semibold" : "text-muted"}`}>
        {label}
      </span>
      <span
        className={`tabular-nums ${
          strong ? "text-xl font-bold text-brand" : "text-base font-medium"
        } ${toneClass}`}
      >
        {value}
      </span>
    </div>
  );
}
