"use client";

import { useMemo, useState } from "react";

import { ErrorBanner, ScreenSkeleton, Spinner } from "@/components/Feedback";
import Numpad from "@/components/Numpad";
import Sheet from "@/components/Sheet";
import UserToggle from "@/components/UserToggle";
import { amountToCents, centsToBuffer, displayAmount, pushAmountKey } from "@/lib/amountInput";
import { userName } from "@/lib/constants";
import {
  envelopeTone,
  formatCents,
  formatCountdown,
  formatSgtDayTime,
  parseCents,
  redeemBlockReason,
  type SpendRow,
  type UserWeekModel,
  type WeekModel,
} from "@/lib/engine";
import { useSession } from "@/lib/session";
import { useHousehold } from "@/lib/useHousehold";

const TONE_TEXT = {
  green: "text-brand-accent",
  amber: "text-amber",
  red: "text-red",
} as const;

export default function HomeScreen() {
  const { model, loading, error, refetch } = useHousehold();
  const { userId, setUserId } = useSession();
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [editing, setEditing] = useState<SpendRow | null>(null);

  if (loading && model.weeks.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <Header activeUserId={userId} onRedeem={() => setRedeemOpen(true)} />
        <ScreenSkeleton />
      </div>
    );
  }

  const week = model.currentWeek;
  // The toggle picks BOTH whose envelope is shown and who a spend is logged as.
  const mine = week?.userWeeksById[userId] ?? null;
  const partners = week
    ? week.userWeeks.filter((u) => u.userId !== userId)
    : [];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Header activeUserId={userId} onRedeem={() => setRedeemOpen(true)} />

      {error ? <ErrorBanner message={error} onRetry={() => void refetch()} /> : null}

      {week && mine ? (
        <>
          <RemainingCard
            userWeek={mine}
            partners={partners}
            nowMs={model.nowMs}
          />
          <QuickLog userId={userId} setUserId={setUserId} />
          <ThisWeek week={week} onEdit={setEditing} />
        </>
      ) : (
        <p className="rounded-2xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          No open week yet. Set a weekly budget in Settings to get started.
        </p>
      )}

      <RedeemSheet open={redeemOpen} onClose={() => setRedeemOpen(false)} />
      <EditSpendSheet spend={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Header({
  activeUserId,
  onRedeem,
}: {
  activeUserId: string;
  onRedeem: () => void;
}) {
  const { model } = useHousehold();
  const frozenNames = model.frozenUserIds.map(userName);
  const streak = model.usersById[activeUserId]?.streak ?? 0;

  return (
    <header className="flex items-start justify-between gap-3">
      <h1 className="text-2xl font-bold tracking-tight text-brand">Tally</h1>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRedeem}
          className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-semibold transition active:bg-border"
          aria-label={
            frozenNames.length > 0
              ? `Reward pot ${formatCents(model.potBalanceCents)}, frozen by ${frozenNames.join(" and ")}. Redeem.`
              : `Reward pot ${formatCents(model.potBalanceCents)}. Redeem.`
          }
        >
          <span aria-hidden>{model.frozen ? "🔒" : "🏆"}</span>
          <span className={model.frozen ? "text-muted line-through" : "text-brand"}>
            {formatCents(model.potBalanceCents)}
          </span>
          {frozenNames.length > 0 ? (
            <span className="text-[11px] font-semibold text-amber" aria-hidden>
              {frozenNames.join(" + ")}
            </span>
          ) : null}
        </button>

        <span
          className="flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-semibold"
          aria-label={`${userName(activeUserId)}: ${streak} week streak`}
        >
          <span aria-hidden>🔥</span>
          <span>{streak}</span>
        </span>
      </div>
    </header>
  );
}

function RemainingCard({
  userWeek,
  partners,
  nowMs,
}: {
  userWeek: UserWeekModel;
  partners: UserWeekModel[];
  nowMs: number;
}) {
  const tone = envelopeTone(userWeek);
  return (
    <section className="rounded-3xl border border-border bg-surface px-5 py-7 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        {userName(userWeek.userId)} · left this week
      </p>
      <p
        className={`mt-2 text-[3.25rem] font-bold leading-none tracking-tight tabular-nums ${TONE_TEXT[tone]}`}
      >
        {formatCents(userWeek.resultCents)}
      </p>
      <p className="mt-4 text-sm text-muted">
        {formatCents(userWeek.effectiveEnvelopeCents)} envelope ·{" "}
        {formatCents(userWeek.spentCents)} spent
      </p>
      {userWeek.carryInCents < 0 ? (
        <p className="mt-1 text-xs font-medium text-amber">
          Includes {formatCents(userWeek.carryInCents)} carried over from last week
        </p>
      ) : null}

      {partners.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-border pt-3">
          {partners.map((partner) => (
            <p key={partner.userId} className="text-sm text-muted">
              {userName(partner.userId)}:{" "}
              <span
                className={`font-semibold tabular-nums ${
                  partner.resultCents < 0 ? "text-red" : "text-foreground"
                }`}
              >
                {formatCents(partner.resultCents)}
              </span>{" "}
              left
            </p>
          ))}
        </div>
      ) : null}

      <p className="mt-3 text-xs text-muted">
        Week closes Sun 23:59 · {formatCountdown(nowMs, userWeek.end)} left
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function QuickLog({
  userId,
  setUserId,
}: {
  userId: string;
  setUserId: (id: string) => void;
}) {
  const { addSpend } = useHousehold();
  const [buffer, setBuffer] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const cents = amountToCents(buffer);

  async function submit() {
    if (cents <= 0 || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await addSpend({ amountCents: cents, note, loggedBy: userId });
      setBuffer("");
      setNote("");
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Could not log that spend.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="rounded-3xl border border-border bg-surface px-5 py-4 text-center">
        <span
          className={`text-4xl font-bold tabular-nums ${
            cents > 0 ? "text-foreground" : "text-muted/50"
          }`}
        >
          ${displayAmount(buffer)}
        </span>
      </div>

      <Numpad onKey={(key) => setBuffer((b) => pushAmountKey(b, key))} />

      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        maxLength={80}
        className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-base outline-none placeholder:text-muted/70 focus:border-brand"
      />

      <UserToggle value={userId} onChange={setUserId} />

      {failure ? <ErrorBanner message={failure} /> : null}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={cents <= 0 || busy}
        className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-brand text-lg font-semibold text-background transition active:scale-[0.99] disabled:opacity-35"
      >
        {busy ? <Spinner className="border-t-background" /> : null}
        Log {cents > 0 ? formatCents(cents) : "spend"}
      </button>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function ThisWeek({
  week,
  onEdit,
}: {
  week: WeekModel;
  onEdit: (spend: SpendRow) => void;
}) {
  const { deleteSpend } = useHousehold();
  const [pending, setPending] = useState<string | null>(null);
  const recent = useMemo(() => week.spends.slice(0, 10), [week.spends]);

  async function remove(id: string) {
    setPending(id);
    try {
      await deleteSpend(id);
    } finally {
      setPending(null);
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">
          This week
        </h2>
        <span className="text-xs text-muted">{week.label}</span>
      </div>

      {recent.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          Nothing logged yet this week.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {recent.map((spend) => (
            <li key={spend.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold tabular-nums">
                  {formatCents(parseCents(spend.amount))}
                  {spend.note ? (
                    <span className="ml-2 truncate text-sm font-normal text-muted">
                      {spend.note}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {userName(spend.logged_by)} ·{" "}
                  {formatSgtDayTime(Date.parse(spend.created_at))}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onEdit(spend)}
                className="rounded-full px-2.5 py-1 text-xs font-semibold text-brand transition active:bg-border"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void remove(spend.id)}
                disabled={pending === spend.id}
                aria-label="Delete spend"
                className="rounded-full px-2.5 py-1 text-xs font-semibold text-red transition active:bg-red/10 disabled:opacity-40"
              >
                {pending === spend.id ? "…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function EditSpendSheet({
  spend,
  onClose,
}: {
  spend: SpendRow | null;
  onClose: () => void;
}) {
  const { updateSpend } = useHousehold();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  // Seed the form the first time each spend is opened.
  if (spend && loadedId !== spend.id) {
    setLoadedId(spend.id);
    setAmount(centsToBuffer(parseCents(spend.amount)));
    setNote(spend.note ?? "");
    setFailure(null);
  }

  async function save() {
    if (!spend) return;
    const cents = amountToCents(amount);
    if (cents <= 0) {
      setFailure("Amount must be more than zero.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await updateSpend(spend.id, { amountCents: cents, note });
      onClose();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={spend !== null} title="Edit spend" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted">
          Amount
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-lg font-semibold tabular-nums text-foreground outline-none focus:border-brand"
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-muted">
          Note
          <input
            type="text"
            value={note}
            maxLength={80}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-base font-normal text-foreground outline-none focus:border-brand"
          />
        </label>
        {failure ? <ErrorBanner message={failure} /> : null}
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="rounded-2xl bg-brand py-3.5 text-base font-semibold text-background transition active:scale-[0.99] disabled:opacity-40"
        >
          Save changes
        </button>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */

function RedeemSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { model, redeemPot } = useHousehold();
  const { userId } = useSession();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const cents = amountToCents(amount);
  const blocked = redeemBlockReason(model, cents, userName);
  const frozenNames = model.frozenUserIds.map(userName);

  async function submit() {
    if (blocked) {
      setFailure(blocked);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await redeemPot({ amountCents: cents, note, loggedBy: userId });
      setAmount("");
      setNote("");
      onClose();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Could not redeem.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title="Redeem from the pot" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="rounded-2xl bg-background px-4 py-3 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Pot balance
          </p>
          <p className="text-2xl font-bold tabular-nums text-brand">
            {formatCents(model.potBalanceCents)}
          </p>
        </div>

        {model.frozen ? (
          <p className="rounded-2xl border border-amber/30 bg-amber/5 px-4 py-3 text-sm leading-snug text-amber">
            ❄️ {frozenNames.join(" and ")} went over budget, so the pot is
            frozen. One full week under budget thaws{" "}
            {frozenNames.length > 1 ? "each of them" : "them"} — that week banks
            nothing, then earning resumes.
          </p>
        ) : null}

        <label className="text-xs font-semibold uppercase tracking-wide text-muted">
          Amount
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.00"
            disabled={model.frozen}
            className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-lg font-semibold tabular-nums text-foreground outline-none focus:border-brand disabled:opacity-50"
          />
        </label>

        <label className="text-xs font-semibold uppercase tracking-wide text-muted">
          What for?
          <input
            type="text"
            value={note}
            maxLength={80}
            placeholder="omakase"
            disabled={model.frozen}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-base font-normal text-foreground outline-none placeholder:text-muted/70 focus:border-brand disabled:opacity-50"
          />
        </label>

        {failure ? <ErrorBanner message={failure} /> : null}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || blocked !== null}
          className="rounded-2xl bg-brand py-3.5 text-base font-semibold text-background transition active:scale-[0.99] disabled:opacity-35"
        >
          Redeem {cents > 0 ? formatCents(cents) : ""}
        </button>

        {blocked && cents > 0 ? (
          <p className="text-center text-xs text-muted">{blocked}</p>
        ) : null}
      </div>
    </Sheet>
  );
}
