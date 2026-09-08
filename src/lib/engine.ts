/**
 * Tally budget engine.
 *
 * Pure, framework-free implementation of docs/engine-spec.md. Nothing is
 * derived server-side: the whole model is folded in memory from the five
 * tables (settings, user_budgets, fixed_outflows, spends, pot_ledger).
 *
 * Three rules run through everything here:
 *   1. All money is integer cents. Never accumulate floats.
 *   2. All wall-clock reasoning is Asia/Singapore (fixed UTC+8, no DST). We
 *      shift the epoch by +8h and read UTC getters — the machine's local
 *      timezone is never consulted.
 *   3. The weekly engine is PER PERSON. Each user has their own weekly budget,
 *      their own overspend carry chain, their own streak and their own freeze
 *      flag. Only the reward pot is shared.
 */

/* ------------------------------------------------------------------ *
 * Row shapes (as returned by PostgREST)
 * ------------------------------------------------------------------ */

/** `numeric(10,2)` arrives as a string from PostgREST, or a number from JS. */
export type Numeric = string | number;

export interface SettingsRow {
  id: string;
  /** Household tracking target only — it no longer feeds the weekly envelope. */
  monthly_budget: Numeric;
  rollover_pct: number;
  currency: string;
  effective_from: string;
  created_at: string;
}

export interface UserBudgetRow {
  id: string;
  user_id: string;
  weekly_budget: Numeric;
  effective_from: string;
  created_at: string;
}

export type OutflowCadence = "monthly" | "yearly";

export interface FixedOutflowRow {
  id: string;
  name: string;
  amount: Numeric;
  billing_day: number;
  cadence: OutflowCadence;
  /** 1..12 for yearly rows, `null` for monthly rows. */
  billing_month: number | null;
  active: boolean;
  created_at: string;
  deactivated_at: string | null;
}

export interface SpendRow {
  id: string;
  amount: Numeric;
  note: string | null;
  logged_by: string;
  created_at: string;
}

export interface PotLedgerRow {
  id: string;
  amount: Numeric;
  type: "redeem" | "adjust";
  note: string | null;
  logged_by: string | null;
  created_at: string;
}

export interface HouseholdRows {
  settings: SettingsRow[];
  userBudgets: UserBudgetRow[];
  fixedOutflows: FixedOutflowRow[];
  spends: SpendRow[];
  potLedger: PotLedgerRow[];
}

/* ------------------------------------------------------------------ *
 * Money — integer cents, round half-away-from-zero
 * ------------------------------------------------------------------ */

/** Parse a `numeric` value into integer cents. */
export function parseCents(value: Numeric | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Round to whole cents, half away from zero. */
export function roundCents(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** Cents → the `numeric(10,2)` string Postgres expects on write. */
export function centsToNumericString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** `123456` → `"$1,234.56"`, `-500` → `"-$5.00"`. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars.toLocaleString("en-SG")}.${rest}`;
}

/** Like {@link formatCents} but drops `.00` — for compact chips and bars. */
export function formatCentsShort(cents: number): string {
  return cents % 100 === 0
    ? formatCents(cents).replace(/\.00$/, "")
    : formatCents(cents);
}

/* ------------------------------------------------------------------ *
 * Asia/Singapore date maths (UTC+8, no DST, no external libraries)
 * ------------------------------------------------------------------ */

export const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

export interface SgtFields {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  hour: number;
  minute: number;
  second: number;
}

/** Epoch ms for an SGT wall-clock instant. */
export function sgtEpoch(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): number {
  return Date.UTC(year, month - 1, day, hour, minute, second, ms) - SGT_OFFSET_MS;
}

/** SGT calendar fields for an epoch ms. */
export function sgtFields(ms: number): SgtFields {
  const d = new Date(ms + SGT_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` for the SGT calendar date containing `ms`. */
export function sgtDateKey(ms: number): string {
  const f = sgtFields(ms);
  return `${f.year}-${pad2(f.month)}-${pad2(f.day)}`;
}

/** `YYYY-MM` for the SGT calendar month containing `ms`. */
export function sgtMonthKey(ms: number): string {
  const f = sgtFields(ms);
  return `${f.year}-${pad2(f.month)}`;
}

/** Epoch ms of Monday 00:00:00.000 SGT for the week containing `ms`. */
export function mondayStart(ms: number): number {
  const f = sgtFields(ms);
  const midnight = sgtEpoch(f.year, f.month, f.day);
  const daysSinceMonday = (f.weekday + 6) % 7;
  return midnight - daysSinceMonday * DAY_MS;
}

/** The first Monday 00:00 SGT at or after `ms`. */
export function firstMondayAtOrAfter(ms: number): number {
  const monday = mondayStart(ms);
  return monday >= ms ? monday : monday + WEEK_MS;
}

/** Epoch ms of the first instant of the SGT month containing `ms`. */
export function startOfMonth(ms: number): number {
  const f = sgtFields(ms);
  return sgtEpoch(f.year, f.month, 1);
}

/** Parse `"YYYY-MM"` into its numeric parts. */
export function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [y, m] = monthKey.split("-");
  return { year: Number(y), month: Number(m) };
}

/** Epoch ms of the first instant of month `"YYYY-MM"` in SGT. */
export function startOfMonthKey(monthKey: string): number {
  const { year, month } = parseMonthKey(monthKey);
  return sgtEpoch(year, month, 1);
}

/** `"YYYY-MM"` shifted by `delta` months. */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const { year, month } = parseMonthKey(monthKey);
  const total = year * 12 + (month - 1) + delta;
  return `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Number of Mondays in an SGT calendar month (4 or 5). Display only now that
 * the envelope is a plain per-person number. Aug 2026 → 5, Sep 2026 → 4.
 */
export function weeksInMonth(monthKey: string): number {
  const { year, month } = parseMonthKey(monthKey);
  const firstWeekday = sgtFields(sgtEpoch(year, month, 1)).weekday;
  const firstMondayDay = 1 + ((1 - firstWeekday + 7) % 7);
  return Math.floor((daysInMonth(year, month) - firstMondayDay) / 7) + 1;
}

/* ------------------------------------------------------------------ *
 * Display formatting (SGT)
 * ------------------------------------------------------------------ */

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `3` → `"Mar"`. */
export function monthName(month: number): string {
  return MONTHS_SHORT[Math.min(12, Math.max(1, month)) - 1];
}

/** `"2026-08"` → `"August 2026"`. */
export function formatMonthLabel(monthKey: string): string {
  const { year, month } = parseMonthKey(monthKey);
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

/** `"2026-08"` → `"Aug 2026"`. */
export function formatMonthLabelShort(monthKey: string): string {
  const { year, month } = parseMonthKey(monthKey);
  return `${MONTHS_SHORT[month - 1]} ${year}`;
}

/** `"3–9 Aug"`, `"31 Aug – 6 Sep"`, `"28 Dec 2026 – 3 Jan 2027"`. */
export function formatWeekRange(startMs: number, endMs: number): string {
  const a = sgtFields(startMs);
  const b = sgtFields(endMs);
  if (a.year !== b.year) {
    return `${a.day} ${MONTHS_SHORT[a.month - 1]} ${a.year} – ${b.day} ${MONTHS_SHORT[b.month - 1]} ${b.year}`;
  }
  if (a.month !== b.month) {
    return `${a.day} ${MONTHS_SHORT[a.month - 1]} – ${b.day} ${MONTHS_SHORT[b.month - 1]}`;
  }
  return `${a.day}–${b.day} ${MONTHS_SHORT[a.month - 1]}`;
}

/** `"Fri 7 Aug"`. */
export function formatSgtDate(ms: number): string {
  const f = sgtFields(ms);
  return `${DAYS_SHORT[f.weekday]} ${f.day} ${MONTHS_SHORT[f.month - 1]}`;
}

/** `"9:42 am"`. */
export function formatSgtTime(ms: number): string {
  const f = sgtFields(ms);
  const suffix = f.hour < 12 ? "am" : "pm";
  const h12 = f.hour % 12 === 0 ? 12 : f.hour % 12;
  return `${h12}:${pad2(f.minute)} ${suffix}`;
}

/** `"Fri 9:42 am"`. */
export function formatSgtDayTime(ms: number): string {
  const f = sgtFields(ms);
  return `${DAYS_SHORT[f.weekday]} ${formatSgtTime(ms)}`;
}

/** `123` → `"2d 3h"` style countdown to a future instant. */
export function formatCountdown(fromMs: number, toMs: number): string {
  const diff = Math.max(0, toMs - fromMs);
  const days = Math.floor(diff / DAY_MS);
  const hours = Math.floor((diff % DAY_MS) / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

export type WeekStatus = "closed" | "open" | "future";

/** One person's slice of one week — the unit the weekly engine works in. */
export interface UserWeekModel {
  userId: string;
  /** The week's Monday, `YYYY-MM-DD`. */
  weekKey: string;
  start: number;
  end: number;
  status: WeekStatus;
  label: string;
  /** `weekly_budget` resolved at the week's Monday. */
  budgetCents: number;
  /** This person's overspend carried in — negative or zero. */
  carryInCents: number;
  /** budget + carryIn. */
  effectiveEnvelopeCents: number;
  /** Sum of THIS person's spends in the week. */
  spentCents: number;
  /** effectiveEnvelope − spent. Negative = overspent. */
  resultCents: number;
  /** Banked into the shared pot when this closed week ended. */
  earnCents: number;
  /** This person's spends in the week, newest first. */
  spends: SpendRow[];
}

export interface WeekModel {
  /** The week's Monday as an SGT calendar date, `YYYY-MM-DD`. */
  key: string;
  /** Monday 00:00:00.000 SGT, epoch ms. */
  start: number;
  /** Sunday 23:59:59.999 SGT, epoch ms. */
  end: number;
  status: WeekStatus;
  /** Calendar month containing the week's Monday, `YYYY-MM`. */
  monthKey: string;
  label: string;
  /** Rollover % that applied to this week (household setting). */
  rolloverPct: number;
  /** Per-person slices, in household order; users not yet started are absent. */
  userWeeks: UserWeekModel[];
  userWeeksById: Record<string, UserWeekModel>;
  /** Household combined figures for the week. */
  envelopeCents: number;
  spentCents: number;
  earnCents: number;
  /** Every spend bucketed into this week (any user), newest first. */
  spends: SpendRow[];
}

/** One person's whole timeline. */
export interface UserModel {
  userId: string;
  /** First Monday covered by both a settings row and this user's budget. */
  genesisWeekKey: string | null;
  /** Newest effective `weekly_budget`. */
  weeklyBudgetCents: number;
  weeks: UserWeekModel[];
  weeksByKey: Record<string, UserWeekModel>;
  currentWeek: UserWeekModel | null;
  earnedTotalCents: number;
  frozen: boolean;
  streak: number;
  longestStreak: number;
}

export interface MonthFixedOutflow {
  id: string;
  name: string;
  amountCents: number;
  billingDay: number;
  cadence: OutflowCadence;
  billingMonth: number | null;
  active: boolean;
}

export interface MonthModel {
  key: string;
  label: string;
  /** Household tracking target for the month. */
  monthlyBudgetCents: number;
  /** The outflows that actually count in this month (yearly only in theirs). */
  fixedOutflows: MonthFixedOutflow[];
  fixedTotalCents: number;
  /** Every spend whose SGT calendar month is this month, all users. */
  spentCents: number;
  spentByUser: Record<string, number>;
  /** spent + fixed — what the tracking target is measured against. */
  trackedTotalCents: number;
  /** monthlyBudget − trackedTotal. Negative = over the tracking target. */
  remainingCents: number;
  /** Mondays in the month (display only). */
  weeksInMonth: number;
  /** Weeks whose MONDAY falls in this month — the weekly engine's buckets. */
  weeks: WeekModel[];
}

export interface HouseholdModel {
  currency: string;
  nowMs: number;
  /** Household order of users (Isaac, Rachell). */
  userIds: string[];
  users: UserModel[];
  usersById: Record<string, UserModel>;
  /** Earliest genesis Monday across users, or `null` when nothing is set up. */
  genesisWeekKey: string | null;
  weeks: WeekModel[];
  weeksByKey: Record<string, WeekModel>;
  currentWeek: WeekModel | null;
  months: MonthModel[];
  monthsByKey: Record<string, MonthModel>;
  currentMonthKey: string | null;
  /** Sum of BOTH users' derived earns across closed weeks. */
  earnedTotalCents: number;
  /** Sum of `pot_ledger.amount` (redeems are negative). */
  ledgerTotalCents: number;
  /** earnedTotal + ledgerTotal. */
  potBalanceCents: number;
  /** True when ANY user is currently frozen. */
  frozen: boolean;
  frozenUserIds: string[];
  /** Household tracking target / rollover, i.e. the newest effective settings. */
  monthlyBudgetCents: number;
  rolloverPct: number;
}

/* ------------------------------------------------------------------ *
 * Engine pieces
 * ------------------------------------------------------------------ */

interface Effective {
  effective_from: string;
}

function sortByEffective<T extends Effective>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => Date.parse(a.effective_from) - Date.parse(b.effective_from),
  );
}

/** Spec § 5: the settings row with the greatest `effective_from <= ms`. */
export function settingsAt(rows: SettingsRow[], ms: number): SettingsRow | null {
  let found: SettingsRow | null = null;
  for (const row of sortByEffective(rows)) {
    if (Date.parse(row.effective_from) <= ms) found = row;
    else break;
  }
  return found;
}

/** Spec § 6: the user's budget row with the greatest `effective_from <= ms`. */
export function userBudgetAt(
  rows: UserBudgetRow[],
  userId: string,
  ms: number,
): UserBudgetRow | null {
  let found: UserBudgetRow | null = null;
  for (const row of sortByEffective(rows.filter((r) => r.user_id === userId))) {
    if (Date.parse(row.effective_from) <= ms) found = row;
    else break;
  }
  return found;
}

/** Spec § 6: `budget(u, W)` in cents — 0 when the user has no row yet. */
export function userBudgetCentsAt(
  rows: UserBudgetRow[],
  userId: string,
  ms: number,
): number {
  return parseCents(userBudgetAt(rows, userId, ms)?.weekly_budget ?? 0);
}

/**
 * Spec § 7: a fixed outflow counts in month M iff it was created before M+1
 * starts, was not deactivated before M started, and — for `yearly` rows — M is
 * its `billing_month`. `billing_day` is display-only.
 */
export function outflowsForMonth(
  rows: FixedOutflowRow[],
  monthKey: string,
): FixedOutflowRow[] {
  const monthStart = startOfMonthKey(monthKey);
  const nextMonthStart = startOfMonthKey(shiftMonthKey(monthKey, 1));
  const { month } = parseMonthKey(monthKey);
  return rows.filter((row) => {
    if (Date.parse(row.created_at) >= nextMonthStart) return false;
    if (row.deactivated_at !== null && Date.parse(row.deactivated_at) < monthStart) {
      return false;
    }
    if (row.cadence === "yearly") return row.billing_month === month;
    return true;
  });
}

/** Spec § 7: `fixedTotal(M)` in cents. */
export function fixedTotalCents(
  rows: FixedOutflowRow[],
  monthKey: string,
): number {
  return outflowsForMonth(rows, monthKey).reduce(
    (sum, row) => sum + parseCents(row.amount),
    0,
  );
}

/** Earliest `effective_from` across rows, or `null` when there are none. */
function earliestEffective<T extends Effective>(rows: T[]): number | null {
  let min: number | null = null;
  for (const row of rows) {
    const ms = Date.parse(row.effective_from);
    if (!Number.isFinite(ms)) continue;
    if (min === null || ms < min) min = ms;
  }
  return min;
}

/**
 * Spec § 8: a user's genesis Monday is the first Monday covered by BOTH a
 * settings row and one of that user's `user_budgets` rows.
 */
export function userGenesisMonday(
  settings: SettingsRow[],
  userBudgets: UserBudgetRow[],
  userId: string,
): number | null {
  const settingsFrom = earliestEffective(settings);
  const budgetFrom = earliestEffective(
    userBudgets.filter((r) => r.user_id === userId),
  );
  if (settingsFrom === null || budgetFrom === null) return null;
  return firstMondayAtOrAfter(Math.max(settingsFrom, budgetFrom));
}

/**
 * Spec § 8: the household's genesis Monday — the earliest across all users.
 * Used to bound the `spends` query.
 */
export function genesisMonday(
  settings: SettingsRow[],
  userBudgets: UserBudgetRow[],
): number | null {
  const ids = new Set(userBudgets.map((r) => r.user_id));
  let min: number | null = null;
  for (const id of ids) {
    const monday = userGenesisMonday(settings, userBudgets, id);
    if (monday === null) continue;
    if (min === null || monday < min) min = monday;
  }
  return min;
}

/* ------------------------------------------------------------------ *
 * computeModel — the whole fold
 * ------------------------------------------------------------------ */

const DEFAULT_CURRENCY = "SGD";

function resolveUserIds(rows: HouseholdRows, explicit?: string[]): string[] {
  if (explicit && explicit.length > 0) return [...explicit];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of [...rows.userBudgets].sort((a, b) =>
    a.user_id.localeCompare(b.user_id),
  )) {
    if (seen.has(row.user_id)) continue;
    seen.add(row.user_id);
    ids.push(row.user_id);
  }
  return ids;
}

export function computeModel(
  rows: HouseholdRows,
  nowMs: number = Date.now(),
  /** Household display order. Defaults to the users present in user_budgets. */
  userIdOrder?: string[],
): HouseholdModel {
  const settings = sortByEffective(rows.settings);
  const newest = settings.length > 0 ? settings[settings.length - 1] : null;
  const currency = newest?.currency ?? DEFAULT_CURRENCY;
  const userIds = resolveUserIds(rows, userIdOrder);

  const emptyUser = (userId: string): UserModel => ({
    userId,
    genesisWeekKey: null,
    weeklyBudgetCents: userBudgetCentsAt(rows.userBudgets, userId, nowMs),
    weeks: [],
    weeksByKey: {},
    currentWeek: null,
    earnedTotalCents: 0,
    frozen: false,
    streak: 0,
    longestStreak: 0,
  });

  const ledgerTotalCents = rows.potLedger.reduce(
    (sum, row) => sum + parseCents(row.amount),
    0,
  );

  const emptyModel = (): HouseholdModel => {
    const users = userIds.map(emptyUser);
    return {
      currency,
      nowMs,
      userIds,
      users,
      usersById: Object.fromEntries(users.map((u) => [u.userId, u])),
      genesisWeekKey: null,
      weeks: [],
      weeksByKey: {},
      currentWeek: null,
      months: [],
      monthsByKey: {},
      currentMonthKey: null,
      earnedTotalCents: 0,
      ledgerTotalCents,
      potBalanceCents: ledgerTotalCents,
      frozen: false,
      frozenUserIds: [],
      monthlyBudgetCents: parseCents(newest?.monthly_budget ?? 0),
      rolloverPct: newest?.rollover_pct ?? 0,
    };
  };

  /* --- 1. Per-user genesis ----------------------------------------- */
  const genesisByUser = new Map<string, number>();
  for (const userId of userIds) {
    const monday = userGenesisMonday(settings, rows.userBudgets, userId);
    if (monday !== null) genesisByUser.set(userId, monday);
  }
  if (genesisByUser.size === 0) return emptyModel();

  const genesis = Math.min(...genesisByUser.values());
  const currentMonday = mondayStart(nowMs);
  if (currentMonday < genesis) return emptyModel();

  /* --- 2. Bucket spends by week key and by calendar month ---------- */
  const spendsByWeek = new Map<string, SpendRow[]>();
  const spendsByMonth = new Map<string, SpendRow[]>();
  for (const spend of rows.spends) {
    const ms = Date.parse(spend.created_at);
    if (!Number.isFinite(ms)) continue;

    const weekKey = sgtDateKey(mondayStart(ms));
    const weekBucket = spendsByWeek.get(weekKey);
    if (weekBucket) weekBucket.push(spend);
    else spendsByWeek.set(weekKey, [spend]);

    // Spec § 12: month TRACKING buckets by plain SGT calendar month, which
    // deliberately diverges from the Monday rule at month boundaries.
    const monthKey = sgtMonthKey(ms);
    const monthBucket = spendsByMonth.get(monthKey);
    if (monthBucket) monthBucket.push(spend);
    else spendsByMonth.set(monthKey, [spend]);
  }

  /* --- 3. Enumerate weeks, chaining each person's carry separately -- */
  const newestFirst = (a: SpendRow, b: SpendRow) =>
    Date.parse(b.created_at) - Date.parse(a.created_at);

  const carryByUser = new Map<string, number>(userIds.map((id) => [id, 0]));
  const monthWeeks = new Map<string, WeekModel[]>();
  const weeks: WeekModel[] = [];

  for (let start = genesis; start <= currentMonday; start += WEEK_MS) {
    const end = start + WEEK_MS - 1;
    const key = sgtDateKey(start);
    const monthKey = sgtMonthKey(start);
    const status: WeekStatus =
      end < nowMs ? "closed" : start <= nowMs ? "open" : "future";
    const label = formatWeekRange(start, end);
    const rolloverPct = settingsAt(settings, start)?.rollover_pct ?? 0;

    const allSpends = (spendsByWeek.get(key) ?? []).slice().sort(newestFirst);

    const userWeeks: UserWeekModel[] = [];
    for (const userId of userIds) {
      const userGenesis = genesisByUser.get(userId);
      if (userGenesis === undefined || start < userGenesis) continue;

      const mine = allSpends.filter((s) => s.logged_by === userId);
      const spentCents = mine.reduce((sum, s) => sum + parseCents(s.amount), 0);
      const budgetCents = userBudgetCentsAt(rows.userBudgets, userId, start);
      const carryInCents = carryByUser.get(userId) ?? 0;
      const effectiveEnvelopeCents = budgetCents + carryInCents;
      const resultCents = effectiveEnvelopeCents - spentCents;

      userWeeks.push({
        userId,
        weekKey: key,
        start,
        end,
        status,
        label,
        budgetCents,
        carryInCents,
        effectiveEnvelopeCents,
        spentCents,
        resultCents,
        earnCents: 0,
        spends: mine,
      });

      // Spec § 9: only overspend carries, and only within one person's chain.
      carryByUser.set(userId, Math.min(0, resultCents));
    }

    const week: WeekModel = {
      key,
      start,
      end,
      status,
      monthKey,
      label,
      rolloverPct,
      userWeeks,
      userWeeksById: Object.fromEntries(userWeeks.map((u) => [u.userId, u])),
      envelopeCents: userWeeks.reduce(
        (sum, u) => sum + u.effectiveEnvelopeCents,
        0,
      ),
      spentCents: allSpends.reduce((sum, s) => sum + parseCents(s.amount), 0),
      earnCents: 0,
      spends: allSpends,
    };
    weeks.push(week);

    const bucket = monthWeeks.get(monthKey);
    if (bucket) bucket.push(week);
    else monthWeeks.set(monthKey, [week]);
  }

  /* --- 4. Per-person pot / freeze / streak fold over closed weeks --- */
  const rolloverByWeek = new Map(weeks.map((w) => [w.key, w.rolloverPct]));
  const users: UserModel[] = [];
  for (const userId of userIds) {
    const userWeeks: UserWeekModel[] = [];
    for (const week of weeks) {
      const uw = week.userWeeksById[userId];
      if (uw) userWeeks.push(uw);
    }

    let frozen = false;
    let earnedTotalCents = 0;
    let streak = 0;
    let longestStreak = 0;

    for (const uw of userWeeks) {
      if (uw.status !== "closed") continue;
      const r = uw.resultCents;
      if (r < 0) {
        frozen = true;
        streak = 0;
        uw.earnCents = 0;
      } else {
        streak += 1;
        longestStreak = Math.max(longestStreak, streak);
        if (frozen) {
          // This week THAWS this person's earning; it banks nothing.
          uw.earnCents = 0;
          frozen = false;
        } else {
          const pct = rolloverByWeek.get(uw.weekKey) ?? 0;
          uw.earnCents = roundCents((r * pct) / 100);
        }
        earnedTotalCents += uw.earnCents;
      }
    }

    const genesisMs = genesisByUser.get(userId);
    users.push({
      userId,
      genesisWeekKey: genesisMs === undefined ? null : sgtDateKey(genesisMs),
      weeklyBudgetCents: userBudgetCentsAt(rows.userBudgets, userId, nowMs),
      weeks: userWeeks,
      weeksByKey: Object.fromEntries(userWeeks.map((u) => [u.weekKey, u])),
      currentWeek: userWeeks.find((u) => u.status === "open") ?? null,
      earnedTotalCents,
      frozen,
      streak,
      longestStreak,
    });
  }

  for (const week of weeks) {
    week.earnCents = week.userWeeks.reduce((sum, u) => sum + u.earnCents, 0);
  }

  /* --- 5. Shared pot ----------------------------------------------- */
  const earnedTotalCents = users.reduce((sum, u) => sum + u.earnedTotalCents, 0);
  const potBalanceCents = earnedTotalCents + ledgerTotalCents;
  const frozenUserIds = users.filter((u) => u.frozen).map((u) => u.userId);

  /* --- 6. Month tracking (plain calendar months) -------------------- */
  const months: MonthModel[] = [];
  const firstMonthKey = sgtMonthKey(genesis);
  const lastMonthKey = sgtMonthKey(nowMs);
  for (
    let monthKey = firstMonthKey;
    monthKey <= lastMonthKey;
    monthKey = shiftMonthKey(monthKey, 1)
  ) {
    // Spec § 13: resolve the tracking target as of the END of the month, not
    // its start — a settings change made mid-month should update THAT
    // month's target immediately (the user just changed the number and
    // expects to see it reflected today), while a past month's end has
    // already happened, so a later change (always effective "now") can never
    // land on or before it and past months stay stable.
    const monthEnd = startOfMonthKey(shiftMonthKey(monthKey, 1)) - 1;
    const monthSettings =
      settingsAt(settings, monthEnd) ?? settingsAt(settings, genesis);
    const monthlyBudgetCents = parseCents(monthSettings?.monthly_budget ?? 0);

    const fixedRows = outflowsForMonth(rows.fixedOutflows, monthKey);
    const fixedCents = fixedRows.reduce(
      (sum, row) => sum + parseCents(row.amount),
      0,
    );

    const monthSpends = spendsByMonth.get(monthKey) ?? [];
    const spentCents = monthSpends.reduce(
      (sum, s) => sum + parseCents(s.amount),
      0,
    );
    const spentByUser: Record<string, number> = Object.fromEntries(
      userIds.map((id) => [id, 0]),
    );
    for (const s of monthSpends) {
      spentByUser[s.logged_by] = (spentByUser[s.logged_by] ?? 0) + parseCents(s.amount);
    }

    const trackedTotalCents = spentCents + fixedCents;

    months.push({
      key: monthKey,
      label: formatMonthLabel(monthKey),
      monthlyBudgetCents,
      fixedOutflows: fixedRows
        .map((row) => ({
          id: row.id,
          name: row.name,
          amountCents: parseCents(row.amount),
          billingDay: row.billing_day,
          cadence: row.cadence,
          billingMonth: row.billing_month,
          active: row.active,
        }))
        .sort((a, b) => a.billingDay - b.billingDay || a.name.localeCompare(b.name)),
      fixedTotalCents: fixedCents,
      spentCents,
      spentByUser,
      trackedTotalCents,
      remainingCents: monthlyBudgetCents - trackedTotalCents,
      weeksInMonth: weeksInMonth(monthKey),
      weeks: monthWeeks.get(monthKey) ?? [],
    });
  }

  const weeksByKey: Record<string, WeekModel> = {};
  for (const w of weeks) weeksByKey[w.key] = w;

  const monthsByKey: Record<string, MonthModel> = {};
  for (const m of months) monthsByKey[m.key] = m;

  return {
    currency,
    nowMs,
    userIds,
    users,
    usersById: Object.fromEntries(users.map((u) => [u.userId, u])),
    genesisWeekKey: sgtDateKey(genesis),
    weeks,
    weeksByKey,
    currentWeek: weeks.find((w) => w.status === "open") ?? null,
    months,
    monthsByKey,
    currentMonthKey: lastMonthKey,
    earnedTotalCents,
    ledgerTotalCents,
    potBalanceCents,
    frozen: frozenUserIds.length > 0,
    frozenUserIds,
    monthlyBudgetCents: parseCents(newest?.monthly_budget ?? 0),
    rolloverPct: newest?.rollover_pct ?? 0,
  };
}

/* ------------------------------------------------------------------ *
 * Small UI helpers derived from the model
 * ------------------------------------------------------------------ */

export type EnvelopeTone = "green" | "amber" | "red";

/**
 * Colour band for the giant remaining number: green above 50% of the effective
 * envelope, amber 20–50%, red below 20% (and any overspend).
 */
export function envelopeTone(
  week: Pick<UserWeekModel, "effectiveEnvelopeCents" | "resultCents">,
): EnvelopeTone {
  if (week.resultCents < 0) return "red";
  if (week.effectiveEnvelopeCents <= 0) return "red";
  const pct = week.resultCents / week.effectiveEnvelopeCents;
  if (pct > 0.5) return "green";
  if (pct >= 0.2) return "amber";
  return "red";
}

/** 0..1 fill fraction for the per-week bars (uncapped callers may clamp). */
export function spentFraction(
  week: Pick<UserWeekModel, "effectiveEnvelopeCents" | "spentCents">,
): number {
  if (week.effectiveEnvelopeCents <= 0) return week.spentCents > 0 ? 1 : 0;
  return week.spentCents / week.effectiveEnvelopeCents;
}

/**
 * Reasons a redemption is not allowed. Returns `null` when it is fine.
 * Spec § 11: block while EITHER person is frozen, and block anything that
 * would drive the shared pot below zero.
 */
export function redeemBlockReason(
  model: Pick<HouseholdModel, "frozenUserIds" | "potBalanceCents">,
  amountCents: number,
  /** Optional resolver so the message can name who is frozen. */
  nameOf?: (userId: string) => string,
): string | null {
  if (model.frozenUserIds.length > 0) {
    const who = nameOf
      ? model.frozenUserIds.map(nameOf).join(" and ")
      : "Someone";
    return `${who} went over budget, so the pot is frozen. One under-budget week each thaws it.`;
  }
  if (amountCents <= 0) return "Enter an amount to redeem.";
  if (amountCents > model.potBalanceCents) {
    return `That is more than the pot holds (${formatCents(model.potBalanceCents)}).`;
  }
  return null;
}

/** `"yearly · bills in Mar"` / `"monthly · bills on the 3rd"`. */
export function outflowCadenceLabel(
  outflow: Pick<MonthFixedOutflow, "cadence" | "billingMonth" | "billingDay">,
): string {
  if (outflow.cadence === "yearly") {
    return `yearly · bills in ${monthName(outflow.billingMonth ?? 1)}`;
  }
  return `monthly · bills on the ${ordinal(outflow.billingDay)}`;
}

/** `3` → `"3rd"`. */
export function ordinal(day: number): string {
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}
