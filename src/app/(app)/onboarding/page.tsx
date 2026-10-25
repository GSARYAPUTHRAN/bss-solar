import { requireAdmin } from "@/lib/auth";
import { profilesRepository } from "@/server/data";
import { Page, PageHeader, Section } from "@/components/layout";
import { BulkImportForm } from "@/components/bulk-import-form";
import { CANCELLATION_REMARKS_MAX } from "@/lib/domain/cancellation";
import { MAX_SALE_COORDINATORS } from "@/lib/domain/coordinators";
import {
  IMPORT_COLUMN_GROUPS,
  IMPORT_ERROR_COLUMN,
  IMPORT_HEADER_ALIASES,
  MAX_IMPORT_ROWS,
  NOT_RECORDED_LABEL,
  PAYMENT_FIELDS,
  REQUIRED_IMPORT_HEADERS,
  type ImportHeader,
  type PaymentField,
} from "@/lib/domain/import";
import {
  CANCELLATION_VOCABULARY,
  COMPLETION_ALIASES,
  FINANCING_VOCABULARY,
  PAYMENT_METHOD_VOCABULARY,
  PAYMENT_PURPOSE_VOCABULARY,
  PLAN_VOCABULARY,
  STAGE_VOCABULARY,
} from "@/lib/domain/import-cells";
import { KSEB_FEES } from "@/lib/domain/kseb";
import { PLAN_LABEL_MAX } from "@/lib/domain/plan";
import { ROLE_LABELS, WORK_ORDER_OWNER_ROLES } from "@/lib/domain/role";
import { formatCurrency } from "@/lib/format";

export const metadata = { title: "Onboarding — Import Projects" };

const FEASIBILITY_DAYS = KSEB_FEES.feasibilityValidityDays;
const RENEWAL_FEE = formatCurrency(KSEB_FEES.feasibilityRenewalFee);

/** The names a column also goes by, from the importer's own alias list. */
function aliasesOf(column: ImportHeader): string {
  return Object.entries(IMPORT_HEADER_ALIASES)
    .filter(([, canonical]) => canonical === column)
    .map(([alias]) => alias)
    .join(", ");
}

/** What each column holds. Typed by the header list, so none can go undocumented. */
const COLUMN_HINTS: Record<ImportHeader, string> = {
  client_name: "Customer's name.",
  plant_capacity: `For a solar plant: a number with its unit — 3kW, 5 kWp or 3000W. KSEB fees are priced from it. For plan_type custom: what was sold, up to ${PLAN_LABEL_MAX} characters (1 panel, Inverter + panel). A cancelled or refunded row may leave it blank — it is stored as "${NOT_RECORDED_LABEL}".`,
  total_cost:
    "Contract value in rupees. A sum is fine: 235000+23500. A cancelled or refunded row may leave it blank — it is stored as 0, unless advance_amount is filled: then give the total, or clear the advance.",
  client_phone: "Customer's phone.",
  address: "Site address.",
  advance_amount: "Booking advance in rupees (a sum is fine). Blank is 0.",
  order_date:
    "Date the order was booked. Blank is today — the row still imports, but it is flagged. Required for a cancelled or refunded row.",
  coordinator: `Who owns the sale: a full name, a first name that only one coordinator or office account has, or a login e-mail. Several people share it when joined by +, &, "and", a comma, ; or / — Ravi + Abhijith (up to ${MAX_SALE_COORDINATORS}; the first is the first coordinator). Text in brackets is a remark and is kept in the notes. A name that is only close (Abhijit for Abhijith) is refused with a suggestion, never assumed. Blank uses the default coordinator, or fails when none is chosen. Also accepted as the column name: ${aliasesOf("coordinator")}.`,
  plan_type: `solar (the default) or custom. A custom plan — 1 panel, Inverter + panel — is not a kW plant: no KSEB estimate, no feasibility date and a single Handover step. Also accepted as the column name: ${aliasesOf("plan_type")}.`,
  financing_type: "loan or self. Blank is self, or loan when a bank is named.",
  loan_bank_name: "Lending bank, for loan-financed plants.",
  consumer_number:
    "KSEB consumer number. Used to skip projects that are already in the system — a row without one is imported again on every upload. Of several rows in one file with the same number, only the first is imported.",
  kseb_section: "KSEB section office.",
  notes: "Anything else the office should know.",
  current_stage:
    "Stage the project is at now, by key or label (below). Write completed — or plant_complete, commissioned, handed over — for a finished project. Blank is the first stage (a custom plan's Handover step). Never cancelled: that goes in the cancellation column.",
  is_completed:
    "yes when the plant is commissioned — every milestone is marked done. Blank is yes when commissioned_on is filled or current_stage says completed.",
  commissioned_on:
    "Commissioning date. Required for a commissioned project with a feasibility_date, because it stops the feasibility clock. A date here on its own also marks the project commissioned. Left blank, the date is recorded as not recorded — the import never invents one.",
  cancellation:
    "cancelled or refunded. Blank (or active) is a live project. The project keeps its stage and its payments; it simply leaves the active pipeline.",
  cancelled_on:
    "Date it was cancelled or refunded, not before order_date. Required when there is a feasibility_date (it stops the feasibility clock); otherwise blank is recorded as not recorded. Needs cancellation.",
  cancellation_remarks: `Up to ${CANCELLATION_REMARKS_MAX.toLocaleString("en-IN")} characters: the refund amount and mode, the reason. Needs cancellation.`,
  feasibility_date: `Date KSEB issued feasibility. It is valid for ${FEASIBILITY_DAYS} days; every further ${FEASIBILITY_DAYS}-day period until commissioning costs BSS ${RENEWAL_FEE}. Not for a custom plan.`,
  coordinator_incentive:
    "Incentive for the coordinator on this project, in rupees. Only on a row that names one coordinator itself: a shared sale's incentives are set on the project page afterwards, and a row that took the default coordinator cannot carry one.",
  incentive_paid_on: "Date the incentive was paid. Needs coordinator_incentive.",
};

const PAYMENT_HINTS: Record<PaymentField, string> = {
  amount: "Rupees, more than zero (a sum is fine). Required once any cell of the group is filled.",
  date: "Date received. Required once any cell of the group is filled.",
  method: "How it was paid. Blank is other.",
  purpose:
    "contract counts towards the contract; kseb_fees records KSEB charges collected and does not. Blank is contract.",
  reference: "Cheque number, UTR or UPI reference.",
};

const REQUIRED = new Set<string>(REQUIRED_IMPORT_HEADERS);

export default async function OnboardingPage() {
  await requireAdmin();
  const members = await profilesRepository.list();
  // import_projects refuses any other owner, so never offer one.
  const coordinators = members
    .filter((m) => WORK_ORDER_OWNER_ROLES.includes(m.role))
    .map((m) => ({ value: m.id, label: `${m.full_name} · ${ROLE_LABELS[m.role]}` }));

  return (
    <Page size="wide">
      <PageHeader
        title="Onboarding — Import Existing Projects"
        description="Bring existing installations into the system in bulk. Each row becomes an approved work order and a project at the stage you give, with its payments in the ledger."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Import" className="lg:col-span-2">
          <BulkImportForm coordinators={coordinators} />
        </Section>
        <Section title="How it works" className="lg:col-span-1">
          <HowItWorks />
        </Section>
      </div>

      <Section
        title="Column reference"
        description="Only the three required columns must be present. Any other column may be left out or left blank. Headers are not case-sensitive."
        contentClassName="space-y-6"
      >
        <div className="grid gap-6 md:grid-cols-2">
          {IMPORT_COLUMN_GROUPS.map((group) => (
            <ColumnGroup key={group.title} title={group.title}>
              {group.columns.map((name) => (
                <ColumnDoc
                  key={name}
                  name={name}
                  hint={COLUMN_HINTS[name]}
                  required={REQUIRED.has(name)}
                />
              ))}
            </ColumnGroup>
          ))}
          <ColumnGroup
            title="Payments"
            intro={
              <>
                One group of columns per payment after the advance:{" "}
                <Code>payment_1_amount</Code>, <Code>payment_1_date</Code>, …, then{" "}
                <Code>payment_2_…</Code> and so on. Add as many groups as needed — a
                customer may pay in 3 stages or 8. Rows with fewer payments leave the
                extra groups blank.
              </>
            }
          >
            {PAYMENT_FIELDS.map((field) => (
              <ColumnDoc
                key={field}
                name={`payment_N_${field}`}
                hint={PAYMENT_HINTS[field]}
              />
            ))}
          </ColumnGroup>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Accepted values</h3>
          <dl className="grid gap-4 text-sm md:grid-cols-2">
            <AcceptedValues column="plan_type" spellings={PLAN_VOCABULARY.spellings} />
            <AcceptedValues column="cancellation" spellings={CANCELLATION_VOCABULARY.spellings} />
            <AcceptedValues column="financing_type" spellings={FINANCING_VOCABULARY.spellings} />
            <AcceptedValues
              column="payment_N_purpose"
              spellings={PAYMENT_PURPOSE_VOCABULARY.spellings}
            />
            <AcceptedValues
              column="payment_N_method"
              spellings={PAYMENT_METHOD_VOCABULARY.spellings}
            />
            <div className="space-y-1">
              <dt className="font-mono text-xs font-medium">is_completed</dt>
              <dd className="text-muted-foreground">
                yes / true / y / 1, or no / false / n / 0. Blank is no, unless
                commissioned_on is filled or current_stage says completed.
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="font-mono text-xs font-medium">current_stage — finished</dt>
              <dd className="text-muted-foreground">
                {COMPLETION_ALIASES.map((a, i) => (
                  <span key={a}>
                    {i > 0 && ", "}
                    <Code>{a}</Code>
                  </span>
                ))}{" "}
                all mean the project is commissioned (a custom plan: handed over).
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="font-mono text-xs font-medium">amounts</dt>
              <dd className="text-muted-foreground">
                Rupees, up to 2 decimals; ₹, Rs. and commas are fine. A sum adds its parts:{" "}
                <Code>235000+23500</Code>, <Code>₹1,000 + Rs. 500</Code>. Every part must be
                a plain amount.
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="font-mono text-xs font-medium">coordinator</dt>
              <dd className="text-muted-foreground">
                <Code>Ravi</Code>, <Code>Ravi Kumar</Code>, <Code>ravi@bsssolar.in</Code>,{" "}
                <Code>Ravi + Abhijith</Code>, <Code>Ravi &amp; Abhijith</Code>,{" "}
                <Code>sudheesh(sheeja)</Code> — the bracket is kept in the notes, not
                matched.
              </dd>
            </div>
          </dl>
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer py-1 text-sm font-medium">
              current_stage — every stage, by key or label
            </summary>
            <dl className="mt-3 space-y-2 text-sm">
              {Object.entries(STAGE_VOCABULARY.spellings).map(([key, [, label]]) => (
                <div key={key} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                  <dt className="font-mono text-xs break-all sm:w-56 sm:shrink-0">{key}</dt>
                  <dd className="text-muted-foreground">{label}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-muted-foreground">
              A custom plan has no KSEB stages: leave current_stage blank (open at its
              Handover step) or write completed.
            </p>
          </details>
        </div>
      </Section>
    </Page>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs break-all text-foreground">{children}</span>;
}

function HowItWorks() {
  return (
    <ol className="list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
      <li>
        Download the template, or export your sheet as <strong>CSV UTF-8</strong>. Format
        the consumer number and phone columns as Text first, or Excel rounds them.
      </li>
      <li>
        Press <strong>Check file</strong> first. It validates every row, shows who each
        coordinator name became and lists anything worth a look — and writes nothing.
        Then press <strong>Import projects</strong>.
      </li>
      <li>
        The header row is checked first. Unknown columns are refused with a suggestion;
        the old <Code>first_payment_*</Code> / <Code>second_payment_*</Code> columns are
        now <Code>payment_1_*</Code> / <Code>payment_2_*</Code>. Sheets that name the
        coordinator column <Code>coordinator_email</Code> still load.
      </li>
      <li>
        Every problem in a row is listed together, and the other rows still import. A
        row goes in completely or not at all.
      </li>
      <li>
        Dates are YYYY-MM-DD and none may be in the future. Amounts are in rupees; the
        advance plus contract payments may not exceed total_cost. The import never
        invents a date: an unknown commissioning date stays unknown.
      </li>
      <li>
        Up to {MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows per file. Download the
        failed rows, fix them and upload that file, not the whole sheet: only rows
        with a consumer number are recognised as already imported. Its{" "}
        <Code>{IMPORT_ERROR_COLUMN}</Code> column is ignored.
      </li>
    </ol>
  );
}

function ColumnGroup({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {intro && <p className="text-sm text-muted-foreground">{intro}</p>}
      <dl className="space-y-2">{children}</dl>
    </div>
  );
}

function ColumnDoc({
  name,
  hint,
  required,
}: {
  name: string;
  hint: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="font-mono text-xs font-medium break-all">
        {name}
        {required && <span className="ml-1.5 font-sans text-destructive">required</span>}
      </dt>
      <dd className="text-sm text-muted-foreground">{hint}</dd>
    </div>
  );
}

function AcceptedValues<K extends string>({
  column,
  spellings,
}: {
  column: string;
  spellings: Record<K, string[]>;
}) {
  return (
    <div className="space-y-1">
      <dt className="font-mono text-xs font-medium">{column}</dt>
      <dd>
        <ul className="space-y-0.5 text-muted-foreground">
          {(Object.entries(spellings) as [K, string[]][]).map(([key, [, ...others]]) => (
            <li key={key}>
              <Code>{key}</Code>
              {others.length > 0 && <> — also {others.join(", ")}</>}
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}
