# Angel — Self-hosted Actual Budget deploy guide

Personal step-by-step record of everything we did to fork, deploy, and customize Actual Budget for household use behind Cloudflare Tunnel + Authentik OIDC. Includes every issue hit and the fix.

---

## Final architecture

```
                Internet
                   │
            Cloudflare Tunnel (cloudflared)
                   │
       ┌───────────┴──────────────┐
       │                          │
  auth.example.com         actual.example.com
   (port 9000)                 (port 5006)
       │                          │
  authentik-server          actual-server
       │                          │
  authentik-worker            (SQLite on disk)
       │
  postgresql + redis
```

Five containers on the dev server, all bound to `127.0.0.1` (no firewall exposure). Cloudflared terminates TLS and forwards plain HTTP locally. Authentik is the OIDC provider; Actual delegates auth to it. Family members log in via Authentik (with Google federation enabled).

---

## Phase 1 — Fork & local verification

### 1.1. Fork upstream

- GitHub: forked `actualbudget/actual` → `<your-fork>/actual-budget` (public).
- Cloned locally to `~/code/actual-budget`.
- Disabled push to `upstream` remote (set push URL to `DISABLE`).

### 1.2. Install + verify build

```bash
cd ~/code/actual-budget
yarn install
yarn start    # Vite dev server on http://localhost:3001
```

Browser: clicked "Don't use a server" → "View demo" → confirmed UI works with sample data.

Hit a console warning about `<button>` nested in `<button>` — upstream React hydration noise, cosmetic only. Ignored.

### 1.3. Decide architecture

- Stack: **Actual sync-server + Authentik (OIDC) + cloudflared**.
- Rationale:
  - Multi-user support in Actual requires OIDC (verified in `packages/sync-server/migrations/1719409568000-multiuser.js` and `src/app-sync.ts:75-85`).
  - Authentik provides OIDC, supports Google federation, passkeys, etc.
  - Cloudflare Tunnel avoids opening any inbound ports.
  - Build from source later when adding the credit-card payoff feature; for now, use the upstream `actualbudget/actual-server:latest` image.

---

## Phase 2 — Deploy files

Created three files under `deploy/` in the fork:

### 2.1. `deploy/docker-compose.yml`

Five services:

| Service            | Image                                         | Port (host)      |
| ------------------ | --------------------------------------------- | ---------------- |
| `postgresql`       | `postgres:16-alpine`                          | (internal)       |
| `redis`            | `redis:alpine`                                | (internal)       |
| `authentik-server` | `ghcr.io/goauthentik/server:${AUTHENTIK_TAG}` | `127.0.0.1:9000` |
| `authentik-worker` | `ghcr.io/goauthentik/server:${AUTHENTIK_TAG}` | (no port)        |
| `actual-server`    | `actualbudget/actual-server:latest`           | `127.0.0.1:5006` |

Volumes under `./data/` — gitignored. All Authentik env vars resolved from `${PG_USER}`, `${PG_PASS}`, `${AUTHENTIK_SECRET_KEY}` etc.

Important env vars on `actual-server`:

- `ACTUAL_LOGIN_METHOD=openid`
- `ACTUAL_OPENID_DISCOVERY_URL`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_SERVER_HOSTNAME`
- `ACTUAL_TRUSTED_PROXIES=127.0.0.1/32,::1/128` (cloudflared only)

### 2.2. `deploy/.env.example`

Committed placeholder values + comments showing how to generate secrets:

- `openssl rand -base64 36` for `PG_PASS`
- `openssl rand -base64 60 | tr -d '\n'` for `AUTHENTIK_SECRET_KEY`

### 2.3. `deploy/.gitignore`

```
.env
data/
```

### 2.4. Committed + pushed

Commit message must be `[AI]`-prefixed (project rule):

```
[AI] Add self-hosting deploy stack (Actual + Authentik + cloudflared)
```

Pushed to `origin/master` on the fork.

---

## Phase 3 — Server deploy

Server: Ubuntu 24.04 with Docker 28.2 already installed. Accessed via `ssh user@server` alias.

### 3.1. Clone the fork on the server

```bash
ssh user@server
cd ~/code
git clone git@github.com:<your-fork>/actual-budget.git
cd actual-budget/deploy
cp .env.example .env
# Generated secrets, filled in PG_PASS and AUTHENTIK_SECRET_KEY
# Left ACTUAL_OPENID_* placeholders for now
```

### 3.2. Bootstrap Authentik first

Actual can't start without OIDC config, so bring up the Authentik stack first:

```bash
docker compose up -d postgresql redis authentik-server authentik-worker
docker compose logs -f authentik-worker
# wait for "Booting worker" + "Finished blueprint import" (~60s)
```

### 3.3. Cloudflared tunnel — public hostnames

In Cloudflare Zero Trust dashboard:

- `auth.example.com` → `http://localhost:9000`
- `actual.example.com` → `http://localhost:5006`

(Existing tunnel was already running for other services.)

---

## Phase 4 — Authentik first-time setup

### 4.1. Initial admin

Visited `https://auth.example.com/if/flow/initial-setup/` (trailing slash matters) → created `akadmin` / set password / Authentik admin UI loaded.

### 4.2. ⚠️ Issue: "The request failed and the interceptors did not return an alternative response"

**Symptom**: error toast on first page load.

**Diagnosis**: checked logs — everything was healthy, requests returning 200. Not a real error; transient.

**Fix**: hard-refresh browser (or use incognito tab). Often a stale service-worker error from a request that raced container startup. Confirmed both endpoints return 200 from the server side:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: auth.example.com' -H 'X-Forwarded-Proto: https' \
  http://localhost:9000/if/flow/initial-setup/
```

### 4.3. Create OAuth2/OpenID provider for Actual

Authentik admin → **Applications → Providers → Create → OAuth2/OpenID Provider**:

- Redirect URI: `https://actual.example.com/openid/callback`
- Signing key: default self-signed cert
- Saved → copied **Client ID** and **Client Secret**

Then **Applications → Create**:

- Slug: **`actual`** (must match the slug in `ACTUAL_OPENID_DISCOVERY_URL`)
- Bound to the provider above

### 4.4. Update `.env` and start actual-server

Filled in the OIDC env vars in `deploy/.env`:

- `ACTUAL_OPENID_SERVER_HOSTNAME=https://actual.example.com`
- `ACTUAL_OPENID_DISCOVERY_URL=https://auth.example.com/application/o/actual/.well-known/openid-configuration`
- `ACTUAL_OPENID_CLIENT_ID=...`
- `ACTUAL_OPENID_CLIENT_SECRET=...`

Then:

```bash
docker compose up -d actual-server
```

### 4.5. ⚠️ Issue: `openid-grant-failed` with `invalid_client`

**Symptom** on first OIDC login attempt:

```
{"status":"error","reason":"openid-grant-failed"}

actual-server logs:
OPError: invalid_client (Client authentication failed ...)
```

**Diagnosis**: Authentik had returned the auth code (so client_id was correct), but rejected the token-exchange step. Almost always a `client_secret` issue.

Checked the secret length on the server (without printing the value):

```bash
awk -F= '/^ACTUAL_OPENID_CLIENT_SECRET=/{print length(substr($0, length($1)+2))}' .env
# → 127
```

**Root cause**: Authentik generates **128-character** client secrets by default. The copy-paste had silently dropped one character.

**Fix**:

1. Authentik admin → Provider → eye icon to reveal Client Secret → copy button (don't manual-select)
2. Pasted into `.env` (replacing the bad one)
3. `docker compose up -d actual-server`

OIDC login worked. The first user to log in via OIDC becomes the admin automatically.

---

## Phase 5 — Adding family members

### 5.1. Adding wife (Authentik user)

Authentik admin → **Directory → Users → Create** → username `<spouse-username>`, display name `<spouse>`, set password. Inviting via Directory → Invitations also works if you don't want to set a password yourself.

### 5.2. ⚠️ Issue: Wife's first login → `openid-grant-failed`

**Symptom**: she enters credentials successfully, gets redirected back to Actual, sees `openid-grant-failed`. Authentik logs showed token + userinfo both 200 OK. Failure is on Actual's side.

**Diagnosis**: looked at `packages/sync-server/src/accounts/openid.js:282`:

```js
if (userIdFromDb == null) {
  throw new Error("openid-grant-failed");
}
```

This fires when the OIDC identity (her Authentik username) doesn't match any existing user_name in Actual's `users` table. The default config (`ACTUAL_USER_CREATION_MODE=manual`, see `packages/sync-server/src/load-config.js:274`) requires admins to **pre-create** users in Actual's own admin UI before they can log in.

**Fix options**:

- **A**: Set `ACTUAL_USER_CREATION_MODE=login` → auto-provisions any Authentik-authenticated user. Trust boundary becomes Authentik.
- **B**: Pre-create the user in Actual's admin UI with `user_name` matching what Authentik sends as `preferred_username`.

Chose **B** for stricter control. Logged into `actual.example.com/admin` → **Users** → **Add user** → user_name = `<spouse-username>` (matches Authentik exactly). Her next login worked.

---

## Phase 6 — Adding Google sign-in to Authentik

### 6.1. Google Cloud Console

1. Console → new project `authentik-sso`
2. **APIs & Services → OAuth consent screen** (External) — added test users (mine + wife's emails)
3. **Credentials → Create OAuth Client ID** (Web app)
   - Authorized redirect URI: `https://auth.example.com/source/oauth/callback/google/` (trailing slash, slug must match)
4. Copied Client ID + Secret

### 6.2. Authentik source

Admin → **Directory → Federation & Social login → Create → Google OAuth Source**:

- Name: `Google`
- Slug: `google` (matches redirect URI)
- **User matching mode**: `Link to a user with identical email address` ← important
- Consumer key/secret: from Google
- Authentication flow: `default-source-authentication`
- Enrollment flow: `default-source-enrollment`

### 6.3. ⚠️ Issue: "Sign in with Google" button doesn't appear on login page

**Diagnosis**: Authentik doesn't auto-attach sources to the login flow. They have to be added to the **identification stage**.

**Fix**:

- Admin → **Flows and Stages → Stages**
- Find `default-authentication-identification` (Identification Stage) → Edit
- Scroll to **Sources** field → multi-select → add `Google`
- Save → hard-refresh → Google button appears

---

## Phase 7 — Categories & rules import

Used `@actual-app/api` directly. All scripts live in `~/code/actual-tools/import-categories/` (sibling to the fork, with its own `package.json` and `node_modules`).

### 7.1. Setting up an Actual API password

The API requires `password` auth. With OIDC-only login, no password was ever set.

**Fix**: ran `bootstrapPassword` directly inside the `actual-server` container (the web UI's `/change-password` endpoint requires an existing password — chicken-and-egg):

```bash
read -rs -p "New Actual server password: " NEWPW && echo
docker compose exec -T -e NEWPW="$NEWPW" actual-server node -e '
  import("./src/accounts/password.js").then(({ bootstrapPassword }) => {
    const { error } = bootstrapPassword(process.env.NEWPW);
    if (error) { console.error("error:", error); process.exit(1); }
    console.log("server password set");
  });
'
unset NEWPW
```

### 7.2. ⚠️ Issue: Phone OIDC login → "Invalid redirect URL"

**Symptom**: after setting the password, fresh OIDC login from phone failed with `Invalid redirect URL` — but desktop session kept working.

**Diagnosis**: traced to `packages/sync-server/src/accounts/openid.js:349-369` — `isValidRedirectUrl` calls `getServerHostname()` which queries:

```sql
SELECT * FROM auth WHERE method = 'openid' AND active = 1
```

`bootstrapPassword` runs `UPDATE auth SET active = 0` to deactivate other methods before inserting the password row. That flipped the OpenID row's `active` to 0, breaking redirect-URL validation. Desktop kept working because it had a valid session cookie; phone was a fresh login.

**Fix**:

```bash
docker compose exec -T actual-server node -e "
import('./src/account-db.js').then(m => {
  const db = m.getAccountDb();
  db.mutate('UPDATE auth SET active = 1 WHERE method = ?', ['openid']);
});
"
```

**Lesson**: any future password reset will repeat this. Add to mental checklist.

### 7.3. ⚠️ Issue: After Google login → `openid-grant-failed` for myself

**Symptom**: my own Google sign-in failed. Wife's worked manually but mine started failing.

**Diagnosis**: my Actual user_name was `akadmin` (from Authentik's initial setup). When I added Google to Authentik, "Link on email" couldn't find an existing Authentik user with my Gmail (because `akadmin`'s email field wasn't set to my Gmail), so Authentik **created a new user `<your-username>`**. Authentik logs showed:

```
"user": {"email": "you@example.com", "pk": 4, "username": "<your-username>"}
```

Actual didn't have an `<your-username>` user → grant failed.

**Fix**: renamed the existing Actual user (preserves user ID and file ownership):

```bash
docker compose exec -T actual-server node -e "
import('./src/account-db.js').then(m => {
  m.getAccountDb().mutate('UPDATE users SET user_name = ? WHERE user_name = ?', ['<your-username>', 'akadmin']);
});
"
```

**Cleanup recommended**: in Authentik, delete the now-stale `akadmin` user and confirm `<your-username>`'s email is set to `you@example.com` so future Google logins from new devices link cleanly.

### 7.4. CSV → categories import

Source CSV: `~/Downloads/budget-categories.csv` — 77 categories across 16 groups.

Tooling: `~/code/actual-tools/import-categories/import.mjs` (uses `@actual-app/api`, `csv-parse`).

Ran from laptop:

```bash
cd ~/code/actual-tools/import-categories
read -rs "ACTUAL_PASSWORD?Actual server password: " && echo
ACTUAL_SERVER_URL=https://actual.example.com \
ACTUAL_SYNC_ID=<YOUR_SYNC_ID> \
ACTUAL_PASSWORD="$ACTUAL_PASSWORD" \
node import.mjs ~/Downloads/budget-categories.csv
unset ACTUAL_PASSWORD
```

Idempotent — existing groups/categories are detected and skipped on re-run. Notes from the CSV are stored via the internal `notes-save` handler.

> **zsh gotcha**: bash-style `read -p` doesn't work in zsh. Use `read -rs "VAR?Prompt: "` instead.

### 7.5. Auto-categorization rules

Source CSV: `~/Downloads/All-Accounts.csv` — 338 transactions.

#### First attempt (broken)

`create-rules.mjs` v1 used `field: 'payee', op: 'contains'`. **Result**: rules ran correctly at runtime (verified via the AQL `payee.name LIKE` logic at `packages/loot-core/src/server/transactions/transaction-rules.ts:588-595`), but **the UI showed "(deleted)"** in every condition.

**Diagnosis**: `packages/desktop-client/src/components/rules/Value.tsx:120-134` always tries to resolve the value as a payee entity ID for `field: 'payee'`, regardless of the condition's `type` field. Pattern strings have no UUID match → "(deleted)".

#### Working approach (`rebuild-and-apply-rules.mjs`)

1. **Delete** the broken contains/matches rules.
2. **Look up payee UUIDs** by case-insensitive substring match on each pattern.
3. **Create** consolidated rules: `field: 'payee', op: 'oneOf', value: <[uuids]>` — one rule per category.
4. **Apply** rules to all existing uncategorized transactions by iterating accounts → `getTransactions` → `internal.send('rules-run', {transaction})` → `updateTransaction` if category changed.

Renders cleanly in the UI (shows real payee names) and works on future imports because Actual links new same-name imports to existing payee entities.

> **Trade-off documented**: this single-stage approach (`payee oneOf → category`) misses brand-new payee strings that Actual creates as fresh entities. The "proper" two-stage Actual pattern is `imported_payee contains → set payee` (pre stage) followed by `payee is → set category` (post stage). For SimpleFIN's clean naming, single-stage is fine; revisit if specific payees keep slipping through.

### 7.6. ⚠️ Issue: BofA internal transfers double-imported

**Symptom**: every internal Checking ↔ Savings transfer appeared as **4 transactions** (2 in each account). Same date, same amount, same confirmation #.

**Diagnosis**: BofA's API (via SimpleFIN) returns both perspectives of internal transfers from each account's feed. SimpleFIN passes everything through; Actual doesn't dedupe.

Pattern: for any transfer between accounts X and Y:

- In account X: notes mentioning X (this account) = wrong-side duplicate; notes mentioning Y = correct.
- In account Y: notes mentioning Y (this account) = wrong-side duplicate; notes mentioning X = correct.

#### Cleanup script (`dedupe-transfers.mjs`)

Walks all accounts, groups transactions by:

- Confirmation # extracted from notes (`/Confirmation##\s*(\S+)/i`)
- For "KEEP THE CHANGE" entries: `${date}:${abs(amount)}`

Deletes all but one of each group. Defaults to dry-run; `--apply` performs deletions.

#### ⚠️ Issue: SimpleFIN re-syncs and brings duplicates back

Deleting via API only cleans the current state — next bank sync reimports them.

**Fix**: a **`pre`-stage rule** with `delete-transaction` action, scoped to the affected account, matching wrong-side notes. Created via `dedupe-rules.mjs`:

```js
{
  stage: 'pre',
  conditionsOp: 'and',
  conditions: [
    { field: 'account', op: 'is', value: <savings_id>, type: 'id' },
    { field: 'notes', op: 'matches', value: 'SAV 2222|ACCT\\s*2222', type: 'string' },
  ],
  actions: [{ op: 'delete-transaction', value: '' }],
}
```

And the analogous rule for Checking with pattern `CHK 1111|ACCT\\s*1111`. Rules fire on every incoming sync; SimpleFIN no longer pollutes the budget.

> **Limitation**: rules are case-sensitive and use plain JS `RegExp` (no flags) — see `packages/loot-core/src/server/rules/condition.ts:397`. The regex needs to cover BofA's mixed casing (`transfer to SAV` lowercase, `TRANSFER TO ACCT` uppercase).

---

## Categorization conventions (decided during this work)

| Transaction type                               | Treatment                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Credit-card payments                           | **Transfer**, no category. The original swipes already got categorized; categorizing the payment double-counts.                |
| Mom→me→Coinbase pass-through                   | Single category "Mom's Crypto Pass-Through" used on both sides. Nets to $0. Alternative: off-budget holding account.           |
| Starting balances                              | Dedicated "Starting Balances" category in the Income group. Add to your category set; the import didn't include one.           |
| "Credit Card Payoff" categories in your budget | Budgeting **envelopes**, not transaction categories. Allocate monthly budget into them; payment transactions remain transfers. |

---

## Operational runbook

### Update the deploy from upstream

```bash
ssh user@server
cd ~/code/actual-budget
git fetch upstream
git merge upstream/master
cd deploy
docker compose pull
docker compose up -d
```

### Update Authentik specifically

Bump `AUTHENTIK_TAG` in `.env` → `docker compose up -d authentik-server authentik-worker`. Migrations run automatically.

### Re-run the API tools

All scripts at `~/code/actual-tools/import-categories/` work the same way:

```bash
cd ~/code/actual-tools/import-categories
read -rs "ACTUAL_PASSWORD?Actual server password: " && echo
ACTUAL_SERVER_URL=https://actual.example.com \
ACTUAL_SYNC_ID=<YOUR_SYNC_ID> \
ACTUAL_PASSWORD="$ACTUAL_PASSWORD" \
node <script>.mjs [args]
unset ACTUAL_PASSWORD
```

Available scripts:

- `import.mjs <csv-path> [--dry-run]` — import categories from CSV
- `rebuild-and-apply-rules.mjs` — recreate clean payee/category rules + apply to existing
- `dedupe-transfers.mjs [--apply]` — clean up duplicate transfers (one-time)
- `dedupe-rules.mjs` — install pre-stage rules to prevent future duplicates

### Adding a new family member

1. Authentik admin → Directory → Users → Create (username, display name, password OR send invite link).
2. Set their email if they'll use Google sign-in (so "Link on email" works).
3. Actual `/admin` → Users → Add user with `user_name` matching the Authentik username exactly (`ACTUAL_USER_CREATION_MODE=manual` requires this).
4. Optional: `/admin` → Files → grant them access to a shared budget file.

### Backups (TODO)

Not yet set up. Critical paths to back up on the server:

- `~/code/actual-budget/deploy/data/actual/` — sync-server state + budget files
- `~/code/actual-budget/deploy/data/postgres/` — Authentik users, sources, configs
- `~/code/actual-budget/deploy/.env` — env secrets (NOT in git)

Suggested approach: `restic` to Backblaze B2 or another offsite target, daily, with retention.

---

## Lessons learned (the "would have saved hours" list)

1. **Authentik secrets are 128 chars; copy carefully.** Use the copy button, never manual select. A 1-char drop produces `invalid_client` with no useful diagnostic.
2. **`bootstrapPassword` is destructive to other auth methods.** It runs `UPDATE auth SET active = 0` before inserting password. Re-activate OIDC immediately after if both methods are needed:
   ```sql
   UPDATE auth SET active = 1 WHERE method = 'openid';
   ```
3. **Actual's `userCreationMode=manual` (the default) means OIDC users must be pre-created in Actual.** Choose `manual` (stricter) or `login` (auto-provision) early; the error message (`openid-grant-failed`) is identical to several other failures.
4. **`preferred_username` from the IdP is the join key — not email.** When linking external sources (Google) to Authentik users, set the Authentik user's email correctly so "Link on email" matches and avoid creating duplicate Authentik users.
5. **Actual's UI renders `field: 'payee'` rule conditions by entity-ID lookup, regardless of the condition's `type` field.** String patterns will always show "(deleted)" in the UI. Use `payee oneOf <uuids>` for clean rules.
6. **SimpleFIN doesn't dedupe internal bank transfers.** BofA (and likely others) send both sides of an internal transfer to each account's feed. Use a `pre`-stage `delete-transaction` rule per affected account, keyed off the _self-referencing_ account number in the notes.
7. **Rule regex is case-sensitive vanilla `new RegExp(value)`** — no flags. Cover casing variants explicitly in the pattern (`SAV 2222|ACCT\s*2222`).
8. **The `internal` object returned from `api.init()` exposes `send(message, args)`** for any backend handler — including ones not in the public API (`notes-save`, `rules-run`, `payees-get`). Useful for one-off scripting.
9. **Cloudflared makes the firewall story trivial** — port-bind to `127.0.0.1` only and route via the tunnel. No `ufw` changes, no router NAT, no LetsEncrypt.
10. **Don't reach for two-stage payee rules until you observe the pain.** SimpleFIN's clean naming means single-stage `payee oneOf → category` rules cover the realistic cases; over-engineering this now would produce many empty rules.

---

## Open follow-ups

- [ ] Set up backups (restic or similar).
- [ ] Decide if `ACTUAL_USER_CREATION_MODE=login` is worth the convenience trade-off if you add more family members.
- [ ] Plan the credit-card payoff feature (the actual reason you forked) — will require building the sync-server image locally instead of pulling upstream.
- [ ] Watch for SimpleFIN duplicate patterns on other bank pairs (Citi, Chase, Discover). Add per-account dedup rules as needed.
- [ ] Authentik cleanup: delete `akadmin` user, confirm `<your-username>`'s email matches Gmail.

## Deployment steps:

cd ~/code/actual-budget
git pull
docker build -t actual-budget-fork:latest -f sync-server.Dockerfile .
cd deploy && docker compose up -d actual-server
docker compose logs -f actual-server
