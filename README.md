# Tally

A dead-simple household budget tracker for two (Isaac & Rachell, Singapore, SGD).
One shared monthly budget, one envelope per week, a reward pot for weeks that
close under budget. Next.js App Router + Tailwind + Supabase, installable as a PWA.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
```

## Environment

`.env.local` holds two public values:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key |

There is no PIN or login. On first visit the app asks "Who's this?" — one tap
on Isaac or Rachell picks an identity, stored as a flag in `localStorage`, and
you're straight into the app. Returning visits skip the chooser entirely; the
Isaac/Rachell toggle on Home switches identity anytime, and Settings has a
"Switch to …" button that does the same. RLS is deliberately permissive for
anon (see `docs/engine-spec.md`), which is an accepted tradeoff for a
two-person app with no security boundary to speak of.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build (type-checks too) |
| `npm test` | Engine unit tests (`node --test` via `tsx`) |
| `npm run lint` | ESLint |

## How it fits together

Nothing is computed server-side. The app reads four tables and folds them into a
model in the browser.

```
src/lib/engine.ts        Pure engine — weeks, envelopes, carry-in, pot, freeze,
                         streak. Integer cents, Asia/Singapore (fixed UTC+8)
                         date maths, zero dependencies. Mirrors docs/engine-spec.md.
src/lib/engine.test.ts   Unit tests for the above.
src/lib/useHousehold.ts  Fetches settings / fixed_outflows / spends / pot_ledger,
                         folds them through the engine, exposes write helpers.
                         Supabase realtime + refetch on focus keep both phones in sync.
src/lib/session.ts       Which user is logging, incl. the first-visit pick (localStorage).
src/lib/supabase.ts      Browser Supabase client.
src/components/          Screens and UI. Tailwind only, no UI libraries.
```

`docs/engine-spec.md` is the contract for all budget maths — read it before
touching `engine.ts`.

## Writes are append-only by design

- Changing the budget or rollover % **inserts** a new effective-dated `settings`
  row; past weeks keep the envelope they were budgeted with.
- Removing a fixed outflow **soft-deletes** it; editing one deactivates it and
  inserts a replacement, so past months stay accurate.
- Pot earnings are derived, never stored. Only redemptions and adjustments are
  written to `pot_ledger`, as signed deltas.
