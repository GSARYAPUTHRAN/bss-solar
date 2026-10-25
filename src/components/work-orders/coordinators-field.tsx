"use client";

import { useState, type ReactNode } from "react";
import { ArrowUp, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  COORDINATOR_ERRORS,
  MAX_SALE_COORDINATORS,
  mayAddToSale,
} from "@/lib/domain/coordinators";
import { isOfficeRole } from "@/lib/domain/role";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/types";
import { useIsDesktop } from "./use-desktop";

/** Someone on the sale (or about to be). */
export interface CoordinatorPerson {
  id: string;
  full_name: string;
}

/** Someone who may be on a sale: an account that can own or share one. */
export interface DirectoryPerson extends CoordinatorPerson {
  role: UserRole;
}

/**
 * The people who share a sale, as an ordered list with a picker to add more.
 * Posts one hidden `coordinator_ids` input per person, in the order shown — the
 * first is the coordinator who logged the work order. The server re-checks
 * everything (who may add whom, the cap, eligibility); this only keeps the
 * person from building a list the server will refuse — a coordinator is offered
 * other coordinators only, the office is offered everyone.
 *
 *   mode "partners"  a coordinator adding partners to their own sale: whoever is
 *                    already on it (`initial`) stays, in order; only people added
 *                    here can be taken off again before saving.
 *   mode "full"      the office: anyone can be taken off (but never the last
 *                    person) and moved up, so the first is the one it says.
 *
 * The picker is a bottom sheet on phones (44px rows, thumb reach) and a popover
 * from `md` up.
 */
export function CoordinatorsField({
  directory,
  viewer,
  initial,
  mode,
  name = "coordinator_ids",
  label = "Coordinators",
  hideLabel = false,
  hint,
}: {
  /** Everyone who can share a sale (`coordinator_directory()`); the picker narrows it to who the viewer may add. */
  directory: readonly DirectoryPerson[];
  /** The signed-in person: shown as "You" (a coordinator) or "(me)" (the office). */
  viewer: CoordinatorPerson & { role: UserRole };
  /** Who starts on the list, in order. Defaults to the viewer alone. */
  initial?: readonly CoordinatorPerson[];
  mode: "partners" | "full";
  name?: string;
  label?: string;
  /** Keep the label for screen readers only (a dialog already has a title). */
  hideLabel?: boolean;
  hint?: ReactNode;
}) {
  const [people, setPeople] = useState<CoordinatorPerson[]>(() => [
    ...(initial ?? [{ id: viewer.id, full_name: viewer.full_name }]),
  ]);
  const [lockedIds] = useState<ReadonlySet<string>>(
    () => new Set(mode === "partners" ? (initial ?? [viewer]).map((p) => p.id) : []),
  );

  const chosen = new Set(people.map((person) => person.id));
  // Only people the viewer may add: the office anyone, a coordinator only other
  // coordinators (`mayAddToSale`, the rule the database enforces).
  const candidates = directory.filter(
    (person) => !chosen.has(person.id) && mayAddToSale(viewer, person),
  );
  const atMax = people.length >= MAX_SALE_COORDINATORS;
  const addLabel = mode === "partners" ? "Add partner" : "Add coordinator";

  function add(person: DirectoryPerson) {
    setPeople((list) =>
      list.length >= MAX_SALE_COORDINATORS || list.some((p) => p.id === person.id)
        ? list
        : [...list, { id: person.id, full_name: person.full_name }],
    );
  }
  function remove(id: string) {
    setPeople((list) => (list.length > 1 ? list.filter((p) => p.id !== id) : list));
  }
  function moveUp(id: string) {
    setPeople((list) => {
      const at = list.findIndex((p) => p.id === id);
      if (at < 1) return list;
      const next = [...list];
      [next[at - 1], next[at]] = [next[at], next[at - 1]];
      return next;
    });
  }

  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className={cn("mb-2 text-sm leading-none font-medium", hideLabel && "sr-only")}>
        {label}
      </legend>
      <div className="space-y-2">
        <ol className="space-y-2">
          {people.map((person, index) => {
            const locked = lockedIds.has(person.id);
            const isViewer = person.id === viewer.id;
            const shown = isViewer
              ? viewer.role === "coordinator"
                ? "You"
                : `${person.full_name} (me)`
              : person.full_name;
            return (
              <li
                key={person.id}
                className="flex min-h-11 items-center gap-1 rounded-lg border bg-muted/30 py-1 pr-1 pl-3"
              >
                <input type="hidden" name={name} value={person.id} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{shown}</span>
                {index === 0 && people.length > 1 && <Badge variant="outline">First</Badge>}
                {mode === "full" && index > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-10 md:size-8"
                    aria-label={`Move ${person.full_name} up`}
                    onClick={() => moveUp(person.id)}
                  >
                    <ArrowUp />
                  </Button>
                )}
                {!locked && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-10 md:size-8"
                    aria-label={`Remove ${person.full_name}`}
                    disabled={people.length === 1}
                    onClick={() => remove(person.id)}
                  >
                    <X />
                  </Button>
                )}
              </li>
            );
          })}
        </ol>

        <PartnerPicker
          addLabel={addLabel}
          candidates={candidates}
          disabled={atMax}
          onPick={add}
        />
        {atMax && (
          <p role="status" className="text-xs text-muted-foreground">
            {COORDINATOR_ERRORS.tooMany}
          </p>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </fieldset>
  );
}

/**
 * "Add partner": search the people who can be added and pick one. A bottom sheet
 * below `md`, a popover above. Closes after each pick; the content mounts only
 * while open, so the search always starts empty.
 */
function PartnerPicker({
  addLabel,
  candidates,
  disabled,
  onPick,
}: {
  addLabel: string;
  candidates: readonly DirectoryPerson[];
  disabled: boolean;
  onPick: (person: DirectoryPerson) => void;
}) {
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);

  const trigger = (
    <Button type="button" variant="outline" className="h-10 w-full sm:w-auto md:h-8" disabled={disabled}>
      <Plus data-icon="inline-start" /> {addLabel}
    </Button>
  );
  const list = (
    <CandidateList
      candidates={candidates}
      onPick={(person) => {
        onPick(person);
        setOpen(false);
      }}
    />
  );

  if (desktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2">
          {list}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-xl">
        <SheetHeader>
          <SheetTitle>{addLabel}</SheetTitle>
          <SheetDescription>Choose who shares this sale.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">{list}</div>
      </SheetContent>
    </Sheet>
  );
}

/** Search box and the rows to pick from (44px, one tap each). */
function CandidateList({
  candidates,
  onPick,
}: {
  candidates: readonly DirectoryPerson[];
  onPick: (person: DirectoryPerson) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = candidates.filter((person) => person.full_name.toLowerCase().includes(needle));

  return (
    <div className="space-y-2">
      <Input
        type="search"
        aria-label="Search coordinators"
        placeholder="Search by name"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="h-11 md:h-9"
      />
      {matches.length === 0 ? (
        <p className="px-1 py-4 text-center text-sm text-muted-foreground">
          {candidates.length === 0
            ? "Everyone who can share a sale is already on this one."
            : `No one matches “${query.trim()}”.`}
        </p>
      ) : (
        <ul className="max-h-[50dvh] overflow-y-auto">
          {matches.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => onPick(person)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="min-w-0 truncate">{person.full_name}</span>
                {isOfficeRole(person.role) && (
                  <span className="shrink-0 text-xs text-muted-foreground">Office</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
