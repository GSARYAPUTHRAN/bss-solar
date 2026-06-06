import { createClient } from "@/lib/supabase/server";
import type { Profile } from "./types";

export async function getCoordinators(): Promise<
  Pick<Profile, "id" | "full_name">[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .order("full_name", { ascending: true });
  return (data as Pick<Profile, "id" | "full_name">[]) ?? [];
}

export interface ProjectOption {
  id: string;
  client_name: string;
  plant_capacity: string;
}

export async function getProjectOptions(): Promise<ProjectOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select(
      `id,
       work_order:work_orders!projects_work_order_id_fkey(client_name, plant_capacity)`,
    )
    .order("created_at", { ascending: false });

  return (
    (data as
      | {
          id: string;
          work_order: { client_name: string; plant_capacity: string } | null;
        }[]
      | null) ?? []
  ).map((p) => ({
    id: p.id,
    client_name: p.work_order?.client_name ?? "Project",
    plant_capacity: p.work_order?.plant_capacity ?? "",
  }));
}
