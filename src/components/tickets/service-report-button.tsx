"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ServiceSheetClient } from "@/lib/pdf";
import type { ServiceTicket } from "@/lib/types";

/**
 * Downloads the printable service sheet. `client` overrides the customer block
 * when the ticket's project is not readable by the viewer — a service engineer
 * gets site details from engineer_tickets(), never from the work order.
 */
export function ServiceReportButton({
  ticket,
  client,
  className,
}: {
  ticket: ServiceTicket;
  client?: ServiceSheetClient | null;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    try {
      setLoading(true);
      // Lazy-load jspdf (a large dependency) only when the user asks for a PDF,
      // so it never ships in the initial client bundle.
      const { generateServicePdf } = await import("@/lib/pdf");
      generateServicePdf(ticket, client ?? undefined);
      toast.success("Service report generated");
    } catch (e) {
      toast.error("Could not generate the PDF. Please try again.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleDownload} disabled={loading} className={className}>
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <FileDown className="mr-2 h-4 w-4" />
      )}
      Download PDF
    </Button>
  );
}
