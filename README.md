# BSS Solar — Operations Console

A B2B SaaS operations console for **BSS Solar**, an empanelled solar implementation agency.
It covers the full field-to-finance workflow: CRM work orders, KSEB/ANERT-compliant project
installation tracking, and a maintenance service-ticketing system with a printable PDF service report.

## Tech Stack

- **Framework:** Next.js 16 (App Router, TypeScript)
- **Database & Auth:** Supabase (PostgreSQL + Row Level Security)
- **UI:** Tailwind CSS v4, shadcn/ui (Radix), Lucide icons
- **PDF:** `jspdf` + `jspdf-autotable`

## Features

- **Auth & RBAC** — Supabase email/password auth with two roles:
  - `admin` (office staff) — sees and manages all data.
  - `coordinator` (field sales) — sees only their own work orders/projects/tickets (enforced by RLS).
- **Work Orders (CRM)** — log client, capacity, advance, total cost, order date. Admin approves/rejects.
- **Project Tracker** — approving a work order creates an active project that auto-seeds the 8 regional
  milestones. Kanban board grouped by current stage + a sequential milestone tracker per project.
- **Service Tickets** — routine 6-month or ad-hoc tickets capturing the full BSS service sheet
  (system, battery, SPV details, post-service SPV string / MPPT readings, resolution, financials).
- **PDF Export** — one click generates a professional, invoice-style service report.
- **Dashboard** — KPI cards plus sortable (chronological) and filterable (coordinator / project stage) tables.

## Getting Started

### 1. Create a Supabase project

In the Supabase SQL Editor, run the schema:

```
supabase/schema.sql
```

This creates the enums, tables (`profiles`, `work_orders`, `projects`, `project_milestones`,
`service_tickets`), triggers (auto-profile on signup, auto-seed milestones, `updated_at`), and all RLS policies.

### 2. Configure environment

Copy `.env.local.example` to `.env.local` and fill in your project values
(Supabase → Project Settings → API):

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

### 3. Install & run

```
npm install
npm run dev
```

Open http://localhost:3000.

### 4. Create users & roles

- Sign up at `/signup`. New users default to the `coordinator` role.
- To make a user an **admin**, update their row in the `profiles` table:

```sql
update profiles set role = 'admin' where id = '<auth-user-id>';
```

> Tip: if you disable "Confirm email" in Supabase Auth settings during development,
> new sign-ups can log in immediately.

## Project Structure

```
supabase/schema.sql            # Full PostgreSQL schema + RLS
src/proxy.ts                   # Auth session refresh + route protection (Next 16 proxy)
src/lib/supabase/              # Browser/server/proxy Supabase clients
src/lib/auth.ts                # getProfile / requireProfile / requireAdmin
src/lib/types.ts               # Shared domain types
src/lib/constants.ts           # Milestones, labels, company info
src/lib/pdf.ts                 # jsPDF service-report generator
src/app/(app)/                 # Authenticated app (dashboard, work-orders, projects, tickets)
src/app/login, src/app/signup  # Auth pages + actions
src/components/                # Sidebar, header, tables, forms, badges
```

## Roles & Permissions (RLS summary)

| Resource           | Admin            | Coordinator                          |
| ------------------ | ---------------- | ------------------------------------ |
| Work Orders        | Full CRUD        | Create + read/update their own       |
| Projects           | Full + approve   | Read their own                       |
| Project Milestones | Update           | Read their own                       |
| Service Tickets    | Full CRUD        | Read tickets on their own projects   |
```
