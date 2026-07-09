"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCsvRecords } from "@/lib/csv";
import {
  parseImportRecord,
  IMPORT_INITIAL,
  type ImportRowResult,
  type ImportState,
} from "@/lib/domain/import";
import { PROJECT_STAGES } from "@/lib/constants";
import type { MilestoneStatus, ProjectStage } from "@/lib/types";

const MAX_ROWS = 1000;

type AdminClient = ReturnType<typeof createAdminClient>;

async function applyStage(
  admin: AdminClient,
  projectId: string,
  stage: ProjectStage,
  isCompleted: boolean,
  stageOrder: Map<ProjectStage, number>,
) {
  const targetOrder = stageOrder.get(stage) ?? 1;
  const { data: milestones } = await admin
    .from("project_milestones")
    .select("id, sort_order")
    .eq("project_id", projectId);
  if (!milestones) return;

  const nowIso = new Date().toISOString();
  const completedIds = milestones
    .filter((m) => isCompleted || m.sort_order < targetOrder)
    .map((m) => m.id);
  const inProgressId = isCompleted
    ? null
    : (milestones.find((m) => m.sort_order === targetOrder)?.id ?? null);

  if (completedIds.length) {
    await admin
      .from("project_milestones")
      .update({ status: "completed" as MilestoneStatus, completed_at: nowIso })
      .in("id", completedIds);
  }
  if (inProgressId) {
    await admin
      .from("project_milestones")
      .update({ status: "in_progress" as MilestoneStatus, completed_at: null })
      .eq("id", inProgressId);
  }
  await admin
    .from("projects")
    .update({
      current_stage: stage,
      is_completed: isCompleted,
      completed_at: isCompleted ? nowIso : null,
    })
    .eq("id", projectId);
}

export async function importProjects(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  await requireAdmin();
  try {
    return await runImport(formData);
  } catch (e) {
    return {
      ...IMPORT_INITIAL,
      ran: true,
      error: e instanceof Error ? e.message : "Import failed unexpectedly.",
    };
  }
}

async function runImport(formData: FormData): Promise<ImportState> {
  const csv = String(formData.get("csv") ?? "");
  const defaultCoordinatorId = String(
    formData.get("default_coordinator_id") ?? "",
  );

  if (!csv.trim()) {
    return { ...IMPORT_INITIAL, ran: true, error: "Paste CSV or choose a file first." };
  }
  if (!defaultCoordinatorId) {
    return { ...IMPORT_INITIAL, ran: true, error: "Select a default coordinator." };
  }

  const parsed = parseCsvRecords(csv);
  if ("error" in parsed) {
    return { ...IMPORT_INITIAL, ran: true, error: parsed.error };
  }
  const records = parsed.records;
  if (records.length === 0) {
    return { ...IMPORT_INITIAL, ran: true, error: "No data rows found below the header." };
  }
  if (records.length > MAX_ROWS) {
    return {
      ...IMPORT_INITIAL,
      ran: true,
      error: `Too many rows (${records.length}). Import up to ${MAX_ROWS} at a time.`,
    };
  }

  let admin: AdminClient | null = null;
  let adminErr = "Admin client unavailable";
  try {
    admin = createAdminClient();
  } catch (e) {
    adminErr = e instanceof Error ? e.message : adminErr;
  }
  if (!admin) return { ...IMPORT_INITIAL, ran: true, error: adminErr };

  // Map coordinator_email -> profile id (profile id === auth user id).
  const emailToId = new Map<string, string>();
  try {
    for (let page = 1; page <= 20; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      const users = data?.users ?? [];
      for (const u of users) {
        if (u.email) emailToId.set(u.email.toLowerCase(), u.id);
      }
      if (users.length < 200) break;
    }
  } catch {
    // Fall back to the default coordinator for every row.
  }

  const stageOrder = new Map<ProjectStage, number>(
    PROJECT_STAGES.map((s, i) => [s.value, i + 1]),
  );

  const results: ImportRowResult[] = [];
  let imported = 0;

  for (let i = 0; i < records.length; i++) {
    const rowNo = i + 2; // 1-based + header row
    const label = records[i].client_name || `Row ${rowNo}`;
    const parsedRow = parseImportRecord(records[i]);
    if ("error" in parsedRow) {
      results.push({ row: rowNo, client: label, ok: false, message: parsedRow.error });
      continue;
    }
    const r = parsedRow.data;
    const coordinatorId =
      (r.coordinator_email && emailToId.get(r.coordinator_email)) ||
      defaultCoordinatorId;

    try {
      const wo = await admin
        .from("work_orders")
        .insert({
          coordinator_id: coordinatorId,
          client_name: r.client_name,
          client_phone: r.client_phone,
          address: r.address,
          plant_capacity: r.plant_capacity,
          advance_amount: r.advance_amount,
          total_cost: r.total_cost,
          order_date: r.order_date,
          status: "approved",
        })
        .select("id")
        .single();
      if (wo.error || !wo.data) {
        throw new Error(wo.error?.message ?? "work order insert failed");
      }

      const pr = await admin
        .from("projects")
        .insert({ work_order_id: wo.data.id, coordinator_id: coordinatorId })
        .select("id")
        .single();
      if (pr.error || !pr.data) {
        throw new Error(pr.error?.message ?? "project insert failed");
      }

      await applyStage(admin, pr.data.id, r.current_stage, r.is_completed, stageOrder);
      imported++;
      results.push({
        row: rowNo,
        client: label,
        ok: true,
        message: r.is_completed
          ? "Imported — commissioned"
          : `Imported at "${r.current_stage}"`,
      });
    } catch (e) {
      results.push({
        row: rowNo,
        client: label,
        ok: false,
        message: e instanceof Error ? e.message : "import failed",
      });
    }
  }

  if (imported > 0) {
    revalidatePath("/projects");
    revalidatePath("/work-orders");
    revalidatePath("/");
  }

  return { ran: true, imported, failed: records.length - imported, results };
}
