# Deploy BSS Solar Operations Console (Live)

Stack: **Next.js on Vercel** + **Supabase Cloud** (PostgreSQL, Auth, RLS).

Estimated time: ~30 minutes.

---

## Overview

```mermaid
flowchart LR
  GitHub[GitHub repo] --> Vercel[Vercel - Next.js app]
  Vercel --> Supabase[Supabase Cloud]
  Users[Staff browsers] --> Vercel
```

| Layer | Service | Purpose |
| ----- | ------- | ------- |
| Frontend | [Vercel](https://vercel.com) | Hosts the Next.js app |
| Backend | [Supabase](https://supabase.com) | Database, auth, RLS |

---

## Step 1 — Create Supabase project (production database)

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Choose a name (e.g. `bss-solar-prod`), region (**South Asia (Mumbai)** is closest to Kerala), and set a strong DB password. Save the password.
3. Wait until the project is **Active**.

### Apply the database schema

**Option A — SQL Editor (simplest)**

1. Open **SQL Editor** → **New query**.
2. Paste the full contents of [`supabase/schema.sql`](supabase/schema.sql) and **Run**.
3. Confirm tables exist under **Table Editor**: `profiles`, `work_orders`, `projects`, `project_milestones`, `service_tickets`.

**Option B — Supabase CLI**

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

> Do **not** run `supabase/seed.sql` on production — it is local demo data only.

### Updating an existing production database ⚠️

Each migration is idempotent, so on a DB that was provisioned from `schema.sql` you can
safely paste and run these files in the **SQL Editor** in order:

1. `supabase/migrations/20260709120000_security_hardening.sql` — **closes the coordinator
   → admin privilege-escalation hole and the self-approval hole**, and makes approval
   atomically create the project. **Highest priority — apply ASAP.**
2. `supabase/migrations/20260709130000_api_role_grants.sql` — API-role grants.
3. `supabase/migrations/20260709140000_dashboard_metrics_and_indexes.sql` — dashboard
   aggregate function + indexes.
4. `supabase/migrations/20260709150000_ticket_no_sequence.sql` — collision-free ticket numbers.
5. `supabase/migrations/20260709160000_list_views.sql` — flattened views that
   back server-side pagination/search (RLS-respecting `security_invoker` views).
6. `supabase/migrations/20260730120000_superadmin_enum.sql` — adds the `superadmin`
   value to `user_role`. **Must run in its own transaction** (PostgreSQL refuses to
   *use* a new enum value in the transaction that added it) — run this file alone,
   then the next one.
7. `supabase/migrations/20260730120100_superadmin_work_order_fields_payments.sql` —
   SuperAdmin role + SuperAdmin-only DELETE policies, the extra work-order columns
   (consumer number, notes, KSEB section, loan bank, two staged payments), the derived
   payment columns on the list views, and the commissioned-unpaid dashboard KPIs.

Or, if the project is linked to the CLI, run `npx supabase db push`.

#### One behaviour change to be aware of

Migration 7 makes **DELETE SuperAdmin-only** on `work_orders`, `projects` and `profiles`.
Because the schema is applied *before* the new code deploys, in the gap between the two an
admin using the currently-deployed build can still press **Delete** — RLS filters the row
out, so nothing is deleted. The new build detects the zero-row delete and reports it
instead of showing a false success. Keep the gap short by merging `master → production`
once CI is green.

### Collect API keys

**Project Settings → API**:

| Supabase dashboard label | Vercel env variable |
| ------------------------ | ------------------- |
| **Project URL** | `NEXT_PUBLIC_SUPABASE_URL` |
| **Publishable key** (`sb_publishable_…`) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| **Secret key** (`sb_secret_…`) | `SUPABASE_SERVICE_ROLE_KEY` |

> Older projects may label these `anon` and `service_role` — same mapping applies.

Keep the **secret / service_role** key private — server-only (Team → Add Member).

---

## Step 2 — Configure Supabase Auth

1. **Authentication → Providers → Email**  
   - Enable Email provider.  
   - **Disable “Allow new users to sign up”** (staff accounts are created by admin only).

2. **Authentication → URL configuration**:  
   - **Site URL**: `https://app.bss-solar.com`  
   - **Redirect URLs**: add  
     - `https://app.bss-solar.com/**`  
     - `http://localhost:3000/**` (optional, for local testing against prod DB)

3. For faster onboarding, you may disable **Confirm email** under Email provider until staff accounts are set up.

4. **Harden auth** (defense-in-depth for the app-layer throttling):
   - **Authentication → Rate Limits / Attack Protection** — keep the default
     sign-in rate limits enabled; turn on **CAPTCHA** (hCaptcha/Turnstile) if exposed publicly.
   - **Authentication → Policies** — set a **minimum password length of 12** to match the
     app's Add-Member validation.

---

## Step 3 — Deploy the Next.js app on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) → **Import** `GSARYAPUTHRAN/bss-solar` from GitHub.
2. Framework preset: **Next.js** (auto-detected).
3. **Environment variables** (Settings → Environment Variables) — add all three for **Production** (and Preview if you test PRs):

| Name | Value |
| ---- | ----- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://YOUR-PROJECT-REF.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your `sb_publishable_…` key |
| `SUPABASE_SERVICE_ROLE_KEY` | your `sb_secret_…` key |

4. Click **Deploy** and wait for the build to finish.
5. Add custom domain **bss-solar.com** under **Settings → Domains** (already done if purchased on Vercel).
6. Return to Supabase **URL configuration** (Step 2):
   - **Site URL**: `https://app.bss-solar.com`
   - **Redirect URLs**: `https://app.bss-solar.com/**`
7. **Redeploy** after adding env vars (Deployments → ⋯ → Redeploy).

### Redeploys

Every push to the **`production`** branch auto-deploys when Vercel is configured to use that branch. Merge `master` into `production` when you are ready to release.

### CI quality gate (recommended branch protection)

`.github/workflows/ci.yml` runs on every PR to `master`/`production`: typecheck,
lint, unit tests, a production build, RLS/DB integration tests (against a
throwaway local Supabase), and Playwright E2E. To make green CI a merge
requirement:

1. **GitHub → Settings → Branches → Add rule** for `master` **and** `production`.
2. Require a pull request before merging; require the **CI** status checks
   (`quality`, `integration`, `e2e`) to pass; disallow direct pushes.
3. Release by merging `master → production` **only after CI is green**, so the
   branch Vercel deploys can never contain unverified code.

### Automatic production migrations

Vercel builds the Next.js app but does **not** run database migrations. The CI
workflow includes a `migrate-production` job that runs **only after the whole
pipeline passes on `master`** and applies pending migrations to the production
Supabase project with `supabase db push`. The migrations are additive
(columns/views/functions/triggers/grants), so the schema is made ready while the
currently-deployed code keeps working; you then merge `master → production` to
ship the code that uses it.

> Where a migration also *tightens* a policy — as the SuperAdmin release does for
> `DELETE` — the old code fails closed in the gap rather than misbehaving. See
> [One behaviour change to be aware of](#one-behaviour-change-to-be-aware-of) and
> keep the gap short by merging to `production` as soon as CI is green.

Enable it once by adding three **repo secrets**
(Settings → Secrets and variables → Actions):

| Secret | Where to get it |
| ------ | --------------- |
| `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens |
| `SUPABASE_DB_PASSWORD` | The database password you set when creating the project |
| `SUPABASE_PROJECT_REF` | Supabase project ref (e.g. from the project URL) |

Recommended release flow once secrets are set:

1. Merge work into `master` → CI runs; on green, `migrate-production` applies
   migrations to the prod DB automatically.
2. Merge `master → production` → Vercel builds and deploys the code.

> Keep every migration **backward compatible** (additive, or safe against the
> currently-deployed code), since the schema is applied before the new code.

> **Private repo on Hobby:** Git pushes only deploy if the **commit author email** matches your GitHub/Vercel account. If you see *“commit author did not have contributing access”*, fix the email (below) or deploy via CLI.

```powershell
# One-time: use the email on your GitHub account (Settings → Emails)
git config user.email "YOUR-GITHUB-EMAIL"
git config user.name "gsaryaputhran"

# Then commit and push as usual
git checkout production
git merge master
git commit --allow-empty -m "Deploy with correct author"
git push origin production
```

**CLI deploy (bypasses git author check):**

```powershell
npx vercel login
npx vercel link --project bss-solar --yes
npx vercel --prod
```

---

## Step 4 — Create the first admin user

There is no public sign-up page. Create the first admin manually:

1. **Supabase → Authentication → Users → Add user**  
   - Email: e.g. `admin@bsssolar.in`  
   - Password: strong password  
   - Check **Auto confirm user**

2. **SQL Editor** — run [`supabase/production-bootstrap.sql`](supabase/production-bootstrap.sql) after editing the email inside the file.

3. Sign in at `https://app.bss-solar.com/login`.

4. Use **Team → Add Member** to create coordinator accounts.

5. **Appoint the Super Admin** (the only role that can delete users, projects and
   work orders). The seat starts vacant, so any admin can fill it once: **Team →**
   pick the member **→ role menu → Super Admin**. After that only the sitting
   Super Admin can move the seat — choosing *Super Admin* for someone else transfers
   it. `production-bootstrap.sql` has a commented statement for doing it in SQL if
   the account is ever lost.

---

## Step 5 — Smoke test (production)

| Check | How |
| ----- | --- |
| Login | Admin signs in at `/login` |
| Dashboard | Admin sees KPIs at `/` |
| Work order | Coordinator creates one; admin approves |
| Projects board | Cards appear in correct Kanban columns |
| Team | Admin adds a coordinator at `/team/new` |
| PDF | Open a ticket → Download PDF |
| Work-order edit | Coordinator edits their own order; the project shows the change |
| Payments | Set a total + partial payments → `Balance` column and badge update |
| Commissioned · Unpaid | Dashboard KPI links to the filtered project list |
| Delete | Only the Super Admin sees Delete on team/work orders/projects |

---

## Custom domain

Production URL: **https://app.bss-solar.com** (subdomain of `bss-solar.com` registered on Vercel).

Update Supabase **Site URL** and **Redirect URLs** to `https://app.bss-solar.com` only.

## Running costs (typical)

| Service | Tier | Monthly | Notes |
| ------- | ---- | ------- | ----- |
| **Vercel** | Hobby (free) | **$0** | Enough for a small internal ops app |
| **Supabase** | Free | **$0** | 500 MB DB; pauses after ~7 days idle on free tier |
| **Domain** | bss-solar.com | **~$0.94/mo** | ~$11.25/year renewal on Vercel |

**Estimated total today: ~$0/month** + domain renewal (~$11/year).

Upgrade when you outgrow free limits: Supabase Pro **$25/mo**, Vercel Pro **$20/mo** per seat.

---

## Troubleshooting

| Issue | Fix |
| ----- | --- |
| Login redirects loop | Supabase Site URL must match your Vercel URL exactly |
| “Invalid API key” | Re-copy anon key; redeploy Vercel with correct env vars |
| Add Member fails | `SUPABASE_SERVICE_ROLE_KEY` missing or wrong on Vercel |
| Coordinator sees dashboard | Clear cache; ensure latest `master` is deployed |
| Git push blocked on Hobby private repo | Commit email must match GitHub/Vercel account, or use `npx vercel --prod` |
| RLS blocks data | User must exist in `profiles`; check role is `admin` or `coordinator` |

---

## CLI quick reference

```bash
# Local against production DB (use prod keys in .env.local — be careful)
npm run build          # verify production build
npx supabase db push   # push migration changes to linked project
npx vercel --prod      # deploy from CLI (after vercel login + link)
```
