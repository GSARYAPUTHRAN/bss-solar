import { createClient } from "@/lib/supabase/server";
import type { Payment, PaymentMethod, PaymentPurpose } from "@/lib/types";

/** Explicit columns + the recorder's name (no SELECT *). */
const SELECT = `id, work_order_id, amount, paid_on, method, purpose, reference,
  notes, recorded_by, created_at, updated_at,
  recorder:profiles!payments_recorded_by_fkey(id, full_name)`;

/** The editable body of a ledger entry. */
export interface PaymentInput {
  amount: number;
  paid_on: string;
  method: PaymentMethod;
  purpose: PaymentPurpose;
  reference: string | null;
  notes: string | null;
}

/**
 * The payments ledger. RLS decides who sees and changes what (migration
 * 20261010120200): the office records and corrects, only the SuperAdmin
 * deletes, a coordinator reads the entries on their own work orders. A write
 * filtered out by RLS affects zero rows WITHOUT raising, so every write checks
 * the affected rows and reports instead of claiming a false success.
 */
export const paymentsRepository = {
  /** A work order's ledger in collection order (oldest first). */
  async listForWorkOrder(workOrderId: string): Promise<Payment[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("payments")
      .select(SELECT)
      .eq("work_order_id", workOrderId)
      .order("paid_on", { ascending: true })
      .order("created_at", { ascending: true });
    return (data as unknown as Payment[]) ?? [];
  },

  async byId(id: string): Promise<Payment | null> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("payments")
      .select(SELECT)
      .eq("id", id)
      .maybeSingle();
    return (data as unknown as Payment) ?? null;
  },

  async create(
    workOrderId: string,
    input: PaymentInput,
    recordedBy: string,
  ): Promise<{ id: string | null; error: string | null }> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("payments")
      .insert({ ...input, work_order_id: workOrderId, recorded_by: recordedBy })
      .select("id")
      .maybeSingle();
    if (error) return { id: null, error: error.message };
    if (!data) return { id: null, error: "Payment was not recorded — office staff only." };
    return { id: data.id, error: null };
  },

  async update(id: string, input: PaymentInput): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("payments")
      .update(input)
      .eq("id", id)
      .select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) {
      return { error: "Payment not found, or you cannot edit it." };
    }
    return { error: null };
  },

  async remove(id: string): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("payments")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) {
      return { error: "Nothing was deleted — only the SuperAdmin can delete." };
    }
    return { error: null };
  },
};
