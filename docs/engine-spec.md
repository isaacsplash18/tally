# Tally budget engine — computation spec

Source of truth for how personal weekly envelopes, the shared Reward Pot, freeze state,
streaks and monthly tracking are computed. The Supabase schema derives NOTHING server-side:
the app computes everything on read from `settings` + `user_budgets` + `fixed_outflows` +
`spends` + `pot_ledger`. The TypeScript engine (`src/lib/engine.ts`) must mirror this spec
exactly.

Supabase project: `toeimgwqcewifahwunyd` (ap-southeast-1).

## The shape of the product

Each person sets their **own weekly budget** as a plain number. Nothing is divided out of a
monthly figure. The weekly engine runs **independently per person**: own envelope, own
overspend debt chain, own streak, own freeze flag. Only the **Reward Pot is shared** — both
people's earnings flow into it, and a redemption is blocked while *either* person is frozen.

The household `monthly_budget` is a **tracking target only**. It measures spends + fixed
outflows for a calendar month and feeds nothing else.

## Write rules

1. `settings` is append-only and effective-dated. Never UPDATE/DELETE a settings row.
   Changing the tracking target or rollover % = INSERT a new row with
   `effective_from = now()`. A week resolves its settings by its own Monday, so a change
   today never rewrites a past week.
2. `user_budgets` is append-only and effective-dated **per user**, exactly like `settings`.
   Changing Isaac's weekly budget = INSERT `{user_id: isaac, weekly_budget, effective_from:
   now()}`. Never UPDATE. A week resolves each person's budget by that week's Monday.
3. `fixed_outflows` is soft-deleted. Removing a bill = `active=false, deactivated_at=now()`.
   Editing `amount`/`name`/`cadence` in place retroactively changes past months — the app
   always deactivates + inserts a replacement row.
4. `pot_ledger.amount` is a SIGNED delta on the pot balance. A $50 redemption is inserted as
   `amount = -50.00, type='redeem'` (UI collects a positive number and negates it). `adjust`
   may be either sign. Earns are NEVER inserted — they are derived.

## Tables

- `users` (id uuid pk, name, created_at) — seeded:
  - Isaac: `11111111-1111-4111-8111-111111111111`
  - Rachell: `22222222-2222-4222-8222-222222222222`
  (deterministic UUIDs — safe to hardcode in the frontend)
- `settings` (id, monthly_budget numeric(10,2), rollover_pct int 0..100, currency,
  effective_from timestamptz unique, created_at) — seeded: 4000.00 / 50 / SGD /
  effective_from 2026-08-01T00:00+08. `monthly_budget` is a tracking target only;
  `rollover_pct` is a single household setting that applies to both people.
- `user_budgets` (id, user_id uuid → users, weekly_budget numeric(10,2) >= 0,
  effective_from timestamptz, created_at; unique (user_id, effective_from)) — seeded:
  both users at 350.00 effective 2026-08-01T00:00+08.
- `fixed_outflows` (id, name, amount numeric(10,2), billing_day int 1..28,
  cadence text in ('monthly','yearly') default 'monthly', billing_month int 1..12 null,
  active bool, created_at, deactivated_at; checks: active XOR deactivated_at not null;
  yearly rows must have `billing_month`, monthly rows must have it null) — seeded (all
  `monthly`, total 344.98): Netflix 19.98 day 3 · Transit 120.00 day 5 · Phone 25.00 day 12 ·
  Insurance 180.00 day 15.
- `spends` (id, amount numeric(10,2) > 0, note, logged_by uuid → users, created_at
  timestamptz). `created_at` is the bucketing key and is editable (back-dating re-buckets).
  `logged_by` decides WHOSE envelope the spend comes out of.
- `pot_ledger` (id, amount numeric(10,2) <> 0 signed, type in ('redeem','adjust'), note,
  logged_by uuid null, created_at; redeem rows must be negative).

RLS: enabled on all tables with permissive anon FOR ALL policies — the household PIN is a UX
gate, not a security boundary (deliberate tradeoff for a 2-person app).

Realtime: `spends`, `settings`, `user_budgets`, `fixed_outflows`, `pot_ledger` are in the
`supabase_realtime` publication with REPLICA IDENTITY FULL (UPDATE/DELETE events carry the
old row). `users` excluded.

## Computation spec

All wall-clock reasoning is in **Asia/Singapore (UTC+8, no DST)**. Convert every
`timestamptz` to SGT before bucketing.

**0. Money arithmetic.** All math in integer cents. Parse `numeric` strings with
`Math.round(parseFloat(x) * 100)`. Round half-away-from-zero:
`roundCents(x) = Math.sign(x) * Math.round(Math.abs(x))`. Never accumulate floats.

**1. Week boundaries.** A week runs Monday 00:00:00.000 SGT → Sunday 23:59:59.999 SGT. Week
key = its Monday's SGT calendar date (`YYYY-MM-DD`).

**2. Month of a week.** For the weekly engine, a week belongs to the calendar month
containing its **Monday**. (Mon 2026-08-31 → Sun 2026-09-06 is an August week.) This governs
which weeks the Month screen lists as bars.

**3. Month of a spend (tracking).** For month TRACKING, a spend belongs to its own SGT
**calendar month** — not its week's month. A spend on Wed 2026-09-02 sits in the Aug-31
*week* but counts in *September's* tracking. This divergence is deliberate: the Monday rule
is right for envelopes, the calendar month is right for "did we hit our monthly number".

**4. Weeks in a month.** `weeksInMonth(M)` = number of Mondays in calendar month M (4 or 5).
Display only — it no longer divides anything.

**5. Settings for a week.** The `settings` row with the greatest `effective_from <= W.start`.
Only `rollover_pct` is read per week; `monthly_budget` is read per month.

**6. Budget for a person-week.**
```
budget(u, W) = weekly_budget of the user_budgets row for u with the greatest
               effective_from <= W.start        (0 if u has no row yet)
```

**7. Fixed outflows for a month.** A row counts in month M iff
`created_at < startOfMonth(M+1)` AND (`deactivated_at IS NULL` OR
`deactivated_at >= startOfMonth(M)`) AND:
- `cadence = 'monthly'` → it counts its amount in **every** such month;
- `cadence = 'yearly'` → it counts its **full** amount only when `M.month = billing_month`,
  and nothing in any other month.

`fixedTotal(M)` = sum of those amounts. `billing_day` is display-only. Fixed outflows affect
the monthly tracking view only — they never touch a weekly envelope.

**8. Genesis.** A user's `genesisMonday(u)` is the first Monday at or after
`max(earliest settings.effective_from, earliest user_budgets.effective_from for u)` — i.e.
the first Monday covered by BOTH a settings row and one of that user's budget rows. With the
seed, Mon 2026-08-03 for both. The household genesis is the earliest across users. Weeks are
enumerated as consecutive Mondays from the household genesis through the current SGT week's
Monday; a user only appears in weeks at/after their own genesis. Spends before a user's
genesis are outside that user's engine.

**9. Per-person carry-in (overspend only).** For EACH user independently, process that
user's weeks chronologically from their genesis:
```
carryIn(u, genesisWeek) = 0
carryIn(u, W_next)      = min(0, result(u, W))     // negative or zero, never positive
effectiveEnvelope(u, W) = budget(u, W) + carryIn(u, W)
spend(u, W)             = sum of u's spends bucketed into W  (spends.logged_by = u)
result(u, W)            = effectiveEnvelope(u, W) − spend(u, W)
```
One person's overspend carries forward as *their* debt only; the other person's envelope is
untouched. Surplus does NOT carry (it goes to the pot). Carry chains across month boundaries
and across multiple weeks.

**10. Week status.** `W.end < now` → closed; `W.start <= now <= W.end` → open (current);
else future. Only closed weeks affect the pot and streaks. The open week shows a live
`result(u, W)` but banks nothing.

**11. Per-person pot / freeze / streak state machine.** For EACH user independently, fold
over that user's closed weeks chronologically:
```
frozen(u) = false; earned(u) = 0; streak(u) = 0; longestStreak(u) = 0
for W of closedWeeks(u):
  r = result(u, W)
  if r < 0:
    frozen(u) = true; streak(u) = 0; earn(u, W) = 0
  else:
    streak(u) += 1; longestStreak(u) = max(longestStreak(u), streak(u))
    if frozen(u):
      earn(u, W) = 0            // this week THAWS u's earning; it does not pay out
      frozen(u) = false
    else:
      earn(u, W) = roundCents(r * settingsFor(W).rollover_pct / 100)
    earned(u) += earn(u, W)
```
An overspent week freezes THAT person's earning; their next under-budget closed week is
spent thawing (counts toward their streak, earns nothing); earning resumes the week after.
`rollover_pct` is the household setting resolved at the week's own Monday.

**12. Shared pot balance.**
```
earnedTotal = Σ over all users of earned(u)
potBalance  = earnedTotal + SUM(pot_ledger.amount)      // redeems are negative
```
Block a redemption if **any** user is currently frozen, or if it would drive the balance
below zero, or if the amount is not positive.

**13. Monthly tracking.** For each calendar month M from the genesis month through the
current SGT month:
```
monthlyBudget(M) = settings row with greatest effective_from <= endOfMonth(M)
                    (endOfMonth(M) = startOfMonth(M+1) − 1ms), falling back to
                    the settings row at genesis if none qualifies
spent(M)         = sum of ALL users' spends whose SGT calendar month is M   (§ 3)
tracked(M)       = spent(M) + fixedTotal(M)                                 (§ 7)
remaining(M)     = monthlyBudget(M) − tracked(M)                            // may go negative
```
`monthlyBudget(M)` resolves at the END of the month, not its start. A tracking target is a
scoreboard the user is looking at *right now*; when they change it mid-month they expect the
current month's number to move immediately, not next month's. Because `settings` rows are
always inserted with `effective_from = now()`, a row can only ever affect the current month —
resolving against `endOfMonth(M)` for a past month M is equivalent to resolving at
`startOfMonth(M)` (nothing new can be inserted with `effective_from` in the past), so past
months stay exactly as stable as before. `rollover_pct` is unaffected by this — it stays
resolved per week at that week's own Monday (§ 5), because it governs the pot/freeze money
math and must not move once a week has started.

This is a scoreboard only — nothing here feeds §§ 6–12.

**14. Current streak.** As left by step 11, per person. The Home screen shows the ACTIVE
user's streak; the header pot chip names whoever is frozen.

**15. Week close.** Nothing is written at Sunday 23:59 — the next read simply finds one more
closed week. The UI shows a countdown to `W.end`.

## Data access

The whole engine needs exactly five queries: all `settings`, all `user_budgets`, all
`fixed_outflows`, `spends` since the start of the genesis **month** (month tracking buckets
by calendar month, so the lower bound is a month start rather than the genesis Monday), and
all `pot_ledger`. Fetch all five in full and fold in memory.

Writes:
- Personal weekly budget change → INSERT a new `user_budgets` row for that user.
- Tracking target / rollover change → INSERT a new `settings` row.
- Remove fixed outflow → `set active=false, deactivated_at=now()`.
  Edit → deactivate + INSERT the replacement.
- Redeem → insert `{amount: -X, type:'redeem', note, logged_by}` into `pot_ledger`.
