"use client";

type NumpadProps = {
  onKey: (key: string) => void;
  /** Show the `.` key (amount entry) or a blank cell (PIN entry). */
  showDecimal?: boolean;
  className?: string;
};

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

function Key({
  label,
  value,
  onKey,
  ariaLabel,
}: {
  label: React.ReactNode;
  value: string;
  onKey: (key: string) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? value}
      onClick={() => onKey(value)}
      className="h-14 rounded-2xl bg-surface text-2xl font-semibold text-foreground shadow-[0_1px_0_0_var(--border)] ring-1 ring-border transition active:scale-[0.97] active:bg-border"
    >
      {label}
    </button>
  );
}

export default function Numpad({
  onKey,
  showDecimal = true,
  className = "",
}: NumpadProps) {
  return (
    <div className={`grid grid-cols-3 gap-2.5 ${className}`}>
      {DIGITS.map((d) => (
        <Key key={d} label={d} value={d} onKey={onKey} />
      ))}
      {showDecimal ? (
        <Key label="." value="." onKey={onKey} ariaLabel="decimal point" />
      ) : (
        <span aria-hidden />
      )}
      <Key label="0" value="0" onKey={onKey} />
      <Key label="⌫" value="back" onKey={onKey} ariaLabel="backspace" />
    </div>
  );
}
