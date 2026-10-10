"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { CheckCircle2, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setTicketStatus } from "@/app/(app)/tickets/actions";
import {
  engineerActions,
  type EngineerAction,
} from "@/lib/domain/ticket-workflow";
import { useLoading } from "@/lib/loading/loading-context";
import { cn } from "@/lib/utils";
import type { TicketStatus } from "@/lib/types";
import { SERVER_UNREACHABLE_MESSAGE } from "@/lib/constants";

const ICONS: Record<EngineerAction["to"], typeof PlayCircle> = {
  in_progress: PlayCircle,
  completed: CheckCircle2,
};

const SUCCESS: Record<EngineerAction["to"], (ticket: string) => string> = {
  in_progress: (ticket) => `Work started on ${ticket}`,
  completed: (ticket) => `${ticket} marked completed`,
};

/**
 * The status buttons a service engineer gets on a ticket (Start work / Mark
 * completed). Sized for thumbs: `compact` rows on list cards, `large` stacked
 * buttons on the ticket page. Renders nothing once the ticket is closed.
 */
export function TicketStatusActions({
  ticketId,
  ticketNo,
  status,
  size = "compact",
  className,
}: {
  ticketId: string;
  ticketNo: string | null;
  status: TicketStatus;
  size?: "compact" | "large";
  className?: string;
}) {
  const [pendingTo, setPendingTo] = useState<EngineerAction["to"] | null>(null);
  const [confirming, setConfirming] = useState<EngineerAction | null>(null);
  const [, startTransition] = useTransition();
  const { trackPromise } = useLoading();

  const actions = engineerActions(status);
  if (actions.length === 0) return null;

  const label = ticketNo ?? "Ticket";
  const busy = pendingTo !== null;

  function run(action: EngineerAction) {
    setConfirming(null);
    setPendingTo(action.to);
    startTransition(async () => {
      try {
        const result = await trackPromise(setTicketStatus(ticketId, action.to));
        if (result.ok) toast.success(SUCCESS[action.to](label));
        else toast.error(result.error);
      } catch (error) {
        // A redirect (session expired) still goes to the router; anything else
        // is a request that never completed — weak signal on site, typically.
        // Left alone it would replace the worklist with the error page.
        unstable_rethrow(error);
        toast.error(SERVER_UNREACHABLE_MESSAGE);
      } finally {
        setPendingTo(null);
      }
    });
  }

  const buttonClass =
    size === "large" ? "h-12 w-full text-base" : "h-10 flex-1 sm:flex-none";

  return (
    <>
      <div
        className={cn(
          "flex gap-2",
          size === "large" ? "flex-col sm:flex-row" : "flex-wrap",
          className,
        )}
      >
        {actions.map((action, index) => {
          const Icon = ICONS[action.to];
          return (
            <Button
              key={action.to}
              type="button"
              // The first action is the natural next step; the rest are secondary.
              variant={index === 0 ? "default" : "outline"}
              className={buttonClass}
              disabled={busy}
              aria-label={`${action.label}: ${label}`}
              onClick={() => (action.confirm ? setConfirming(action) : run(action))}
            >
              {pendingTo === action.to ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Icon aria-hidden />
              )}
              {action.label}
            </Button>
          );
        })}
      </div>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {label} completed?</DialogTitle>
            <DialogDescription>
              The office will be notified that the service is done. Only the
              office can reopen a completed ticket.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-10">
                Not yet
              </Button>
            </DialogClose>
            <Button
              type="button"
              className="h-10"
              onClick={() => confirming && run(confirming)}
            >
              <CheckCircle2 aria-hidden />
              Mark completed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
