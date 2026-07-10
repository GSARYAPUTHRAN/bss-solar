"use client";

import { useState } from "react";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import type { VariantProps } from "class-variance-authority";

/**
 * A destructive/irreversible action gated behind a confirmation dialog. The
 * confirm button submits `action` (a server action) with the given hidden
 * fields, so a stray click can never fire the mutation directly.
 */
export function ConfirmSubmit({
  action,
  fields = {},
  triggerLabel,
  triggerVariant = "ghost",
  triggerClassName,
  title,
  description,
  confirmLabel = "Confirm",
  loadingText,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields?: Record<string, string>;
  triggerLabel: React.ReactNode;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  title: string;
  description?: string;
  confirmLabel?: string;
  loadingText?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={triggerVariant} className={triggerClassName}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <form action={action}>
            {Object.entries(fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <SubmitButton variant="destructive" loadingText={loadingText}>
              {confirmLabel}
            </SubmitButton>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
