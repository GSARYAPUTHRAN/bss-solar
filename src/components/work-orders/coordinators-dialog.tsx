"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { setWorkOrderCoordinators } from "@/app/(app)/work-orders/actions";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { SaleCoordinator, UserRole } from "@/lib/types";
import { CoordinatorsField, type DirectoryPerson } from "./coordinators-field";

const COPY = {
  office: {
    trigger: "Change",
    title: "Change coordinators",
    description:
      "Everyone listed sees this sale, can edit its details and gets its updates. People you remove lose access and are told. Clear a coordinator's incentive before removing them.",
    submit: "Save coordinators",
  },
  add: {
    trigger: "Add partner",
    title: "Add a partner",
    description:
      "Your partner will see and edit this work order and get its updates. Only the office can remove someone.",
    submit: "Save partners",
  },
} as const;

/**
 * Change who shares a sale, from the work order's page.
 *
 *   mode "office"  the office: anyone can come off, be added, or move up. The
 *                  first coordinator is the one who logged the order.
 *   mode "add"     the coordinator who logged a still-pending order: partner
 *                  coordinators can be added, nobody taken off (that is the
 *                  office's call, and office accounts are the office's to add).
 *
 * The server decides again who may do what (`setWorkOrderCoordinators` →
 * `set_work_order_coordinators`) and answers with a toast, or with a message on
 * the page. The dialog closes as the form is sent: the page it lands on shows
 * the outcome.
 */
export function CoordinatorsDialog({
  workOrderId,
  mode,
  coordinators,
  directory,
  viewer,
}: {
  workOrderId: string;
  mode: "office" | "add";
  /** Who is on the sale now, in order. */
  coordinators: readonly Pick<SaleCoordinator, "id" | "full_name">[];
  /** Everyone who can share a sale (`coordinator_directory()`); the picker offers the viewer who they may add. */
  directory: readonly DirectoryPerson[];
  viewer: { id: string; full_name: string; role: UserRole };
}) {
  const [open, setOpen] = useState(false);
  const copy = COPY[mode];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-10 md:h-7">
          {mode === "add" && <Plus data-icon="inline-start" />}
          {copy.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form
          action={setWorkOrderCoordinators}
          onSubmit={() => setOpen(false)}
          className="space-y-4"
        >
          <input type="hidden" name="id" value={workOrderId} />
          <CoordinatorsField
            directory={directory}
            viewer={viewer}
            initial={coordinators.map(({ id, full_name }) => ({ id, full_name }))}
            mode={mode === "office" ? "full" : "partners"}
            hideLabel
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-10 md:h-8">
                Cancel
              </Button>
            </DialogClose>
            <SubmitButton className="h-10 md:h-8" loadingText="Saving…">
              {copy.submit}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
