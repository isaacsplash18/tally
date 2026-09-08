"use client";

import type { SpendKind } from "@/lib/engine";

const OPTIONS: { kind: SpendKind; label: string }[] = [
  { kind: "personal", label: "Personal" },
  { kind: "family", label: "Family big ticket" },
];

/**
 * Spec § 16 — which envelope (if any) a spend comes out of. Compact sibling of
 * {@link UserToggle}: `personal` is the default and the far commoner case, so
 * `family` has to be chosen deliberately every time.
 */
export function SpendKindToggle({
  value,
  onChange,
  className = "",
}: {
  value: SpendKind;
  onChange: (kind: SpendKind) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Spend kind"
      className={`flex rounded-2xl bg-border/50 p-1 ${className}`}
    >
      {OPTIONS.map((option) => {
        const active = option.kind === value;
        return (
          <button
            key={option.kind}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.kind)}
            className={`flex-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
              active
                ? "bg-surface text-brand shadow-sm"
                : "text-muted active:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** The one-line explanation shown while `family` is selected. */
export function FamilyKindHint() {
  return (
    <p className="px-1 text-center text-xs leading-snug text-brand">
      Doesn&apos;t touch weekly envelopes — counts against the monthly budget
    </p>
  );
}

/** Inline marker on a spend row that is a family big-ticket item. */
export function FamilyBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand ${className}`}
    >
      Family
    </span>
  );
}
