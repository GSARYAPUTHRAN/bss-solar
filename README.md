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
    can do, plus the only role that can **delete an admin**. The role itself is not
    editable from the app by anyone — it is set directly on the database.
  - `admin` (office staff) — sees and manages all data and, **for now**, may also
    **delete** sales, projects, ledger entries, incentives, coordinators and service
    engineers — never another admin or the Super Admin. Who may delete is one switch per
    layer (enforced by RLS, not just the UI); see [Deleting records](#deleting-records),
    including how to make deletes Super Admin-only again.
  - `coordinator` (field sales) — sees only the sales they are on: their own, and ones
    they **share** with other coordinators (enforced by RLS).
  - `service_engineer` (field service) — sees **only the service tickets assigned to them**,
    and can move them to *in progress* or *completed*. Nothing else in the CRM.
- **Work Orders (CRM)** — client, capacity, KSEB consumer number & section, **financing
  (self-financed or bank loan + bank)**, notes, order date, total cost and the booking
  advance. Admin approves/rejects and spawns a project. **Coordinators can edit the orders
  they are on**; a project reads its details live off the work order, so an edit is
  reflected on the project immediately.
- **Shared coordinators** — a sale made by several people can have up to **five**
  coordinators. The one who logs a work order can add other **coordinators** as partners
  while it is still pending (the new-work-order form has an *Add partner* picker); office
  accounts (admins, the Super Admin) are the office's to add, and after approval only the
  office changes who shares a sale. Everyone on a sale sees and edits its work order and project,
  sees its payments, milestones and service history, and gets its notifications; the
  office is told when partners are added. The first coordinator stays the work order's
  owner of record, and names read "Ravi & Abhijith" wherever a sale is listed. Each
  person's **incentive is private** — the office sets one per person, and a coordinator
  sees only their own. Taking someone off a sale is refused while an incentive is set for
  them, and tells them they were removed.
  *Accepted exposure:* partners on a sale can read each other's profile row — **name, role
  and phone** (they need to call each other) — and nobody else's. A partner is not asked, so
  a coordinator can add any other coordinator to a sale they log, which shows that person's
  profile to everyone else on it and puts the sale on their list; the office can take them
  off again (once any incentive set for them is cleared). They cannot add admins or the
  Super Admin.
- **Solar plants and custom plans** — a work order is a *solar plant* (capacity such as
  `3kW`, priced per kW for KSEB fees) or a *custom plan* ("1 panel", "Inverter + panel")
  where the capacity field holds what was sold instead. A custom plan has no KSEB
  registration estimate, no feasibility clock and a single **Handover** milestone; it is
  listed in its own *Custom plans* lane on the board. The plan is fixed once the project
  exists. A solar capacity needs a unit on its first number (`3kW`, `5 kWp`, `3000W`),
  so "1 panel" can no longer be mistaken for 1 kW.
- **Cancelled and refunded projects** — the office marks a project *cancelled* or
  *refunded* with remarks (for a refund: how much, when, how) and can **reinstate** it. It
  leaves the active pipeline, the dashboard KPIs and "payment pending"; the payments ledger
  is never rewritten, the money already collected stays on record, the KSEB feasibility
  clock stops on the day it was cancelled (renewal fees already paid still count), and its
  milestones are frozen until it is reinstated (with an optional new feasibility date).
  The dashboard has a *Cancelled / Refunded* tile, and the lists filter on both.
- **Project Tracker** — Kanban board (default view) plus a filterable list. Approving a work order creates an active project that auto-seeds the 9 KSEB/ANERT milestones with per-milestone status and notes.
- **Payments ledger** — the booking advance (with its own method, date and reference), then
  **any number of dated entries** against a project, each with its method (cash, UPI, bank
  transfer, cheque, loan disbursement…) and reference. An entry is one of: a **contract
  payment**; a **KSEB fee** the customer paid, or one **BSS paid for the customer** (a
  separate line, ticked *paid by office*, that never counts towards the contract balance); a
  **refund** (money out — it is deducted from what was received, and can never exceed it);
  or a **write-off** of a negligible balance (admin only, with a required reason; it closes
  the balance without counting as money received). Received / balance / collected % are
  derived in Postgres, so a **commissioned plant with money still outstanding** is a
  first-class, queryable state: a dashboard KPI, a `Commissioned · payment pending`
  filter, and a badge wherever the project is shown.
- **KSEB feasibility & fees** — the feasibility date is captured (automatically when the
  *KSEB Feasibility Clearance* milestone completes). It is valid for **30 days**; every
  further 30-day period until commissioning costs BSS another **₹1,000**, shown per project
  and on the dashboard, with alerts when a week is left, again on the last day, and when a
  new period starts. The customer-paid
  fees are itemised too: feasibility **₹1,000** + registration **₹1,000 per kW + 18% GST**.
- **Coordinator incentives** — the office agrees an incentive **per coordinator** on a
  project (each can get a different amount) and records it **in instalments**, each with its
  date and an optional note; what is left is *pending*. Coordinators see only their own
  (per project and as a summary), the dashboard shows what is still pending (everyone's for
  the office, their own for a coordinator), and a coordinator is notified of each instalment.
- **Service Tickets** — routine 6-month or ad-hoc tickets capturing the full BSS service sheet
  (system, battery, SPV details, post-service SPV string / MPPT readings, resolution, financials).
  Every ticket is **assigned to a service engineer**, who works it from a phone-first worklist
  with one-tap call / Google Maps links.
- **Notifications** — a bell with an unread badge and a small panel on every page, a full
  `/notifications` inbox, live updates over Supabase Realtime, and **browser push** to phones
  and PCs (new work order, approval, payment recorded, ticket assigned / started / completed,
  feasibility expiring or extended, incentive set or paid, being added to a sale, a project
  cancelled, refunded or reinstated). Being taken off a sale appears in the bell and the
  inbox only — it sends no push. Each person gets only what concerns them — every
  coordinator on a shared sale, never someone who is not on it. On iPhone, push works once
  the app is added to the Home Screen (Safari → Share → *Add to Home Screen*, iOS 16.4+).
- **PDF Export** — one click generates a PDF matching the official BSS Solar service form layout.
- **Team Management** — admins can add staff accounts (coordinators, service engineers,
  admins), assign roles, search/filter the team list, and **edit** a member's name, phone,
  e-mail and password (to fix a misspelt name, or to replace a placeholder e-mail with a real
  one). An admin cannot change another admin's or the Super Admin's e-mail or password — the
  login is an account takeover — only the Super Admin can; names must stay unique because
  the bulk import finds coordinators by name.
- **Onboarding import** — admins bulk-load existing projects from a CSV (paste or upload);
  each row creates an approved work order + project at the given stage, including financing,
  feasibility date, advance details (`advance_method`, `advance_date`, `advance_reference`),
  incentives and **any number of dated payments** (`payment_1_*`, `payment_2_*`, … — the
  template shows four; each can be a contract payment, a KSEB fee with `paid_by_office`, a
  `refund` or a `write_off`, whose reason goes in `payment_N_reference`). A sale's incentive
  is `coordinator_incentive` + `incentive_paid_on` for a single coordinator, or explicit
  `incentive_N_coordinator` / `_amount` / `_date` groups — one per instalment, a blank date
  being the still-unpaid part — so each coordinator of a shared sale can have their own
  amount. Dates are read **day-first** (`4/2/25` is 4 February). The `coordinator` cell takes one or
  several people — names or e-mails (`Ravi + Abhijith`) — matched against the team's
  accounts: an exact name, or a first name that is unique; a close-but-wrong spelling is
  only ever *suggested*, never guessed, and a blank cell fails unless a default coordinator
  is chosen on purpose (it starts at *No default*). Rows can be a `custom` plan, or
  `cancelled` / `refunded` with remarks; amounts may be sums (`235000+23500`); dates the
  sheet does not give are never invented. **Check file** validates everything and shows
  which account each name resolved to, with warnings (rows with no consumer number, likely
  duplicates), **without writing anything**; **Import projects** then loads it. Every
  problem in a row is reported together, re-uploads skip rows already imported, and failed
  rows download as a fix-and-retry CSV. **Duplicate uploads are caught:** a row whose
  customer (name compared loosely) and order date match a sale already in the system is
  flagged, a popup says the sheet was already uploaded and when, and **Import** writes
  nothing until the admin chooses to skip those rows (the default) or, after ticking a
  confirmation, to import them again.
- **Find duplicates** (office, *Work orders → Find duplicates*) — finds sales already
  entered more than once (the same KSEB consumer number, or the same customer on the same
  order date), suggests the copy to keep and deletes the extra copies in one go, with a
  *Recently deleted* log underneath. See [Find duplicates](#find-duplicates).
- **Dashboard** — KPI cards (single aggregate query) plus recent-activity tables. Cancelled
  and refunded projects are left out of *Active Projects* and the approved pipeline and
  counted in their own tile.
- **Reports** (office only) — a **monthly management report** for the CEO and the team: sales
  booked (count, value, kW, average), net collections (advances + payments − refunds; KSEB
  fees and write-offs apart), commissioned, cancelled / refunded, service visits and
  incentives paid, each compared with the previous month and the same month last year (the
  current month is compared day-for-day, "1–24 Nov vs 1–24 Oct"). It adds the financial year
  to date (April–March) against last year, a 12-month trend, a by-coordinator table (a shared
  sale is split exactly between its coordinators) and an *as of today* snapshot. Downloads:
  a **PDF** report and **CSV** files of the month's sales, collections and the trend.
- **Services report** (office only, *Reports → Services*) — service visits completed per
  engineer and in total for a month or all time (routine / ad-hoc, charges billed), what each
  engineer has open, in progress and overdue now, a 12-month trend and the list of visits,
  with a CSV download.
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

The demo data includes a few sales that show the newer features: *Harikrishnan Nair*
(shared by Rahul and Priya, with a different incentive for each), *Sreedevi Amma* (a custom
plan, "Inverter + panel", under Arun), *Thomas Kurian* (cancelled, Sneha) and *Ibrahim Kutty*
(refunded, Priya).

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
  scripts/                     # wipe-business-data(-preview).sql, reset-business-data(-preview).sql,
                               # check-schema-sync.mjs
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
    work-orders/               # CRM list, detail, create (plan, coordinators),
                               # duplicates/ (Find duplicates + Recently deleted)
    projects/                  # Board (default) + list, detail (status, incentives)
    tickets/                   # Service tickets (office table / engineer worklist), detail, edit, create
    notifications/             # Inbox
    payments/                  # Payments ledger server actions
    onboarding/                # CSV bulk import
    team/                      # Team list + add / edit member
  app/api/cron/daily           # Scheduled feasibility alerts (Bearer CRON_SECRET)
  app/manifest.ts              # Installable web app manifest
  app/login                    # Staff sign-in (accounts created by admin)
public/brand/                  # Official logo assets from bsssolar.com
```

## Roles & Permissions (RLS summary)

| Resource | Super Admin | Admin | Coordinator | Service Engineer |
| -------- | ----------- | ----- | ----------- | ---------------- |
| Work Orders | Everything + delete (one, or in bulk from *Find duplicates*) | Create/read/update, approve, change who shares a sale, **+ delete** (one, or in bulk)¹ | Create + read/**edit** the sales they are on (details, not amounts or status after approval); add partners to their own *pending* order | — |
| Projects | Everything + delete | Read/update all, approve, cancel / refund / reinstate, **+ delete**¹ | Read the sales they are on (a cancelled or refunded one stays visible, read-only) | — |
| Project Milestones | Update | Update | Read their sales' | — |
| Payments ledger | Record/edit + delete, write off a balance | Record/edit, write off a balance, **+ delete**¹ | Read their sales' | — |
| Feasibility | Set | Set | Read their sales' | — |
| Incentives | Set, record / edit / remove instalments, delete an incentive | Same, **delete an incentive**¹ | Read **their own** only, never a partner's | — |
| Reports (monthly + services) | View + download | View + download | — | — |
| Service Tickets | Full CRUD | Full CRUD | Read tickets on their sales' projects | Read + set *in progress* / *completed* on **their own** only |
| Notifications | Own inbox | Own inbox | Own inbox | Own inbox |
| Team / Profiles | Add + roles + edit anyone; delete coordinators, engineers **and admins** (never the Super Admin seat or themself) | Add + roles (not another admin's role — that is the Super Admin's) + edit (not another admin's or the Super Admin's login); **delete coordinators and engineers**¹ (never an admin, the Super Admin or themself) | Read own profile, and the name, role and phone of whoever shares a sale with them | Read own profile only |
| Deletion log (`deleted_records`) | Read (*Recently deleted*) | Read¹ | — | — |

¹ For now: admins hold the delete permission until the owner takes it back — see
[Making deletes Super Admin-only again](#making-deletes-super-admin-only-again).

### The Super Admin seat

- There is **exactly one**, enforced by a partial unique index on `profiles`.
- The role is **immutable from the app**. It is never offered in a role picker, the
  holder's row renders as a locked badge, and no signed-in user — not an admin, not
  even the Super Admin themselves — can grant, revoke or reassign it. A database
  trigger (`guard_profile_role`) rejects any such change independently of the UI.
- The Super Admin account cannot be deleted by anyone: the app offers no Delete on its
  row, and the database's `profiles_delete` policy refuses it too.
- Appointing or moving the seat is therefore **SQL-only**, via
  [`supabase/production-bootstrap.sql`](supabase/production-bootstrap.sql) — which is
  also the recovery path if the account is lost. The one context the trigger permits
  is a server-side one (`auth.uid()` is `NULL`), matching how every other guard in
  this schema is written.
- The Super Admin can still manage ordinary roles (admin ↔ coordinator) as usual;
  immutability is scoped to the seat itself. Changing an **admin's** role is the Super
  Admin's alone (`guard_profile_role` refuses anyone else), so an admin cannot demote
  another admin — and so cannot get round the rule that only the Super Admin deletes admins.

## Deleting records

Deletes are **permanent** and are for the office: the **Super Admin and, for now, the
Admin** ("deleters"). Coordinators and service engineers delete nothing (a coordinator
can only clear their own read notifications). Every delete asks for confirmation in a
dialog that says what goes with it.

| What | Where | Who | What goes with it |
| ---- | ----- | --- | ----------------- |
| **A whole sale** (work order) | Work order page → *Delete*; project page → *Delete sale*; *Find duplicates* (many at once) | Deleters | Its project and milestones, every ledger entry (payments, KSEB fees, refunds, write-offs), who shares the sale, and every coordinator's incentive with its instalments. Service tickets stay, but lose their link to the project. |
| **A project** | Project page → *Delete project* | Deleters | Its milestones. The work order goes back to **pending** (so "approved ⇒ has a project" always holds, and it can be approved again); the ledger, the coordinators and their incentives stay with the sale; service tickets stay. |
| **A ledger entry** (stage payment, KSEB fee, refund, write-off) | Project page → Payments, the bin on the row; on the work order page while the sale has no project | Deleters | Nothing else. Refused when other entries rely on it: a payment a refund was paid out of, a refund a write-off was sized against. |
| **A coordinator's incentive** | Project page → Coordinator incentives → *Delete …'s incentive* | Deleters | The agreed amount and **every instalment** paid against it, in one go. The person stays on the sale, with no incentive. |
| An incentive instalment | Project page → the instalment's *Remove* | Office (admin-level, unchanged) | Nothing else; the incentive's paid state follows. |
| A service ticket | Ticket page → *Delete ticket* | Office (admin-level, unchanged) | Its service sheet. |
| **A team member** | Team → the bin on their row | Admin: coordinators and service engineers. Super Admin: also admins. | Their sign-in. Refused while they still own or share a sale or hold open tickets (take them off the sales with *Change coordinators*, reassign the tickets); nobody can delete the Super Admin or their own account. |

The rules are enforced twice: in the app (`requireDeleter()`, `teamDeleteAuthority`) and
by Row Level Security (`can_delete()` in every DELETE policy, plus the profile limits in
`profiles_delete`).

### The deletion log

Every delete made by a signed-in person is written to **`deleted_records`** by a trigger:
the table, the row's id, a **full snapshot of the row** (`to_jsonb`), who deleted it (their
id and their name at the time, kept even if their account is deleted later) and when.
Everything removed by one delete — a sale and its project, ledger entries and incentives
— shares one transaction id (`tx`), so it reads as one event.

- Logged: work orders, projects, milestones, ledger entries, service tickets, incentives
  (only when an amount was agreed), incentive instalments, team members, and who shared a
  sale (`work_order_coordinators` — only when the sale itself is deleted; taking someone off
  a sale that stays is an edit, not a delete). A project's snapshot also lists the service
  tickets that were linked to it (`service_ticket_ids`), so the links can be put back. A
  team member is deleted through the auth admin API, so the app writes that row itself.
- Not logged: notifications; nor anything with no signed-in user behind it — the wipe and
  reset scripts, SQL run in the SQL Editor, service-role clean-ups.
- Only deleters can read it (*Recently deleted* on the Find duplicates page shows the last
  50 deletes: when, who, what, and what went with it). Nobody can write, change or delete
  it through the API. The wipe and reset scripts empty it with the rest of the business
  data.
- There is **no restore button**. A deleted sale can be put back from its snapshot with
  SQL — see [DEPLOY.md → Restoring a deleted sale](DEPLOY.md#restoring-a-deleted-sale).

### Find duplicates

*Work orders → Find duplicates* (`/work-orders/duplicates`, deleters only — anyone else is
sent home, and the button is not shown to them) lists every group of sales that look like
the same sale entered more than once:

- **Same consumer number** — the KSEB consumer number, ignoring spaces, `-`, `/` and `.`.
  Placeholders with no real digits (*NA*, *N/A*, *Nil*, *0*) never link sales;
- **Same customer & date** — the same order date and the same customer, names compared
  loosely as the import does (capitals, punctuation, word order, spacing and run-together
  initials ignored: *R.Vijayakumar* = *Vijayakumar R*, *Santhi kumari* = *Santhikumari*;
  a different spelling such as *Vijaykumar* is **not** matched). Two sales with different
  consumer numbers are never linked this way — they are two connections.

Every sale is checked, whatever its status. In each group the copy to keep is suggested
(**Keep**): a live copy before a cancelled or refunded one, then the one with the most
recorded work — the most ledger entries (every kind: payments, KSEB fees, refunds,
write-offs) and service tickets, the most money received, completed, the furthest project
stage, approved over pending over rejected — and finally the newest. The other copies are
ticked, except any that may be a different sale (a name that only matches through another
copy, or a different consumer number), which start unticked (**Kept**). Values that differ
from the suggested copy (total, received, coordinators, status, plan, client name, order
date, consumer number) are highlighted, and ticking the suggested copy turns its badge to
*Suggested keep — will be deleted*. Client names open in a new tab, so checking a copy
never loses your ticks; ticks you change are kept when the page refreshes after a delete.
Review the ticks — **Delete selected** takes every ticked copy on the page, across all
groups; *Reset selection* puts the suggestion back and *Clear selection* unticks
everything (over 500, *Select the first 500* helps) — then press it: the confirmation
totals what goes (sales, projects, ledger entries, tickets that will lose their project
link), warns in red if every copy of a sale is ticked, and needs *I understand these sales
are deleted permanently* ticked. All the ticked sales go in **one transaction** (at most
500 at a time), each with everything a single sale delete takes. If a copy you meant to
keep was deleted elsewhere since the page loaded (another tab or another person), nothing
is deleted and the page refreshes so you can check again. *Recently deleted* below lists
the result.

### Making deletes Super Admin-only again

Admins hold the delete permission **for now**. Taking it back is one switch per layer;
ship both in the same release:

1. **TypeScript** — in [`src/lib/domain/role.ts`](src/lib/domain/role.ts), drop `"admin"`
   from `DELETE_ROLES`:

   ```ts
   export const DELETE_ROLES: UserRole[] = ["superadmin"];
   ```

   Every guard (`requireDeleter()`), button, the Find duplicates entry and the copy that
   names who can delete ("Admin or Super Admin" → "Super Admin", built by
   `deleteRolesLabel()`) follow this list; `teamDeleteAuthority` then refuses every admin.
2. **Database** — a new migration (and the same change in `supabase/schema.sql`, which CI
   checks) that narrows `can_delete()`:

   ```sql
   create or replace function public.can_delete()
   returns boolean language sql security definer stable set search_path = public as $$
     select exists (
       select 1 from profiles
       where id = auth.uid() and role::text in ('superadmin')
     );
   $$;
   ```

   The DELETE policies, `delete_work_orders()`, `delete_coordinator_incentive()` and who
   may read the deletion log all ask `can_delete()`, so nothing else changes. Deleting a
   service ticket and removing a single incentive instalment were admin-level before this
   switch existed and stay so.
3. The tests that pin admins deleting then fail and show what to flip — chiefly the unit
   tests of `role`, `team` and `auth` and of the Team page and table; the integration
   tests `office-deletes`, `deletion-log`, `superadmin-guards`, `payments-ledger` and
   `ledger-adjustments`; and the e2e specs `office-deletes`, `duplicate-cleanup`,
   `superadmin` and `payments-ledger`, which delete as the admin (switch them to the
   Super Admin, and assert that the admin sees no Delete).

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

### Wiping business data

Two scripts for the SQL Editor, each with a read-only preview. Take a backup first.

- [`supabase/scripts/wipe-business-data.sql`](supabase/scripts/wipe-business-data.sql) deletes
  every work order, project, milestone, payment, ticket, coordinator assignment, incentive,
  notification and the deletion log (`deleted_records`) and **keeps every account** (and push
  subscriptions), then restarts the ticket
  numbering. It ships locked — type `WIPE ALL BUSINESS DATA` into its `confirm` line to run
  it — and aborts without deleting anything if a table it does not know about exists or no
  office account would remain. Run
  [`wipe-business-data-preview.sql`](supabase/scripts/wipe-business-data-preview.sql) first.
- [`supabase/scripts/reset-business-data.sql`](supabase/scripts/reset-business-data.sql) does the
  same **and** deletes every user except the e-mails in its keep-list. Run
  [`reset-business-data-preview.sql`](supabase/scripts/reset-business-data-preview.sql) first. It
  aborts without deleting anything if a keep-list e-mail is missing or no office account
  would remain.

Then make sure the team's accounts exist, **Check file**, and bulk-import. See
**[DEPLOY.md](DEPLOY.md)** → *Fresh start*.

## Testing

| Layer | Tool | Command | Needs |
| ----- | ---- | ------- | ----- |
| Unit | Vitest | `npm run test` | — |
| Integration (RLS, triggers, RPCs) | Vitest + local Supabase | `npm run test:integration` | `npx supabase start` |
| End-to-end (critical flows) | Playwright | `npm run test:e2e` | `supabase start` + `npm run build` |

- **Integration tests** exercise real Row Level Security and DB triggers against a
  local Supabase stack — they assert that a coordinator cannot escalate to admin,
  cannot self-approve work orders, tenant data stays isolated, approval seeds the 9
  milestones, ticket numbers are unique, **deletes are refused for anyone but the office**
  (Admin and Super Admin; an admin never deletes another admin, and nobody deletes the
  Super Admin or themself), the bulk delete and the incentive delete are all-or-nothing,
  **every delete is logged** with its snapshot and who made it (and read only by the
  office), the Super Admin seat cannot be duplicated, hijacked, or changed by
  anyone signed in (including its holder) while ordinary role management still works,
  a coordinator's edits surface on their project, the SQL payment, capacity and
  feasibility maths agree with `lib/domain/`, service engineers see and change only their
  own tickets, notifications reach only their recipients, a sale's coordinators (and only
  they) see and edit it while each one's incentive stays private, custom plans and
  cancelled / refunded projects behave in the lists, KPIs and feasibility clock exactly as
  `lib/domain/` says, the views still answer the previous build identically, and the import
  RPC and the wipe and reset scripts behave row by row.
- **E2E** covers login/RBAC redirects, work-order creation and editing, shared
  coordinators, custom plans, cancelled / refunded projects, the payments ledger, KSEB
  feasibility and per-person incentives, the service engineer's phone workflow, the
  notification bell and inbox, the bulk import (including *Check file*), the office's
  deletes (a sale from its work order or project page, a project, a ledger entry, an
  incentive, team members — and who is offered Delete on which row), *Find duplicates*
  (on a desktop and a 360px phone), and the commissioned-but-unpaid dashboard KPI. Every
  spec owns the data it changes — it deletes only what it created — so the suite can be
  re-run without resetting the database.

> `E2E_PORT=3711 npm run test:e2e` runs the suite on another port if 3100 is taken.
- CI (`.github/workflows/ci.yml`) runs all of the above on every PR. See
  **[DEPLOY.md](DEPLOY.md)** for the branch-protection setup that gates merges.

> First E2E/integration run: `npx supabase start` (Docker) and
> `npx playwright install chromium`.

## Deploy to production

See **[DEPLOY.md](DEPLOY.md)** for the full guide (Supabase Cloud + Vercel).
