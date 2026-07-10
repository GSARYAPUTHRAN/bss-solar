# BSS Solar — Operations Console

A B2B SaaS operations console for **[BSS Solar](https://bsssolar.com/)**, an empanelled solar implementation agency in Kerala.
It covers the full field-to-finance workflow: CRM work orders, KSEB/ANERT-compliant project
installation tracking, team management, and a maintenance service-ticketing system with a printable PDF service report.

## Tech Stack

- **Framework:** Next.js 16 (App Router, TypeScript)
- **Database & Auth:** Supabase (PostgreSQL + Row Level Security)
- **UI:** Tailwind CSS v4, shadcn/ui (Radix), Lucide icons
- **PDF:** `jspdf` + `jspdf-autotable`

## Features

- **Auth & RBAC** — Supabase email/password auth with two roles:
  - `admin` (office staff) — sees and manages all data.
  - `coordinator` (field sales) — sees only their own work orders/projects/tickets (enforced by RLS).
- **Work Orders (CRM)** — log client, capacity, advance, total cost, order date. Admin approves/rejects and spawns a project.
- **Project Tracker** — Kanban board (default view) plus a filterable list. Approving a work order creates an active project that auto-seeds the 9 KSEB/ANERT milestones with per-milestone status and notes.
- **Service Tickets** — routine 6-month or ad-hoc tickets capturing the full BSS service sheet
  (system, battery, SPV details, post-service SPV string / MPPT readings, resolution, financials).
- **PDF Export** — one click generates a PDF matching the official BSS Solar service form layout.
- **Team Management** — admins can add staff accounts, assign roles, and search/filter the team list.
- **Onboarding import** — admins bulk-load existing projects from a CSV (paste or upload); each row creates an approved work order + project at the specified stage, with a per-row result report.
- **Dashboard** — KPI cards (single aggregate query) plus recent-activity tables.
- **Scalable lists** — every list paginates, filters, sorts and searches **server-side** (URL-driven) via RLS-respecting Postgres views, so they hold up at large data volumes.
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
| Admin       | `admin@bsssolar.test`  | `Admin@12345` |
| Coordinator | `coord@bsssolar.test`  | `Coord@12345` (Rahul Menon) |
| Coordinator | `priya@bsssolar.test`  | `Coord@12345` (Priya Suresh) |
| Coordinator | `arun@bsssolar.test`   | `Coord@12345` (Arun Krishnan) |
| Coordinator | `sneha@bsssolar.test`  | `Coord@12345` (Sneha Das) |

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
```

`SUPABASE_SERVICE_ROLE_KEY` is required for admin actions such as **Add Team Member** on the Team page. For local dev, get it from `npx supabase status`.

### Users & roles

- **Admin adds members** at `/team/new` — create staff accounts with name, email, password, phone, and role.
- **Promote to admin** — update the `profiles` table directly, or use the role dropdown on the Team page:

```sql
update profiles set role = 'admin' where id = '<auth-user-id>';
```

> Tip: disable "Confirm email" in Supabase Auth settings during development so admin-created accounts can log in immediately.

## Project Structure

```
supabase/
  schema.sql                   # Full PostgreSQL schema + RLS
  seed.sql                     # Local demo data + test accounts
src/
  proxy.ts                     # Auth session refresh + route protection (Next 16)
  config/navigation.ts         # Module registry (plug-and-play nav)
  server/
    data/*.repository.ts       # Supabase data-access layer
    form.ts                    # Typed FormData parsers for server actions
  lib/
    supabase/                  # Browser, server, admin Supabase clients
    domain/status.ts           # Status registry (labels + badge styles)
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
    tickets/                   # Service tickets list, detail, edit, create
    team/                      # Team list + add member
  app/login                    # Staff sign-in (accounts created by admin)
public/brand/                  # Official logo assets from bsssolar.com
```

## Roles & Permissions (RLS summary)

| Resource           | Admin            | Coordinator                          |
| ------------------ | ---------------- | ------------------------------------ |
| Work Orders        | Full CRUD        | Create + read/update their own       |
| Projects           | Full + approve   | Read their own                       |
| Project Milestones | Update           | Read their own                       |
| Service Tickets    | Full CRUD        | Read tickets on their own projects   |
| Team / Profiles    | Full + add users | Read own profile only                |

## Scripts

```bash
npm run dev        # Start dev server
npm run build      # Production build
npm run start      # Start production server
npm run lint       # ESLint (fails on warnings)
npm run typecheck  # tsc --noEmit
npm run test       # Vitest unit tests
npm run verify     # typecheck + lint + unit + build (pre-push gate)
npm run db:types   # Regenerate src/lib/supabase/database.types.ts from local DB
```

## Testing

| Layer | Tool | Command | Needs |
| ----- | ---- | ------- | ----- |
| Unit | Vitest | `npm run test` | — |
| Integration (RLS, triggers, RPCs) | Vitest + local Supabase | `npm run test:integration` | `npx supabase start` |
| End-to-end (critical flows) | Playwright | `npm run test:e2e` | `supabase start` + `npm run build` |

- **Integration tests** exercise real Row Level Security and DB triggers against a
  local Supabase stack — they assert that a coordinator cannot escalate to admin,
  cannot self-approve work orders, tenant data stays isolated, approval seeds the 9
  milestones, and ticket numbers are unique.
- **E2E** covers login/RBAC redirects and work-order creation with Playwright.
- CI (`.github/workflows/ci.yml`) runs all of the above on every PR. See
  **[DEPLOY.md](DEPLOY.md)** for the branch-protection setup that gates merges.

> First E2E/integration run: `npx supabase start` (Docker) and
> `npx playwright install chromium`.

## Deploy to production

See **[DEPLOY.md](DEPLOY.md)** for the full guide (Supabase Cloud + Vercel).
