"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { ticketsRepository } from "@/server/data";
import { ticketTotal } from "@/lib/domain/ticket";
import { withFlash } from "@/lib/flash";
import { dec, enumValue, int, json, str, text } from "@/server/form";
import type {
  MpptReading,
  SpvStringReading,
  TicketStatus,
  TicketType,
} from "@/lib/types";

export async function createTicket(formData: FormData) {
  const profile = await requireAdmin();

  // ticket_no is assigned by a DB sequence/trigger (collision-free).
  const { id, error } = await ticketsRepository.create({
    project_id: str(formData.get("project_id")),
    ticket_type: enumValue<TicketType>(formData.get("ticket_type"), "routine_6m"),
    status: enumValue<TicketStatus>(formData.get("status"), "open"),
    assigned_to: str(formData.get("assigned_to")),
    scheduled_date: str(formData.get("scheduled_date")),
    nature_of_complaint: str(formData.get("nature_of_complaint")),
    created_by: profile.id,
  });

  if (error || !id) {
    redirect(
      `/tickets/new?error=${encodeURIComponent(error ?? "Failed to create ticket")}`,
    );
  }

  revalidatePath("/tickets");
  redirect(withFlash(`/tickets/${id}`, "Ticket created."));
}

export async function updateTicket(formData: FormData) {
  await requireAdmin();
  const id = text(formData.get("id"));

  const spvReadings = json<SpvStringReading[]>(
    formData.get("spv_string_readings"),
    [],
  );
  const mpptReadings = json<MpptReading[]>(formData.get("mppt_readings"), []);

  const serviceCharge = dec(formData.get("service_charge")) ?? 0;
  const costOfSpares = dec(formData.get("cost_of_spares")) ?? 0;
  const amcCharge = dec(formData.get("amc_charge")) ?? 0;

  const { error } = await ticketsRepository.update(id, {
    ticket_type: enumValue<TicketType>(formData.get("ticket_type"), "routine_6m"),
    status: enumValue<TicketStatus>(formData.get("status"), "open"),
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
    total: ticketTotal({ serviceCharge, costOfSpares, amcCharge }),
  });

  if (error) {
    redirect(`/tickets/${id}/edit?error=${encodeURIComponent(error)}`);
  }

  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
  redirect(withFlash(`/tickets/${id}`, "Service sheet saved."));
}

export async function deleteTicket(formData: FormData) {
  await requireAdmin();
  const id = text(formData.get("id"));

  const { error } = await ticketsRepository.remove(id);
  if (error) redirect(`/tickets/${id}?error=${encodeURIComponent(error)}`);

  revalidatePath("/tickets");
  redirect(withFlash("/tickets", "Ticket deleted."));
}
