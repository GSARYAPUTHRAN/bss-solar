import { ClipboardList, KanbanSquare, Phone, Wrench } from "lucide-react";
import { BssLogo } from "@/components/bss-logo";
import { COMPANY } from "@/lib/constants";
import { cn } from "@/lib/utils";

const HIGHLIGHTS = [
  { icon: ClipboardList, label: "Work order & CRM tracking" },
  { icon: KanbanSquare, label: "KSEB / ANERT project pipeline" },
  { icon: Wrench, label: "Service tickets & field reports" },
] as const;

export function LoginShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="relative flex min-h-screen w-full">
      {/* Brand panel — desktop */}
      <aside className="relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-16 left-10 h-56 w-56 rounded-full bg-white/10 blur-2xl"
        />

        <div className="relative space-y-8">
          <BssLogo
            variant="full"
            className="h-14 w-auto max-w-[200px] brightness-0 invert"
            priority
          />
          <div className="space-y-3">
            <h1 className="text-2xl font-bold tracking-tight">
              Operations Console
            </h1>
            <p className="max-w-sm text-sm leading-relaxed text-primary-foreground/85">
              {COMPANY.tagline}. Manage installations, coordinators, and
              service workflows from one place.
            </p>
          </div>
          <ul className="space-y-3">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="h-4 w-4" />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-xs text-primary-foreground/70">
          <Phone className="h-3.5 w-3.5 shrink-0" />
          Need help? {COMPANY.phone.split(",")[0].trim()}
        </p>
      </aside>

      {/* Form panel */}
      <main
        className={cn(
          "relative flex flex-1 flex-col items-center justify-center bg-background px-4 py-10 sm:px-8",
          className,
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_0%,var(--color-primary)/8%,transparent)] lg:hidden"
        />

        <div className="relative w-full max-w-[400px] space-y-8">
          {/* Mobile branding */}
          <div className="flex flex-col items-center gap-3 text-center lg:hidden">
            <BssLogo variant="full" className="h-14 w-auto max-w-[200px]" priority />
            <p className="text-sm text-muted-foreground">{COMPANY.tagline}</p>
          </div>

          {children}
        </div>
      </main>
    </div>
  );
}
