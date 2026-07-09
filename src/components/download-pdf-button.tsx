"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ServiceTicket } from "@/lib/types";

export function DownloadPdfButton({ ticket }: { ticket: ServiceTicket }) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    try {
      setLoading(true);
      // Lazy-load jspdf (a large dependency) only when the user asks for a PDF,
      // so it never ships in the initial client bundle.
      const { generateServicePdf } = await import("@/lib/pdf");
      generateServicePdf(ticket);
      toast.success("Service report generated");
    } catch (e) {
      toast.error("Failed to generate PDF");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleDownload} disabled={loading}>
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <FileDown className="mr-2 h-4 w-4" />
      )}
      Download PDF
    </Button>
  );
}
