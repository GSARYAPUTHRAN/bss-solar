import { normalizeCoordinatorIds } from "@/lib/domain/coordinators";

/**
 * The coordinators a form names, in the order the person arranged them: one
 * hidden `coordinator_ids` input per row. Trimmed, anything that is not an
 * account id dropped, duplicates removed (the first occurrence wins), so the
 * list that reaches the rules is always a clean, ordered set of ids.
 */
export function readCoordinatorIds(
  formData: FormData,
  field: string = "coordinator_ids",
): string[] {
  return normalizeCoordinatorIds(formData.getAll(field).map((value) => String(value)));
}
