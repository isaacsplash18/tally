"use client";

import { USERS } from "@/lib/constants";

type UserToggleProps = {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  className?: string;
};

/** Isaac / Rachell segmented control — who is logging this. */
export default function UserToggle({
  value,
  onChange,
  label = "Logged by",
  className = "",
}: UserToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`flex rounded-2xl bg-border/50 p-1 ${className}`}
    >
      {USERS.map((user) => {
        const active = user.id === value;
        return (
          <button
            key={user.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(user.id)}
            className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${
              active
                ? "bg-surface text-brand shadow-sm"
                : "text-muted active:text-foreground"
            }`}
          >
            {user.name}
          </button>
        );
      })}
    </div>
  );
}
