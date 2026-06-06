"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

function num(v: FormDataEntryValue | null): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function createWorkOrder(formData: FormData) {
  const profile = await requireProfile();
  const supabase = await createClient();

  // Admins may log on behalf of a coordinator; coordinators log for themselves.
  const selectedCoordinator = String(formData.get("coordinator_id") ?? "");
  const coordinatorId =
    profile.role === "admin" && selectedCoordinator
      ? selectedCoordinator
      : profile.id;

  const payload = {
    coordinator_id: coordinatorId,
    client_name: String(formData.get("client_name") ?? "").trim(),
    client_phone: String(formData.get("client_phone") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    plant_capacity: String(formData.get("plant_capacity") ?? "").trim(),
    advance_amount: num(formData.get("advance_amount")),
    total_cost: num(formData.get("total_cost")),
    order_date:
      String(formData.get("order_date") ?? "") ||
      new Date().toISOString().slice(0, 10),
  };

  const { error } = await supabase.from("work_orders").insert(payload);
  if (error) {
    redirect(`/work-orders/new?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/work-orders");
  redirect("/work-orders");
}

export async function approveWorkOrder(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/work-orders");
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");

  const { data: wo, error: woErr } = await supabase
    .from("work_orders")
    .select("id, coordinator_id, status")
    .eq("id", id)
    .single();

  if (woErr || !wo) {
    redirect(`/work-orders/${id}?error=${encodeURIComponent("Work order not found")}`);
  }

  const { error: updErr } = await supabase
    .from("work_orders")
    .update({ status: "approved" })
    .eq("id", id);
  if (updErr) {
    redirect(`/work-orders/${id}?error=${encodeURIComponent(updErr.message)}`);
  }

  // Create the active project (DB trigger auto-seeds the 8 milestones).
  // Guard against duplicates if approve is pressed twice.
  const { data: existing } = await supabase
    .from("projects")
    .select("id")
    .eq("work_order_id", id)
    .maybeSingle();

  if (!existing) {
    const { error: projErr } = await supabase.from("projects").insert({
      work_order_id: wo.id,
      coordinator_id: wo.coordinator_id,
    });
    if (projErr) {
      redirect(`/work-orders/${id}?error=${encodeURIComponent(projErr.message)}`);
    }
  }

  revalidatePath("/work-orders");
  revalidatePath("/projects");
  revalidatePath(`/work-orders/${id}`);
  redirect(`/work-orders/${id}`);
}

export async function rejectWorkOrder(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/work-orders");
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");

  const { error } = await supabase
    .from("work_orders")
    .update({ status: "rejected" })
    .eq("id", id);
  if (error) {
    redirect(`/work-orders/${id}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/work-orders");
  revalidatePath(`/work-orders/${id}`);
  redirect(`/work-orders/${id}`);
}

export async function deleteWorkOrder(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/work-orders");
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");

  const { error } = await supabase.from("work_orders").delete().eq("id", id);
  if (error) {
    redirect(`/work-orders/${id}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/work-orders");
  redirect("/work-orders");
}
