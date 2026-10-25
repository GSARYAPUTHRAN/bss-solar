import { toCsv } from "@/lib/csv";
import {
  IMPORT_HEADERS,
  PAYMENT_FIELDS,
  paymentColumn,
  type ImportHeader,
  type PaymentColumn,
} from "./import";

/**
 * The sample CSV offered on the onboarding page: every column, and one row for
 * each case the office meets most — a loan-financed project mid-way through
 * staged payments, a commissioned project with money still due, a fresh
 * booking, a sale shared by two coordinators, a custom plan and a refunded
 * sale. Every row names its coordinator (a blank cell fails unless a default
 * coordinator is chosen), by name or by e-mail. Its rows must always validate
 * (import-template.test.ts).
 */

type TemplateColumn = ImportHeader | PaymentColumn;

const TEMPLATE_PAYMENT_GROUPS = 4;

const TEMPLATE_COLUMNS: TemplateColumn[] = [
  ...IMPORT_HEADERS,
  ...Array.from({ length: TEMPLATE_PAYMENT_GROUPS }, (_, i) =>
    PAYMENT_FIELDS.map((f) => paymentColumn(i + 1, f)),
  ).flat(),
];

const TEMPLATE_ROWS: Partial<Record<TemplateColumn, string>>[] = [
  // In progress on a bank loan, paid in four stages (one of them KSEB fees),
  // feasibility issued and already into its first renewal.
  {
    client_name: "Anand Kumar",
    plant_capacity: "3kW",
    total_cost: "195000",
    client_phone: "+91 98470 11111",
    address: "Vytilla, Kochi, Ernakulam",
    advance_amount: "20000",
    order_date: "2026-06-15",
    coordinator: "Rahul Menon",
    financing_type: "loan",
    loan_bank_name: "State Bank of India",
    consumer_number: "1156789012345",
    kseb_section: "Vytilla",
    notes: "Scaffolding needed for the north array",
    current_stage: "panel_installation",
    is_completed: "no",
    feasibility_date: "2026-08-20",
    coordinator_incentive: "5000",
    payment_1_amount: "40000",
    payment_1_date: "2026-06-30",
    payment_1_method: "upi",
    payment_1_purpose: "contract",
    payment_1_reference: "UPI 441187",
    payment_2_amount: "4540",
    payment_2_date: "2026-07-10",
    payment_2_method: "cash",
    payment_2_purpose: "kseb_fees",
    payment_2_reference: "KSEB feasibility + registration",
    payment_3_amount: "60000",
    payment_3_date: "2026-08-28",
    payment_3_method: "loan_disbursement",
    payment_3_purpose: "contract",
    payment_3_reference: "SBI disbursal 1",
    payment_4_amount: "50000",
    payment_4_date: "2026-09-25",
    payment_4_method: "bank_transfer",
    payment_4_purpose: "contract",
    payment_4_reference: "NEFT SBIN0001234",
  },
  // Commissioned and self-financed, but ₹50,000 still to collect — shows up
  // under "Commissioned · payment pending". Incentive already paid.
  {
    client_name: "Meera Nair",
    plant_capacity: "5kW",
    total_cost: "310000",
    client_phone: "+91 94470 22222",
    address: "TC 14/1023, Kowdiar, Thiruvananthapuram",
    advance_amount: "50000",
    order_date: "2026-03-02",
    coordinator: "Priya Suresh",
    financing_type: "self",
    consumer_number: "1145678054321",
    kseb_section: "Kowdiar",
    notes: "Balance due after subsidy credit",
    is_completed: "yes",
    commissioned_on: "2026-05-05",
    feasibility_date: "2026-04-10",
    coordinator_incentive: "8000",
    incentive_paid_on: "2026-05-20",
    payment_1_amount: "150000",
    payment_1_date: "2026-04-15",
    payment_1_method: "cheque",
    payment_1_reference: "Cheque 004512",
    payment_2_amount: "60000",
    payment_2_date: "2026-05-25",
    payment_2_method: "Bank transfer",
    payment_2_reference: "IMPS 778120",
  },
  // A fresh booking: the required columns and who owns it (an e-mail works as
  // well as a name).
  {
    client_name: "Sreeja Pillai",
    plant_capacity: "2kW",
    total_cost: "130000",
    coordinator: "coord@bsssolar.test",
  },
  // Shared by two coordinators ("&", "and", "," and "+" all separate names), a
  // price written as a sum, and a finished project written as plant_complete.
  // A shared sale carries no incentive here: each person's is set on the
  // project page afterwards.
  {
    client_name: "Joseph Mathew",
    plant_capacity: "3kW+inverter",
    total_cost: "235000+23500",
    order_date: "2026-02-10",
    coordinator: "Rahul Menon & Priya Suresh",
    consumer_number: "1167890123456",
    current_stage: "plant_complete",
    commissioned_on: "2026-03-14",
    payment_1_amount: "140000",
    payment_1_date: "2026-02-10",
    payment_1_method: "bank_transfer",
    payment_2_amount: "118500",
    payment_2_date: "2026-03-14",
    payment_2_method: "bank_transfer",
  },
  // Not a kW plant: a custom plan says what was sold, has no KSEB stages and
  // is finished with "completed" (handed over on commissioned_on).
  {
    client_name: "Rakesh Varma",
    plan_type: "custom",
    plant_capacity: "Inverter + panel",
    total_cost: "23500",
    order_date: "2026-04-20",
    coordinator: "Priya Suresh",
    current_stage: "completed",
    commissioned_on: "2026-04-25",
    payment_1_amount: "23500",
    payment_1_date: "2026-04-20",
    payment_1_method: "upi",
  },
  // Refunded: stays on the books with its payments; the remarks keep the story.
  // A cancelled row needs its order_date, and may leave the capacity and the
  // price blank when they were never written down.
  {
    client_name: "Suma Devi",
    plant_capacity: "3kW",
    total_cost: "235000",
    order_date: "2026-01-13",
    coordinator: "Rahul Menon",
    cancellation: "refunded",
    cancelled_on: "2026-02-20",
    cancellation_remarks: "Booking amount of ₹10,000 refunded by bank transfer on 20 Feb",
    payment_1_amount: "10000",
    payment_1_date: "2026-01-13",
    payment_1_method: "bank_transfer",
  },
];

/** A ready-to-edit sample the admin can download. */
export const IMPORT_TEMPLATE = toCsv([
  TEMPLATE_COLUMNS,
  ...TEMPLATE_ROWS.map((row) => TEMPLATE_COLUMNS.map((c) => row[c] ?? "")),
]);
