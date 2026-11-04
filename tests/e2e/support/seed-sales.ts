/**
 * The demo sales supabase/seed.sql adds for the ledger-adjustments release
 * (2026-11-04), by the names the app shows. Specs look them up by client name;
 * the ids are for URLs (`/work-orders/<workOrderId>`, `/projects/<projectId>`).
 * Amounts are rupees; dates in the seed are relative to the day it was loaded.
 *
 * The seed's earlier sales (Anand Kumar … Ibrahim Kutty) are unchanged.
 */
export interface SeedSale {
  /** As the app shows it. */
  client: string;
  workOrderId: string;
  projectId: string;
  /** Who logged the sale (an ACCOUNTS key in ./accounts). */
  coordinator: "rahul" | "priya";
}

/**
 * Commissioned and settled: the customer paid ₹3,10,000 against ₹3,00,000 and
 * ₹10,000 went back as a REFUND, so the net received is exactly the contract.
 *   advance ₹40,000 by UPI (reference UPI 4410021199), contract ₹1,50,000 +
 *   ₹1,20,000, KSEB registration ₹4,720 paid by the customer through BSS.
 *   Rahul's incentive: ₹6,000 agreed, ₹4,000 paid in two ₹2,000 instalments
 *   (₹2,000 still to pay).
 */
export const REFUNDED_OVERPAYMENT: SeedSale = {
  client: "Gopinathan Pillai",
  workOrderId: "10000000-0000-0000-0000-000000000019",
  projectId: "20000000-0000-0000-0000-000000000014",
  coordinator: "rahul",
};

/**
 * Commissioned and settled by a WRITE-OFF: ₹1,75,000 sold, ₹1,74,200 collected
 * (advance ₹15,000 by bank transfer, then ₹1,59,200), ₹800 written off
 * ("Customer was ₹800 short at handover; waived by the office"). KSEB fees of
 * ₹5,720 were paid by the BSS office on the customer's behalf. Priya's
 * incentive: ₹3,500 agreed and paid in two instalments (₹2,000 + ₹1,500).
 */
export const WRITTEN_OFF_SHORTFALL: SeedSale = {
  client: "Sathyan Nambiar",
  workOrderId: "10000000-0000-0000-0000-000000000020",
  projectId: "20000000-0000-0000-0000-000000000015",
  coordinator: "priya",
};
