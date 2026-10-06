# PRD: Household Budget (working name: "Tally")

## 1. What this is

A dead-simple household expenditure tracker for 2 users, Isaac and Partner, in Singapore (SGD). One shared household budget. The only daily action is logging a spend in under 5 seconds. Everything else (subscriptions, budget maths, reward/punish logic) is automatic.

This is explicitly NOT a full personal finance manager. Reference points: take the envelope-budget idea from Actual Budget (github.com/actualbudget/actual) but strip it to 1 envelope per week; take nothing else. No bank sync, no double-entry, no net worth.

## 2. Users

1. 2 fixed users: Isaac and Partner. No sign-up flow. Seed both accounts.
2. Auth: Supabase email magic link, or a simpler shared household PIN with a user toggle (Isaac / Partner) on the log screen. Builder may choose whichever is simpler, but each logged spend must record who logged it.
3. Both users see the same household data. There is no private data.

## 3. Core concepts

1. Monthly budget: 1 number set by the users, e.g. $4,000. Editable in settings.
2. Fixed outflows (subscriptions and defaults): recurring items (Netflix, insurance, phone bills etc) with a name, amount and billing day. On their billing day each month they are auto-deducted from the monthly budget. No user action needed. CRUD screen in settings.
3. Weekly envelope: (monthly budget minus total fixed outflows) divided by the number of weeks in the month. This is the number that matters day to day. Weeks run Monday to Sunday.
4. Spend log: the core action. Amount, optional 1-line note, auto date-time, auto logged-by. Nothing else. No categories, no payment method, no receipt. Friction is the enemy.
5. Rollover: unspent weekly envelope rolls into a household Reward Pot. Overspend is deducted from next week's envelope.

## 4. Reward / punish system

1. Reward Pot: every week that closes under budget, the surplus (or a capped portion, default 50%, configurable) goes into the Reward Pot. The pot is money the household is allowed to blow guilt-free on anything.
2. Streak: consecutive under-budget weeks shown as a flame count on the dashboard.
3. Punishment: an over-budget week (a) breaks the streak, (b) deducts the overage from next week's envelope and (c) freezes the Reward Pot (cannot be spent) until 1 full week closes under budget again.
4. Spending the pot: a "Redeem" button logs a pot withdrawal with a note (e.g. "omakase"). Redemptions do not count against the weekly envelope.

## 5. Screens (4 total)

1. Home / Log: giant number = this week's remaining envelope, colour-coded (green > 50%, amber 20 to 50%, red < 20%). Below it a numpad-first quick-log form (amount, optional note, user toggle if using PIN auth). Below that, this week's last 10 spends with delete/edit. Reward Pot balance and streak flame in the header.
2. Month view: monthly budget, fixed outflows already deducted, per-week bars (under/over), month-to-date total.
3. History: simple list by week, tap a week to see its spends. Each spend shows who logged it.
4. Settings: monthly budget, fixed outflows CRUD, rollover % to pot, currency (default SGD).

## 6. Data model (Supabase Postgres)

1. `users` (id, name) - seeded with Isaac and Partner.
2. `settings` (monthly_budget, rollover_pct, currency) - single row.
3. `fixed_outflows` (id, name, amount, billing_day, active).
4. `spends` (id, amount, note, logged_by, created_at).
5. `weeks` (id, start_date, envelope_amount, total_spent, status: open/closed_under/closed_over) - computed weekly by a scheduled job or computed on read; computed-on-read is acceptable and simpler.
6. `pot_ledger` (id, amount, type: earn/redeem/freeze_event, note, created_at).

## 7. Stack and deployment

1. Next.js 14 (App Router) + Tailwind. Mobile-first layout, this will be used 95% on phones.
2. Supabase for DB and auth. Vercel for hosting.
3. PWA: manifest.json + service worker so it installs to the home screen like a native app.

## 8. Branding

1. App name shown as "Tally" (or builder proposes 1 better single-word name).
2. Generate a real app icon and favicon: a simple flat geometric mark (e.g. 2 overlapping coins or a tally-mark glyph) on a solid deep-green background. Provide 512, 192 and 32 px PNGs plus favicon.ico, wired into the PWA manifest and HTML head. Do not ship the default Next.js favicon.
3. Visual style: clean, big type, lots of whitespace. Simple is fine, ugly is not.

## 9. Non-goals

1. No bank or card integration.
2. No spend categories.
3. No income tracking.
4. No multi-currency.
5. No notifications in v1 (nice-to-have later: a Sunday-night week-close summary).

## 10. Acceptance checklist

1. Isaac can log a $12 lunch in under 5 seconds from a cold phone open.
2. Fixed outflows auto-deduct on billing day without any tap.
3. Week closes Sunday 23:59 SGT, streak and pot update correctly.
4. Overspend week freezes the pot and deducts from the next envelope.
5. Both users see identical data in real time (Supabase realtime or refetch on focus).
6. Installs to iOS home screen with the custom icon.
