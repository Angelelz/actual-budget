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

## Feature: SimpleFIN credentials scoped per budget file (sync-server)

Lets each budget file hold its own SimpleFIN token/access key, and lets a
non-admin budget owner manage them (instead of admin-only global secrets).

**Fork-owned files**

- `packages/sync-server/src/services/simplefin-secrets.js` — `authorizeSimpleFinSecret()` + `isSimpleFinSecret` re-export
- `packages/sync-server/src/services/simplefin-secrets.test.js`
- `packages/sync-server/migrations/1781300000000-scope-simplefin-secrets.js`

**Seams in upstream files**

- `src/services/secrets-service.js` — `getScopedSecretName`, `isSimpleFinSecret`, `ScopedSecretSeparator`
- `src/app-secrets.js` — POST handler branches to `authorizeSimpleFinSecret()`
- `src/app-simplefin/app-simplefin.js` — `getAuthorizedFileId`, `getSimpleFinSecretName` (scoped reads/writes)
- `loot-core/src/server/accounts/app.ts` & `accounts/sync.ts` — pass the cloud `fileId` when setting/reading SimpleFIN secrets

> Upstream also actively changes SimpleFIN (SSRF protection, credential-reset,
> permission hardening). Reconcile carefully so security fixes are kept **and**
> scoping is preserved.

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
- `packages/loot-core/migrations/1778270218300_add_schedule_auto_budget.sql`

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
