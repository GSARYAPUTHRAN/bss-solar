"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateServicePdf } from "@/lib/pdf";
import type { ServiceTicket } from "@/lib/types";

export function DownloadPdfButton({ ticket }: { ticket: ServiceTicket }) {
  const [loading, setLoading] = useState(false);

  return (
    <Button
      onClick={() => {
        try {
          setLoading(true);
          generateServicePdf(ticket);
          toast.success("Service report generated");
        } catch (e) {
          toast.error("Failed to generate PDF");
          console.error(e);
        } finally {
          setLoading(false);
        }
      }}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <FileDown className="mr-2 h-4 w-4" />
      )}
      Download PDF
    </Button>
  );
}
