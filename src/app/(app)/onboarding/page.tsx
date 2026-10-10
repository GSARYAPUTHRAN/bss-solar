import { requireAdmin } from "@/lib/auth";
import { profilesRepository } from "@/server/data";
import { Page, PageHeader, Section } from "@/components/layout";
import { BulkImportForm } from "@/components/bulk-import-form";
import {
  IMPORT_COLUMN_GROUPS,
  IMPORT_ERROR_COLUMN,
  MAX_IMPORT_ROWS,
  PAYMENT_FIELDS,
  REQUIRED_IMPORT_HEADERS,
  type ImportHeader,
  type PaymentField,
} from "@/lib/domain/import";
import {
  FINANCING_VOCABULARY,
  PAYMENT_METHOD_VOCABULARY,
  PAYMENT_PURPOSE_VOCABULARY,
  STAGE_VOCABULARY,
} from "@/lib/domain/import-cells";
import { KSEB_FEES } from "@/lib/domain/kseb";
import { ROLE_LABELS, WORK_ORDER_OWNER_ROLES } from "@/lib/domain/role";
import { formatCurrency } from "@/lib/format";

export const metadata = { title: "Onboarding — Import Projects" };

const FEASIBILITY_DAYS = KSEB_FEES.feasibilityValidityDays;
const RENEWAL_FEE = formatCurrency(KSEB_FEES.feasibilityRenewalFee);

/** What each column holds. Typed by the header list, so none can go undocumented. */
const COLUMN_HINTS: Record<ImportHeader, string> = {
  client_name: "Customer's name.",
  plant_capacity: "With a number in it: 3kW, 5 kWp or 3000W. KSEB fees are priced from it.",
  total_cost: "Contract value in rupees.",
  client_phone: "Customer's phone.",
  address: "Site address.",
  advance_amount: "Booking advance in rupees. Blank is 0.",
  order_date: "Date the order was booked. Blank is today.",
  coordinator_email:
    "Login e-mail of the coordinator who owns the project. Blank uses the default coordinator; an e-mail that matches no coordinator or office account fails the row.",
  financing_type: "loan or self. Blank is self, or loan when a bank is named.",
  loan_bank_name: "Lending bank, for loan-financed plants.",
  consumer_number:
    "KSEB consumer number. Used to skip projects that are already in the system — a row without one is imported again on every upload.",
  kseb_section: "KSEB section office.",
  notes: "Anything else the office should know.",
  current_stage: "Stage the project is at now. Blank is the first stage.",
  is_completed: "yes when the plant is commissioned — every milestone is marked done.",
  commissioned_on:
    "Commissioning date. Required for a commissioned project with a feasibility_date, because it stops the feasibility clock. A date here on its own also marks the project commissioned.",
  feasibility_date: `Date KSEB issued feasibility. It is valid for ${FEASIBILITY_DAYS} days; every further ${FEASIBILITY_DAYS}-day period until commissioning costs BSS ${RENEWAL_FEE}.`,
  coordinator_incentive: "Incentive for the coordinator on this project, in rupees.",
  incentive_paid_on: "Date the incentive was paid. Needs coordinator_incentive.",
};

const PAYMENT_HINTS: Record<PaymentField, string> = {
  amount: "Rupees, more than zero. Required once any cell of the group is filled.",
  date: "Date received. Required once any cell of the group is filled.",
  method: "How it was paid. Blank is other.",
  purpose:
    "contract counts towards the contract; kseb_fees records KSEB charges collected and does not. Blank is contract.",
  reference: "Cheque number, UTR or UPI reference.",
};

const REQUIRED = new Set<string>(REQUIRED_IMPORT_HEADERS);

export default async function OnboardingPage() {
  const me = await requireAdmin();
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
          <BulkImportForm coordinators={coordinators} defaultCoordinatorId={me.id} />
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
                commissioned_on is filled.
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
        The header row is checked first. Unknown columns are refused with a suggestion;
        the old <Code>first_payment_*</Code> / <Code>second_payment_*</Code> columns are
        now <Code>payment_1_*</Code> / <Code>payment_2_*</Code>.
      </li>
      <li>
        Every problem in a row is listed together, and the other rows still import. A
        row goes in completely or not at all.
      </li>
      <li>
        Dates are YYYY-MM-DD and none may be in the future. Amounts are in rupees; the
        advance plus contract payments may not exceed total_cost.
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
