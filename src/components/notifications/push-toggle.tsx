"use client";

import { useEffect, useState } from "react";
import { BellOff, BellRing, Loader2, Share, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNotifications } from "./notifications-provider";
import { disablePush, enablePush, readPushState, type PushState } from "./push-device";

type ToggleState = PushState | "checking";

const COPY: Record<ToggleState, { title: string; hint: string }> = {
  checking: {
    title: "Push notifications",
    hint: "Checking this device…",
  },
  unconfigured: {
    title: "Push notifications unavailable",
    hint: "Push is not set up on this server yet. New alerts still appear in the bell.",
  },
  unsupported: {
    title: "Push not supported here",
    hint: "This browser cannot show push notifications. New alerts still appear in the bell.",
  },
  "ios-install": {
    title: "Add to Home Screen first",
    hint: "On iPhone or iPad, tap Share, then “Add to Home Screen”. Open BSS Ops from the Home Screen and turn notifications on there.",
  },
  denied: {
    title: "Notifications are blocked",
    hint: "Allow notifications for this site in your browser’s settings, then come back here.",
  },
  off: {
    title: "Push notifications are off",
    hint: "Turn on to get alerts on this device, even when the app is closed.",
  },
  on: {
    title: "Push notifications are on",
    hint: "This device gets alerts even when the app is closed.",
  },
};

function StateIcon({ state }: { state: ToggleState }) {
  if (state === "on") return <BellRing className="size-4" />;
  if (state === "ios-install") return <Share className="size-4" />;
  if (state === "off" || state === "checking") return <Smartphone className="size-4" />;
  return <BellOff className="size-4" />;
}

/**
 * Per-device Web Push switch. Shown in the bell panel footer (`compact`) and
 * on /notifications (`card`). Every state the browser can be in gets a plain
 * explanation — field staff on phones should never be left guessing why
 * nothing buzzes.
 */
export function PushToggle({
  variant = "compact",
  className,
}: {
  variant?: "compact" | "card";
  className?: string;
}) {
  const { pushPublicKey } = useNotifications();
  const [state, setState] = useState<ToggleState>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readPushState(pushPublicKey)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setState("unsupported");
      });
    return () => {
      cancelled = true;
    };
  }, [pushPublicKey]);

  async function toggle() {
    if (busy || !pushPublicKey) return;
    setBusy(true);
    try {
      const outcome =
        state === "on" ? await disablePush() : await enablePush(pushPublicKey);
      setState(outcome.state);
      if (outcome.error) toast.error(outcome.error);
      else if (outcome.state === "on") toast.success("Notifications turned on for this device.");
      else if (outcome.state === "off") toast.success("Notifications turned off for this device.");
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const copy = COPY[state];
  const actionable = state === "on" || state === "off";
  const compact = variant === "compact";

  return (
    <div
      className={cn(
        "flex gap-3",
        compact ? "items-center" : "flex-col sm:flex-row sm:items-center",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md",
            state === "on" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          <StateIcon state={state} />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className={cn("font-medium", compact ? "text-xs" : "text-sm")}>{copy.title}</p>
          <p className={cn("text-muted-foreground", compact ? "text-[11px]" : "text-sm")}>
            {copy.hint}
          </p>
        </div>
      </div>
      {actionable && (
        <Button
          type="button"
          variant={state === "on" ? "outline" : "default"}
          className={cn("h-10 shrink-0 px-4", !compact && "w-full sm:w-auto")}
          onClick={toggle}
          disabled={busy}
          aria-busy={busy}
        >
          {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
          {state === "on" ? "Turn off" : "Turn on"}
        </Button>
      )}
    </div>
  );
}
