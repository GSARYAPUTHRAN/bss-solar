import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ServiceTicketForm } from "@/components/service-ticket-form";
import type { ServiceTicket } from "@/lib/types";

export default async function EditTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("service_tickets")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const ticket = data as ServiceTicket;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Service Sheet — ${ticket.ticket_no ?? ""}`}
        description="Capture the technical field measurements and resolution."
      >
        <Button variant="outline" asChild>
          <Link href={`/tickets/${ticket.id}`}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Link>
        </Button>
      </PageHeader>

      {error && (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <ServiceTicketForm ticket={ticket} />
    </div>
  );
}
