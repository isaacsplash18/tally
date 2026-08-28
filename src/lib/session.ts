"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { ISAAC_ID, USERS_BY_ID, userName as lookupUserName } from "./constants";

/**
 * Local identity only — there is no PIN or lock screen. Tally is a two-person
 * household app; the only thing this module tracks is which person is
 * currently logging, so spends are attributed correctly.
 *
 * The flag lives in localStorage and is read through `useSyncExternalStore`,
 * which gives us a `null` snapshot during SSR/hydration — that is what keeps
 * a returning device from flashing the "who's this?" chooser on load.
 */
export const USER_STORAGE_KEY = "tally.userId";

/* ---------------- tiny external store over localStorage ---------------- */

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab (or the other phone's browser) picking a user counts too.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readStoredUserId(): string | null {
  try {
    const stored = window.localStorage.getItem(USER_STORAGE_KEY);
    if (stored && USERS_BY_ID[stored]) return stored;
  } catch {
    /* private mode / storage disabled — fall through to "not chosen" */
  }
  return null;
}

/** True once this device has an identity stored — drives the first-visit chooser. */
export function readHasUser(): boolean {
  return readStoredUserId() !== null;
}

export function readUserId(): string {
  return readStoredUserId() ?? ISAAC_ID;
}

function writeUserId(id: string): void {
  try {
    window.localStorage.setItem(USER_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  emit();
}

/* ---------------- hook ---------------- */

export type SessionValue = {
  /** `null` until localStorage has been read on the client. */
  hasUser: boolean | null;
  userId: string;
  userName: string;
  setUserId: (id: string) => void;
};

export function useSession(): SessionValue {
  const hasUser = useSyncExternalStore(
    subscribe,
    readHasUser,
    () => null as boolean | null,
  );
  const userId = useSyncExternalStore(subscribe, readUserId, () => ISAAC_ID);

  const setUserId = useCallback((id: string) => writeUserId(id), []);

  return useMemo(
    () => ({
      hasUser,
      userId,
      userName: lookupUserName(userId),
      setUserId,
    }),
    [hasUser, userId, setUserId],
  );
}
