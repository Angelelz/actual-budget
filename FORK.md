# FORK.md — Fork customizations & upstream-merge guide

This repository is a fork of [actualbudget/actual](https://github.com/actualbudget/actual).
This file is the map of everything this fork adds on top of upstream and, for
each feature, exactly where it **touches upstream files** (the "seams"). When
merging upstream, conflicts will almost always land on these seams — start here.

## Merging upstream

```bash
git remote add upstream https://github.com/actualbudget/actual.git   # once
git fetch upstream
git checkout -b merge-upstream
git merge upstream/master
# resolve conflicts (they cluster on the seams below), then:
yarn install
yarn typecheck
yarn test
```

## Migrations (read before merging — this is the one fragile seam)

loot-core checks that a budget's recorded migrations are an **exact ordered
prefix** of the code's migration list. Upstream only ever appends (higher
ids), so this works for them. A fork migration is safe **only if its id stays
above every upstream migration that a file applies before it** — otherwise an
upstream migration that sorts _below_ ours leaves a gap and every load throws
`out-of-sync-migrations`.

Rules for this fork:

1. **Keep the fork migration's id above upstream's newest.** Currently
   `1785801600000_add_schedule_auto_budget.js`. A normal "now" timestamp is
   correct; **never** use a max/far-future id (that puts _every_ future
   upstream migration below ours → guaranteed gaps).
2. **After each upstream merge**, check whether upstream added a migration with
   an id **higher** than ours:
   `ls packages/loot-core/migrations | sort | tail`. If so, rename the fork
   migration to a new id above it, update the import + `javascriptMigrations`
   map in `server/migrate/migrations.ts`, and keep it idempotent.
3. The fork migration is **idempotent** (adds the column only if missing) so it
   re-applies harmlessly to files that already have it.
4. `patchBadMigrations` (in `migrations.ts`) drops the superseded fork ids
   (`1778270218300`, `1781400000000`) from old files so they re-converge.
   Leave that in place, and append the old id there every time the fork
   migration is re-keyed.

## Design principle: keep customizations in fork-owned files behind one-line seams

Each feature's logic lives in **fork-owned files** (safe — upstream never edits
them). Upstream files are touched only at minimal **seams**: a registration
line, a union extension, or a single component/function call. Seams are tagged
in-code with a `// Fork:` (or `Fork seam:`) comment so they're greppable:

```bash
git grep -n "Fork:" -- 'packages/**'
```

Some seams are irreducible (a discriminated-union arm, a route entry, a DB
column type) — those are kept to a single line and marked, not eliminated.

---

## Feature: SimpleFIN credentials scoped per budget file

Lets each budget file hold its own SimpleFIN token/access key, with a
per-file → global fallback, and lets a non-admin budget owner manage them.

Implemented on **upstream's** per-budget-file bank sync secrets architecture
("Bank Sync Provider per budget file", #8316–#8318): secrets stored under a
`name:<cloudFileId>` composite key, the file id passed via the
`X-Actual-File-Id` header, admin-or-file-owner authorization in
`app-secrets.js`. The implementation deliberately mirrors upstream's Pluggy
wiring (`app-pluggyai/`, `PluggyAiInitialiseModal`, `usePluggyAiStatus`)
line-for-line, so if upstream later ships its own SimpleFIN per-file support,
the diff should be near-identical and easy to reconcile (or drop ours).

(The fork's pre-2026-08 custom scoping — `:file:` separator names, mandatory
per-file, `simplefin-secrets.js` seam module — was removed in the 2026-08
upstream merge in favor of this. Its sync-server migration
`1781300000000-scope-simplefin-secrets.js` is kept: already applied on
deployed servers; it only _copied_ global secrets, so the leftover
`simplefin_*:file:<id>` rows are orphaned and harmless.)

**Seams in upstream files** (all mirror the Pluggy pattern in the same file)

- `sync-server/src/app-simplefin/app-simplefin.js` — `canAccessFile`,
  `hasCredentials(fileId)`, `getCredentialSource(fileId)`; all three routes
  accept `X-Actual-File-Id` and resolve the credential scope (the claimed
  access key is written back to the scope the setup token came from)
- `sync-server/src/app-simplefin/app-simplefin.test.js` — per-file test cases
- `loot-core/src/server/accounts/app.ts` — `simpleFinStatus` /
  `simpleFinAccounts` send the header; `simpleFinBatchSync` passes
  `cloudFileId`
- `loot-core/src/server/accounts/sync.ts` — `downloadSimpleFinTransactions` /
  `simpleFinBatchSync` take an optional trailing `fileId`
- `desktop-client/src/hooks/useSimpleFinStatus.ts` — returns
  `{ simpleFinStatus, setSimpleFinStatus }` (`BankSyncProviderStatus`)
- `desktop-client/src/components/banksync/useBuiltInBankSyncProviders.ts` —
  SimpleFIN gets `supportsPerBudgetFile: true`, Pluggy-style `canConfigure`,
  scoped reset
- `desktop-client/src/components/modals/SimpleFinInitialiseModal.tsx` +
  `modals/modalsSlice.ts` — "For this budget only" toggle, scoped
  `secret-set`

---

## Feature: schedule-driven auto-income budgeting (tracking budget)

A schedule can be flagged as an "automatic budget item" tied to an income
category; its projected occurrences are summed into that category's tracking
budget each month, and the cell renders read-only.

**Fork-owned files**

- `packages/loot-core/src/server/budget/auto-income.ts` — `recomputeAutoIncomeBudgets`, `projectOccurrencesByMonth`, `getAutoManagedIncomeCategoryIds`
- `packages/loot-core/src/server/budget/auto-income.test.ts`, `auto-income-recompute.test.ts`
- `packages/desktop-client/src/components/schedules/ScheduleAutoBudgetField.tsx` — the form field
- `packages/desktop-client/src/hooks/useAutoManagedIncomeCategories.ts`
- `packages/desktop-client/src/components/settings/AutoIncomeBudgetSettings.tsx` — horizon setting
- `packages/loot-core/migrations/1785801600000_add_schedule_auto_budget.js` (idempotent — see "Migrations" below)

**Seams in upstream files**

- `loot-core/src/types/models/schedule.ts` & `server/db/types/index.ts` — `auto_budget_category` column
- `loot-core/src/server/aql/schema/index.ts` — `auto_budget_category` schedule field
- `loot-core/src/types/prefs.ts` — `autoIncomeBudgetHorizonMonths`, `autoIncomeBudgetLastTargets`
- `loot-core/src/server/schedules/app.ts` — recompute call after schedule create/update/delete + `schedule/recompute-auto-income` handler
- `loot-core/src/server/budget/app.ts` — `budget/get-auto-managed-income-categories` handler
- `desktop-client/src/components/schedules/ScheduleEditForm.tsx` & `hooks/useScheduleEdit.ts` — `auto_budget_category` reducer arm + `<ScheduleAutoBudgetField>` seam
- `desktop-client/.../schedules/ScheduleEditModal.tsx`, `mobile/schedules/MobileScheduleEditPage.tsx` — pass the field through
- `desktop-client/src/components/mobile/budget/BudgetCell.tsx` — read-only auto-managed cell

---

## Feature: long-term & carry-over budget actions (tracking budget)

Per-category and per-month budget actions: "Set as long-term" (copy a cell
forward across the horizon) and "Carry over from last month".

**Fork-owned files**

- `packages/desktop-client/src/budget/customBudgetActions.ts` — payload arms + `applyCustomBudgetAction()`
- `packages/desktop-client/src/components/budget/tracking/customBudgetMenu.ts` — menu items, select handling, callback factory
- `packages/loot-core/src/server/budget/long-term.test.ts`

**Seams in upstream files**

- `loot-core/src/server/budget/actions.ts` — `setLongTerm`, `setLongTermMonth`, `carryOverFromPrevious`, `carryOverFromPreviousMonth`
- `loot-core/src/server/budget/app.ts` — `budget/set-long-term[-month]`, `budget/carry-over-from-previous[-month]` handlers
- `desktop-client/src/budget/mutations.ts` — `| CustomBudgetActionPayload` + `applyCustomBudgetAction(payload)` dispatch seam
- `desktop-client/.../tracking/BudgetMenu.tsx` — spreads custom items + delegates custom selects
- `desktop-client/.../tracking/TrackingBudgetComponents.tsx` — spreads custom menu callbacks
- `desktop-client/.../tracking/budgetsummary/BudgetMonthMenu.tsx` & `BudgetSummary.tsx` — month-level long-term / carry-over menu items _(not yet extracted; same pattern as customBudgetMenu)_

---

## Feature: debt-projection report (tracking budget, snowball)

A forward-looking debt-payoff projection that pours each month's budget surplus
into selected accounts in priority order.

**Fork-owned files**

- `packages/loot-core/src/server/reports/debt-projection.ts` — `computeDebtProjection`, `applySnowball`
- `packages/loot-core/src/server/reports/debt-projection.test.ts`
- `packages/desktop-client/src/components/reports/reports/DebtProjection.tsx`

**Seams in upstream files**

- `loot-core/src/server/reports/app.ts` — `report/debt-projection` handler
- `desktop-client/src/components/reports/ReportRouter.tsx` — `/debt-projection` route
- `desktop-client/src/components/sidebar/PrimaryButtons.tsx` — sidebar nav entry

---

## Other customizations (not feature seams)

- `deploy/`, `sync-server.Dockerfile`, `angel-deploy-instructions.md` — self-hosting stack (compose, Authentik, cloudflared). Fork-only; never conflicts.
- `packages/component-library/src/Themes/*.css` — custom CSS theme overrides.
- `packages/desktop-client/src/components/settings/index.tsx` — registers `AutoIncomeBudgetSettings`.
