# BSS Solar — Operations Console

A B2B SaaS operations console for **[BSS Solar](https://bsssolar.com/)**, an empanelled solar implementation agency in Kerala.
It covers the full field-to-finance workflow: CRM work orders, KSEB/ANERT-compliant project
installation tracking, a payments ledger, KSEB feasibility and fee tracking, team management,
a maintenance service-ticketing system worked by service engineers from their phones, and
in-app + push notifications for everyone involved.

Field staff (coordinators and service engineers) use it on **phones**; the office and the
Super Admin mostly use it on a **PC**. Every screen is built for both.

## Tech Stack

- **Framework:** Next.js 16 (App Router, TypeScript)
- **Database & Auth:** Supabase (PostgreSQL + Row Level Security, Realtime)
- **UI:** Tailwind CSS v4, shadcn/ui (Radix), Lucide icons
- **Notifications:** Supabase Realtime (live bell) + Web Push (`web-push`, VAPID, service worker)
- **PDF:** `jspdf` + `jspdf-autotable`

## Features

- **Auth & RBAC** — Supabase email/password auth with four roles:
  - `superadmin` — **exactly one account**, the highest privilege. Everything an admin
    can do, plus the only role that can **delete** users, projects, work orders and
    payments (enforced by RLS, not just the UI). The role itself is not editable from the
    app by anyone — it is set directly on the database.
  - `admin` (office staff) — sees and manages all data, but cannot delete.
  - `coordinator` (field sales) — sees only their own work orders/projects (enforced by RLS).
  - `service_engineer` (field service) — sees **only the service tickets assigned to them**,
    and can move them to *in progress* or *completed*. Nothing else in the CRM.
- **Work Orders (CRM)** — client, capacity, KSEB consumer number & section, **financing
  (self-financed or bank loan + bank)**, notes, order date, total cost and the booking
  advance. Admin approves/rejects and spawns a project. **Coordinators can edit their own
  orders**; a project reads its details live off the work order, so an edit is reflected on
  the project immediately.
- **Project Tracker** — Kanban board (default view) plus a filterable list. Approving a work order creates an active project that auto-seeds the 9 KSEB/ANERT milestones with per-milestone status and notes.
- **Payments ledger** — after the booking advance, the office records **any number of
  instalments** against a project, each with its date, method (cash, UPI, bank transfer,
  cheque, loan disbursement…), purpose (contract or customer-paid KSEB fees) and reference.
  Received / balance / collected % are derived in Postgres, so a **commissioned plant with
  money still outstanding** is a first-class, queryable state: a dashboard KPI, a
  `Commissioned · payment pending` filter, and a badge wherever the project is shown.
- **KSEB feasibility & fees** — the feasibility date is captured (automatically when the
  *KSEB Feasibility Clearance* milestone completes). It is valid for **30 days**; every
  further 30-day period until commissioning costs BSS another **₹1,000**, shown per project
  and on the dashboard, with alerts when a week is left, again on the last day, and when a
  new period starts. The customer-paid
  fees are itemised too: feasibility **₹1,000** + registration **₹1,000 per kW + 18% GST**.
- **Coordinator incentives** — the office sets an incentive per project and marks it paid;
  coordinators see their own (per project and as a summary), the dashboard shows what is
  still pending.
- **Service Tickets** — routine 6-month or ad-hoc tickets capturing the full BSS service sheet
  (system, battery, SPV details, post-service SPV string / MPPT readings, resolution, financials).
  Every ticket is **assigned to a service engineer**, who works it from a phone-first worklist
  with one-tap call / Google Maps links.
- **Notifications** — a bell with an unread badge and a small panel on every page, a full
  `/notifications` inbox, live updates over Supabase Realtime, and **browser push** to phones
  and PCs (new work order, approval, payment recorded, ticket assigned / started / completed,
  feasibility expiring or extended, incentive set or paid). Each person gets only what
  concerns them. On iPhone, push works once the app is added to the Home Screen
  (Safari → Share → *Add to Home Screen*, iOS 16.4+).
- **PDF Export** — one click generates a PDF matching the official BSS Solar service form layout.
- **Team Management** — admins can add staff accounts (coordinators, service engineers,
  admins), assign roles, and search/filter the team list.
- **Onboarding import** — admins bulk-load existing projects from a CSV (paste or upload);
  each row creates an approved work order + project at the given stage, including financing,
  feasibility date, incentive and **any number of dated payments** (`payment_1_*`,
  `payment_2_*`, … — the template shows four). Every problem in a row is
  reported together, re-uploads skip rows already imported, and failed rows download as a
  fix-and-retry CSV.
- **Dashboard** — KPI cards (single aggregate query) plus recent-activity tables.
- **Scalable lists** — every list paginates, filters, sorts and searches **server-side** (URL-driven) via RLS-respecting Postgres views, so they hold up at large data volumes.
- **Installable app** — a web manifest and icons, so field staff can add it to their home screen.
- **Light / dark theme** — system-aware with a toggle; preference persists.

## Getting Started

### Option A — Local development (recommended)

Requires [Docker](https://www.docker.com/) and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
# 1. Install dependencies
npm install

# 2. Start local Supabase (schema + demo seed run automatically)
npx supabase start

# 3. Copy env and fill in keys from `npx supabase status`
cp .env.local.example .env.local

# 4. Run the app
npm run dev
```

Open http://localhost:3000 and sign in with the demo accounts:

| Role        | Email                  | Password     |
| ----------- | ---------------------- | ------------ |
| Super Admin | `super@bsssolar.test`  | `Super@12345` |
| Admin       | `admin@bsssolar.test`  | `Admin@12345` |
| Coordinator | `coord@bsssolar.test`  | `Coord@12345` (Rahul Menon) |
| Coordinator | `priya@bsssolar.test`  | `Coord@12345` (Priya Suresh) |
| Coordinator | `arun@bsssolar.test`   | `Coord@12345` (Arun Krishnan) |
| Coordinator | `sneha@bsssolar.test`  | `Coord@12345` (Sneha Das) |
| Service Engineer | `engineer@bsssolar.test` | `Engineer@12345` (Anil Kumar) |
| Service Engineer | `vineeth@bsssolar.test`  | `Engineer@12345` (Vineeth Nair) |

Reset demo data anytime:

```bash
npx supabase db reset
```

### Option B — Hosted Supabase project

1. Create a Supabase project and run `supabase/schema.sql` in the SQL Editor.
2. Copy `.env.local.example` to `.env.local` and fill in your project values
   (Supabase → Project Settings → API).
3. `npm install && npm run dev`

### Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Optional: browser push (node scripts/generate-vapid-keys.mjs, once per deployment)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
# Optional: daily feasibility alerts (/api/cron/daily). openssl rand -hex 32
CRON_SECRET=
```

`SUPABASE_SERVICE_ROLE_KEY` is required for admin actions such as **Add Team Member** on the
Team page, and for delivering notifications. For local dev, get it from `npx supabase status`.

Without the VAPID keys the bell, panel and inbox still work in real time; the panel just
says push is not set up. Without `CRON_SECRET` the daily job refuses every request, so no
feasibility reminders are sent. `.env.local.example` documents each variable.

### Users & roles

- **Admin adds members** at `/team/new` — create staff accounts with name, email, password,
  phone, and role (coordinator, service engineer or admin).
- A person who owns work orders cannot become a service engineer, and an engineer with open
  tickets cannot change role until those tickets are reassigned — the database refuses both.
- **Promote to admin** — update the `profiles` table directly, or use the role dropdown on the Team page:

```sql
update profiles set role = 'admin' where id = '<auth-user-id>';
```

> Tip: disable "Confirm email" in Supabase Auth settings during development so admin-created accounts can log in immediately.

## Project Structure

```
supabase/
  migrations/                  # Ordered, re-runnable migrations (CI applies them to production)
  schema.sql                   # Full PostgreSQL schema + RLS (CI checks it matches the migrations)
  seed.sql                     # Local demo data + test accounts
  production-bootstrap.sql     # Appoint the Super Admin (SQL-only)
  scripts/                     # reset-business-data(-preview).sql, check-schema-sync.mjs
public/sw.js                   # Push service worker (shows alerts, opens the right page)
scripts/                       # generate-vapid-keys.mjs, generate-icons.mjs
vercel.json                    # Daily cron (08:00 IST) for feasibility alerts
src/
  proxy.ts                     # Auth session refresh + route protection (Next 16)
  config/navigation.ts         # Module registry (plug-and-play nav)
  server/
    data/*.repository.ts       # Supabase data-access layer
    notifications/             # notify(): recipients, in-app rows, Web Push delivery
    cron/                      # Daily feasibility sweep + cron auth
    form.ts                    # Typed FormData parsers for server actions
  lib/
    supabase/                  # Browser, server, admin Supabase clients
    domain/                    # Pure business rules: payments, KSEB fees & feasibility,
                               # capacity, notifications, import, status registries
    auth.ts                    # getProfile / requireProfile / requireRole
    pdf.ts                     # BSS service-form PDF generator
  components/
    layout/                    # Reusable page kit (Page, Section, Field, Form…)
    data-table/                # Generic searchable, filterable, paginated table
    bss-logo.tsx               # Official BSS Solar branding
  app/(app)/                   # Authenticated routes
    page.tsx                   # Dashboard
    work-orders/               # CRM list, detail, create
    projects/                  # Board (default) + list, detail
    tickets/                   # Service tickets (office table / engineer worklist), detail, edit, create
    notifications/             # Inbox
    payments/                  # Payments ledger server actions
    onboarding/                # CSV bulk import
    team/                      # Team list + add member
  app/api/cron/daily           # Scheduled feasibility alerts (Bearer CRON_SECRET)
  app/manifest.ts              # Installable web app manifest
  app/login                    # Staff sign-in (accounts created by admin)
public/brand/                  # Official logo assets from bsssolar.com
```

## Roles & Permissions (RLS summary)

| Resource | Super Admin | Admin | Coordinator | Service Engineer |
| -------- | ----------- | ----- | ----------- | ---------------- |
| Work Orders | Everything + delete | Create/read/update, approve | Create + read/**edit** their own | — |
| Projects | Everything + delete | Read/update all, approve | Read their own | — |
| Project Milestones | Update | Update | Read their own | — |
| Payments ledger | Record/edit + delete | Record/edit | Read their own projects' | — |
| Feasibility / incentive | Set | Set | Read their own | — |
| Service Tickets | Full CRUD | Full CRUD | Read tickets on their own projects | Read + set *in progress* / *completed* on **their own** only |
| Notifications | Own inbox | Own inbox | Own inbox | Own inbox |
| Team / Profiles | Add + roles + delete | Add + roles | Read own profile only | Read own profile only |

### The Super Admin seat

- There is **exactly one**, enforced by a partial unique index on `profiles`.
- The role is **immutable from the app**. It is never offered in a role picker, the
  holder's row renders as a locked badge, and no signed-in user — not an admin, not
  even the Super Admin themselves — can grant, revoke or reassign it. A database
  trigger (`guard_profile_role`) rejects any such change independently of the UI.
- The Super Admin account also cannot be deleted from the app.
- Appointing or moving the seat is therefore **SQL-only**, via
  [`supabase/production-bootstrap.sql`](supabase/production-bootstrap.sql) — which is
  also the recovery path if the account is lost. The one context the trigger permits
  is a server-side one (`auth.uid()` is `NULL`), matching how every other guard in
  this schema is written.
- The Super Admin can still manage ordinary roles (admin ↔ coordinator) as usual;
  immutability is scoped to the seat itself.
- Deleting a member who still owns work orders or projects is refused
  (`on delete restrict`); reassign or delete that business first.
- Deleting a project returns its work order to `pending`, so the invariant
  "approved work order ⇒ has a project" always holds and it can be approved again.

## Scripts

```bash
npm run dev        # Start dev server
npm run build      # Production build
npm run start      # Start production server
npm run lint       # ESLint (fails on warnings)
npm run typecheck  # tsc --noEmit
npm run test       # Vitest unit tests
npm run verify     # typecheck + lint + unit + build (pre-push gate)
npm run db:types   # Regenerate src/lib/supabase/database.types.ts from local DB (CI checks it)
node scripts/generate-vapid-keys.mjs   # One VAPID key pair for push
```

### Wiping business data (keep only the named admins)

[`supabase/scripts/reset-business-data.sql`](supabase/scripts/reset-business-data.sql) deletes
every work order, project, payment, ticket, notification and every user **except** the e-mails
in its keep-list, then restarts the ticket numbering. Run
[`reset-business-data-preview.sql`](supabase/scripts/reset-business-data-preview.sql) first to see
what would go, take a backup, then run the reset in the Supabase SQL Editor. It aborts without
deleting anything if a keep-list e-mail is missing or no office account would remain. Then
recreate staff accounts and bulk-import. See **[DEPLOY.md](DEPLOY.md)** → *Fresh start*.

## Testing

| Layer | Tool | Command | Needs |
| ----- | ---- | ------- | ----- |
| Unit | Vitest | `npm run test` | — |
| Integration (RLS, triggers, RPCs) | Vitest + local Supabase | `npm run test:integration` | `npx supabase start` |
| End-to-end (critical flows) | Playwright | `npm run test:e2e` | `supabase start` + `npm run build` |

- **Integration tests** exercise real Row Level Security and DB triggers against a
  local Supabase stack — they assert that a coordinator cannot escalate to admin,
  cannot self-approve work orders, tenant data stays isolated, approval seeds the 9
  milestones, ticket numbers are unique, **deletes are refused for anyone but the
  Super Admin**, the Super Admin seat cannot be duplicated, hijacked, or changed by
  anyone signed in (including its holder) while ordinary role management still works,
  a coordinator's edits surface on their project, the SQL payment, capacity and
  feasibility maths agree with `lib/domain/`, service engineers see and change only their
  own tickets, notifications reach only their recipients, and the import RPC and the reset
  script behave row by row.
- **E2E** covers login/RBAC redirects, work-order creation and editing, the payments
  ledger, KSEB feasibility and incentives, the service engineer's phone workflow, the
  notification bell and inbox, the bulk import, the Super Admin-only delete affordances,
  and the commissioned-but-unpaid dashboard KPI. Every spec owns the data it changes, so
  the suite can be re-run without resetting the database.

> `E2E_PORT=3711 npm run test:e2e` runs the suite on another port if 3100 is taken.
- CI (`.github/workflows/ci.yml`) runs all of the above on every PR. See
  **[DEPLOY.md](DEPLOY.md)** for the branch-protection setup that gates merges.

> First E2E/integration run: `npx supabase start` (Docker) and
> `npx playwright install chromium`.

## Deploy to production

See **[DEPLOY.md](DEPLOY.md)** for the full guide (Supabase Cloud + Vercel).
