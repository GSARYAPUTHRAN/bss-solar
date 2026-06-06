"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import type { MpptReading, SpvStringReading, TicketStatus, TicketType } from "@/lib/types";

function str(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}
function int(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}
function dec(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function genTicketNo(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `BSS-${yy}${mm}-${rand}`;
}

export async function createTicket(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/tickets");
  const supabase = await createClient();

  const payload = {
    project_id: str(formData.get("project_id")),
    ticket_no: genTicketNo(),
    ticket_type: (String(formData.get("ticket_type") ?? "routine_6m") as TicketType),
    status: (String(formData.get("status") ?? "open") as TicketStatus),
    assigned_to: str(formData.get("assigned_to")),
    scheduled_date: str(formData.get("scheduled_date")),
    nature_of_complaint: str(formData.get("nature_of_complaint")),
    created_by: profile.id,
  };

  const { data, error } = await supabase
    .from("service_tickets")
    .insert(payload)
    .select("id")
    .single();

  if (error || !data) {
    redirect(`/tickets/new?error=${encodeURIComponent(error?.message ?? "Failed to create ticket")}`);
  }

  revalidatePath("/tickets");
  redirect(`/tickets/${data.id}`);
}

export async function updateTicket(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/tickets");
  const supabase = await createClient();

  const id = String(formData.get("id") ?? "");

  let spvReadings: SpvStringReading[] = [];
  let mpptReadings: MpptReading[] = [];
  try {
    spvReadings = JSON.parse(String(formData.get("spv_string_readings") ?? "[]"));
  } catch {
    spvReadings = [];
  }
  try {
    mpptReadings = JSON.parse(String(formData.get("mppt_readings") ?? "[]"));
  } catch {
    mpptReadings = [];
  }

  const serviceCharge = dec(formData.get("service_charge")) ?? 0;
  const costOfSpares = dec(formData.get("cost_of_spares")) ?? 0;
  const amcCharge = dec(formData.get("amc_charge")) ?? 0;

  const payload = {
    ticket_type: String(formData.get("ticket_type") ?? "routine_6m") as TicketType,
    status: String(formData.get("status") ?? "open") as TicketStatus,
    scheduled_date: str(formData.get("scheduled_date")),
    service_date: str(formData.get("service_date")),

    sys_capacity: str(formData.get("sys_capacity")),
    sys_loading_capacity: str(formData.get("sys_loading_capacity")),
    sys_make: str(formData.get("sys_make")),
    sys_model: str(formData.get("sys_model")),
    sys_serial_no: str(formData.get("sys_serial_no")),

    bat_capacity_ah: str(formData.get("bat_capacity_ah")),
    bat_make: str(formData.get("bat_make")),
    bat_model: str(formData.get("bat_model")),
    bat_qty: int(formData.get("bat_qty")),
    bat_bank_nos: int(formData.get("bat_bank_nos")),

    spv_module_capacity: str(formData.get("spv_module_capacity")),
    spv_make: str(formData.get("spv_make")),
    spv_voc: str(formData.get("spv_voc")),
    spv_total_nos: int(formData.get("spv_total_nos")),
    spv_total_watts: dec(formData.get("spv_total_watts")),
    spv_no_of_strings: int(formData.get("spv_no_of_strings")),

    spv_string_readings: spvReadings,
    mppt_readings: mpptReadings,
    battery_voltage: str(formData.get("battery_voltage")),
    charging_current: str(formData.get("charging_current")),
    battery_water_level: str(formData.get("battery_water_level")),

    nature_of_complaint: str(formData.get("nature_of_complaint")),
    defects_found: str(formData.get("defects_found")),
    action_taken: str(formData.get("action_taken")),

    service_charge: serviceCharge,
    cost_of_spares: costOfSpares,
    amc_charge: amcCharge,
    total: serviceCharge + costOfSpares + amcCharge,
  };

  const { error } = await supabase
    .from("service_tickets")
    .update(payload)
    .eq("id", id);

  if (error) {
    redirect(`/tickets/${id}/edit?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
  redirect(`/tickets/${id}`);
}

export async function deleteTicket(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/tickets");
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");

  const { error } = await supabase.from("service_tickets").delete().eq("id", id);
  if (error) {
    redirect(`/tickets/${id}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/tickets");
  redirect("/tickets");
}
