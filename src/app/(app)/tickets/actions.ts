"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireTicketRole } from "@/lib/auth";
import { profilesRepository, ticketsRepository } from "@/server/data";
import { notify } from "@/server/notifications";
import { ticketTotal } from "@/lib/domain/ticket";
import { isServiceEngineerRole } from "@/lib/domain/role";
import {
  assignmentEvents,
  initialTicketStatus,
  isFieldMove,
  isTicketStatus,
  requiresAssignee,
  statusChangeError,
  ticketUpdateEvents,
} from "@/lib/domain/ticket-workflow";
import { withFlash } from "@/lib/flash";
import { fail, ok, type ActionResult } from "@/lib/result";
import { dec, enumValue, int, json, str, text } from "@/server/form";
import type {
  MpptReading,
  SpvStringReading,
  TicketStatus,
  TicketType,
} from "@/lib/types";

const NOT_FOUND = "This ticket no longer exists.";
const ASSIGNEE_REQUIRED =
  "Choose the service engineer who will handle this ticket.";

/** Redirect back to a form with an inline error (never returns). */
function backWithError(path: string, message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`);
}

/**
 * Tickets may only be held by service engineers. The database enforces this
 * too; checking first turns a constraint error into a message the office can
 * act on.
 */
async function assigneeError(engineerId: string): Promise<string | null> {
  const engineer = await profilesRepository.byId(engineerId);
  if (engineer && isServiceEngineerRole(engineer.role)) return null;
  return "Tickets can only be assigned to a service engineer.";
}

export async function createTicket(formData: FormData) {
  const profile = await requireAdmin();

  const projectId = str(formData.get("project_id"));
  const assignedTo = str(formData.get("assigned_to"));
  const scheduledDate = str(formData.get("scheduled_date"));
  const formPath = projectId
    ? `/tickets/new?project_id=${encodeURIComponent(projectId)}`
    : "/tickets/new";

  if (!assignedTo) backWithError(formPath, ASSIGNEE_REQUIRED);
  const invalidAssignee = await assigneeError(assignedTo);
  if (invalidAssignee) backWithError(formPath, invalidAssignee);

  const status = initialTicketStatus(scheduledDate);
  // ticket_no is assigned by a DB sequence/trigger (collision-free).
  const { id, error } = await ticketsRepository.create({
    project_id: projectId,
    ticket_type: enumValue<TicketType>(formData.get("ticket_type"), "routine_6m"),
    status,
    assigned_to: assignedTo,
    scheduled_date: scheduledDate,
    nature_of_complaint: str(formData.get("nature_of_complaint")),
    created_by: profile.id,
  });

  if (error || !id) {
    backWithError(formPath, error ?? "Failed to create ticket");
  }

  const created = await ticketsRepository.summary(id);
  notify(
    ...assignmentEvents({
      actorId: profile.id,
      ticketId: id,
      ticketNo: created?.ticket_no ?? null,
      clientName: created?.client_name ?? null,
      scheduledDate,
      status,
      previousEngineerId: null,
      engineerId: assignedTo,
    }),
  );

  revalidatePath("/tickets");
  redirect(withFlash(`/tickets/${id}`, "Ticket created and assigned."));
}

export async function updateTicket(formData: FormData) {
  const profile = await requireAdmin();
  const id = text(formData.get("id"));
  const formPath = `/tickets/${id}/edit`;

  const before = await ticketsRepository.summary(id);
  if (!before) redirect(withFlash("/tickets", NOT_FOUND, "error"));

  const rawStatus = formData.get("status");
  const status: TicketStatus = isTicketStatus(rawStatus) ? rawStatus : before.status;
  const assignedTo = str(formData.get("assigned_to"));
  const scheduledDate = str(formData.get("scheduled_date"));

  if (!assignedTo && requiresAssignee(status)) {
    backWithError(
      formPath,
      "Assign a service engineer — every open ticket needs one. Close or cancel it to leave it unassigned.",
    );
  }
  // Only a change is checked, so a legacy assignee can be kept while the rest of
  // the sheet is edited (the DB trigger makes the same distinction).
  if (assignedTo && assignedTo !== before.assigned_to) {
    const invalidAssignee = await assigneeError(assignedTo);
    if (invalidAssignee) backWithError(formPath, invalidAssignee);
  }

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
    status,
    assigned_to: assignedTo,
    scheduled_date: scheduledDate,
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

  if (error) backWithError(formPath, error);

  notify(
    ...ticketUpdateEvents({
      actorId: profile.id,
      ticketId: id,
      ticketNo: before.ticket_no,
      clientName: before.client_name,
      scheduledDate,
      status,
      previousEngineerId: before.assigned_to,
      engineerId: assignedTo,
      previousStatus: before.status,
      previousScheduledDate: before.scheduled_date,
    }),
  );

  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
  redirect(withFlash(`/tickets/${id}`, "Service sheet saved."));
}

/**
 * Quick status change from the field (or the office). Engineers may only start
 * work on / complete their own tickets — checked here against the domain rules,
 * with RLS and the guard trigger as the backstop.
 */
export async function setTicketStatus(
  id: string,
  status: TicketStatus,
): Promise<ActionResult> {
  const profile = await requireTicketRole();
  if (typeof id !== "string" || !id) return fail(NOT_FOUND);
  if (!isTicketStatus(status)) return fail("Unknown ticket status.");

  const isEngineer = isServiceEngineerRole(profile.role);
  // An engineer reads through engineer_tickets(), which only returns their own
  // tickets — so a hit also proves the ticket is assigned to them.
  const current = isEngineer
    ? await ticketsRepository.engineerTicket(id)
    : await ticketsRepository.summary(id);
  if (!current) {
    return fail(isEngineer ? "This ticket is not assigned to you." : NOT_FOUND);
  }

  const refusal = statusChangeError(profile.role, current.status, status);
  if (refusal) return fail(refusal);

  const { error } = await ticketsRepository.setStatus(id, status);
  if (error) return fail(error);

  if (isEngineer) {
    // statusChangeError already confined an engineer to a field move; the
    // guard makes that explicit for the event's narrowed status type.
    if (isFieldMove(status)) {
      notify({
        type: "ticket.status_changed",
        actorId: profile.id,
        actorName: profile.full_name,
        ticketId: id,
        ticketNo: current.ticket_no,
        status,
        clientName: current.client_name,
      });
    }
  } else if ("assigned_to" in current) {
    // The office's read (the narrowing picks it) carries the assignee: tell
    // the engineer holding the ticket.
    notify(
      ...ticketUpdateEvents({
        actorId: profile.id,
        ticketId: id,
        ticketNo: current.ticket_no,
        clientName: current.client_name,
        scheduledDate: current.scheduled_date,
        status,
        previousEngineerId: current.assigned_to,
        engineerId: current.assigned_to,
        previousStatus: current.status,
        previousScheduledDate: current.scheduled_date,
      }),
    );
  }

  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
  return ok(undefined);
}

export async function deleteTicket(formData: FormData) {
  await requireAdmin();
  const id = text(formData.get("id"));

  const { error } = await ticketsRepository.remove(id);
  if (error) redirect(`/tickets/${id}?error=${encodeURIComponent(error)}`);

  revalidatePath("/tickets");
  redirect(withFlash("/tickets", "Ticket deleted."));
}
