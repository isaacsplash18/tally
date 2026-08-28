/**
 * Hardcoded household constants.
 *
 * The two users are seeded in Supabase with deterministic UUIDs (see
 * docs/engine-spec.md § Tables) so the frontend can reference them without a
 * round trip or an auth session.
 */

export type HouseholdUser = {
  id: string;
  name: string;
  /** Short label used on compact chips / spend rows. */
  initial: string;
};

export const ISAAC_ID = "11111111-1111-4111-8111-111111111111";
export const RACHELL_ID = "22222222-2222-4222-8222-222222222222";

export const USERS: HouseholdUser[] = [
  { id: ISAAC_ID, name: "Isaac", initial: "I" },
  { id: RACHELL_ID, name: "Rachell", initial: "R" },
];

export const USERS_BY_ID: Record<string, HouseholdUser> = Object.fromEntries(
  USERS.map((u) => [u.id, u]),
);

export function userName(id: string | null | undefined): string {
  if (!id) return "Household";
  return USERS_BY_ID[id]?.name ?? "Unknown";
}

/** Max billing day accepted for a fixed outflow (schema check: 1..28). */
export const MAX_BILLING_DAY = 28;
