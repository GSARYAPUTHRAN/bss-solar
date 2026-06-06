import Link from "next/link";
import { Plus } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { TicketsTable } from "@/components/tickets-table";
import type { ServiceTicket } from "@/lib/types";

export default async function TicketsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const isAdmin = profile.role === "admin";

  const { data } = await supabase
    .from("service_tickets")
    .select(
      `*,
       project:projects!service_tickets_project_id_fkey(
         id,
         work_order:work_orders!projects_work_order_id_fkey(client_name, address, client_phone)
       )`,
    )
    .order("created_at", { ascending: false });

  const tickets = (data as ServiceTicket[]) ?? [];

  return (
    <div>
      <PageHeader
        title="Service Tickets"
        description="Maintenance, 6-month checks and ad-hoc service requests."
      >
        {isAdmin && (
          <Button asChild>
            <Link href="/tickets/new">
              <Plus className="mr-2 h-4 w-4" /> New Ticket
            </Link>
          </Button>
        )}
      </PageHeader>

      <TicketsTable tickets={tickets} />
    </div>
  );
}
