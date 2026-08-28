"use client";

/** Small inline error banner with a retry affordance. */
export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-red/25 bg-red/5 px-4 py-3"
    >
      <p className="text-sm leading-snug text-red">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-full border border-red/30 px-3 py-1 text-xs font-semibold text-red transition active:bg-red/10"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-border border-t-brand ${className}`}
    />
  );
}

function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-border/70 ${className}`} />;
}

/** Generic loading placeholder used by every screen. */
export function ScreenSkeleton() {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <Bar className="h-8 w-1/2" />
      <Bar className="h-32 w-full" />
      <Bar className="h-14 w-full" />
      <Bar className="h-14 w-full" />
      <Bar className="h-14 w-2/3" />
    </div>
  );
}
