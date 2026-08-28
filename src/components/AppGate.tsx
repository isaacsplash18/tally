"use client";

import { USERS } from "@/lib/constants";
import { useSession } from "@/lib/session";

/**
 * First-visit identity chooser. Everything behind it (including the data
 * fetch) only mounts once this device has an identity stored — there is no
 * PIN, this exists purely so spends are attributed to the right person.
 */
export default function AppGate({ children }: { children: React.ReactNode }) {
  const { hasUser } = useSession();

  // Still reading localStorage — render nothing rather than flashing the chooser.
  if (hasUser === null) return null;
  if (hasUser) return <>{children}</>;
  return <WhoScreen />;
}

function WhoScreen() {
  const { setUserId } = useSession();

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-10 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-16">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-brand">Tally</h1>
        <p className="mt-2 text-sm text-muted">Who&apos;s this?</p>
      </div>

      <div className="flex w-full flex-col gap-4">
        {USERS.map((user) => (
          <button
            key={user.id}
            type="button"
            onClick={() => setUserId(user.id)}
            className="rounded-3xl border border-border bg-surface py-8 text-2xl font-bold text-foreground shadow-sm transition active:scale-[0.98] active:bg-border/40"
          >
            {user.name}
          </button>
        ))}
      </div>
    </div>
  );
}
