"use client";

import { useState } from "react";

import { ErrorBanner, ScreenSkeleton } from "@/components/Feedback";
import { FamilyBadge } from "@/components/SpendKind";
import { userName } from "@/lib/constants";
import {
  formatCents,
  formatSgtDate,
  formatSgtTime,
  isFamilySpend,
  parseCents,
  type UserWeekModel,
  type WeekModel,
} from "@/lib/engine";
import { useHousehold } from "@/lib/useHousehold";

export default function HistoryScreen() {
  const { model, loading, error, refetch } = useHousehold();
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading && model.weeks.length === 0) return <ScreenSkeleton />;

  const weeks = [...model.weeks].reverse();

  return (
    <div className="flex flex-1 flex-col gap-4">
      <h1 className="text-xl font-bold tracking-tight text-brand">History</h1>

      {error ? <ErrorBanner message={error} onRetry={() => void refetch()} /> : null}

      {weeks.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          No weeks yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {weeks.map((week) => (
            <WeekRow
              key={week.key}
              week={week}
              open={expanded === week.key}
              onToggle={() =>
                setExpanded((k) => (k === week.key ? null : week.key))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function WeekRow({
  week,
  open,
  onToggle,
}: {
  week: WeekModel;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-col gap-2.5 px-4 py-3.5 text-left transition active:bg-border/40"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-base font-semibold">{week.label}</p>
          {week.status === "open" ? (
            <span className="shrink-0 rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand">
              In progress
            </span>
          ) : week.earnCents > 0 ? (
            <span className="shrink-0 text-xs font-semibold tabular-nums text-brand-accent">
              +{formatCents(week.earnCents)} to pot
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          {week.userWeeks.map((uw) => (
            <PersonLine key={uw.userId} userWeek={uw} />
          ))}
          {week.familySpentCents > 0 ? (
            <p className="text-xs tabular-nums text-brand">
              + {formatCents(week.familySpentCents)} family big ticket — outside
              both envelopes
            </p>
          ) : null}
        </div>
      </button>

      {open ? (
        <div className="border-t border-border bg-background/60 px-4 py-3">
          {week.spends.length === 0 ? (
            <p className="py-2 text-center text-sm text-muted">
              No spends this week.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {week.spends.map((spend) => (
                <li key={spend.id} className="flex items-baseline justify-between gap-3">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <p className="truncate text-sm">
                      <span className="font-semibold tabular-nums">
                        {formatCents(parseCents(spend.amount))}
                      </span>
                      {spend.note ? (
                        <span className="ml-2 text-muted">{spend.note}</span>
                      ) : null}
                    </p>
                    {isFamilySpend(spend) ? <FamilyBadge /> : null}
                  </div>
                  <span className="shrink-0 text-xs text-muted">
                    {userName(spend.logged_by)} ·{" "}
                    {formatSgtDate(Date.parse(spend.created_at))}{" "}
                    {formatSgtTime(Date.parse(spend.created_at))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {week.userWeeks
            .filter((uw) => uw.carryInCents < 0)
            .map((uw) => (
              <p
                key={uw.userId}
                className="mt-3 border-t border-border pt-2 text-xs text-amber"
              >
                {userName(uw.userId)}&apos;s envelope was reduced by{" "}
                {formatCents(-uw.carryInCents)} carried in from the previous
                week.
              </p>
            ))}
        </div>
      ) : null}
    </li>
  );
}

/** One person's spent-vs-envelope line with an under/over badge and earn. */
function PersonLine({ userWeek }: { userWeek: UserWeekModel }) {
  const over = userWeek.resultCents < 0;
  const isOpenWeek = userWeek.status === "open";

  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs font-semibold text-muted">
        {userName(userWeek.userId)}
      </span>
      <span className="flex-1 text-xs tabular-nums text-muted">
        {formatCents(userWeek.spentCents)} of{" "}
        {formatCents(userWeek.effectiveEnvelopeCents)}
        {userWeek.earnCents > 0 ? (
          <span className="ml-2 font-semibold text-brand-accent">
            +{formatCents(userWeek.earnCents)}
          </span>
        ) : null}
      </span>
      {isOpenWeek ? (
        <span className="shrink-0 rounded-full bg-border/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
          {formatCents(userWeek.resultCents)} left
        </span>
      ) : over ? (
        <span className="shrink-0 rounded-full bg-red/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red">
          Over {formatCents(-userWeek.resultCents)}
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-brand-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-accent">
          Under
        </span>
      )}
    </div>
  );
}
