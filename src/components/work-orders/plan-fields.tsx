"use client";

import { useState, type ReactNode } from "react";
import { FormField, FormGrid } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { COMMON_CAPACITIES } from "@/lib/constants";
import { PLAN_LABEL_MAX, PLAN_TYPE, PLAN_TYPES } from "@/lib/domain/plan";
import type { PlanType } from "@/lib/types";
import { CapacityField } from "./capacity-field";
import { TOUCH_INPUT } from "./touch";

const CUSTOM_HINT =
  "Custom plans have no KSEB registration, feasibility or KSEB milestones — the project has a single Handover step.";

/**
 * What was sold: a solar plant (a kW capacity, priced for KSEB registration) or
 * a custom plan ("1 panel", "Inverter + panel" — described in words, no KSEB
 * process). Posts `plan_type` and the label as `plant_capacity`.
 *
 * Each plan keeps what was typed for it, so flipping the switch back and forth
 * never loses a label — and "1 panel" never lingers in the solar field, where it
 * would be read as 1 kW. Once the work order has a project (`lockedPlan`) the
 * plan cannot change (its milestones were seeded from it): it is shown as a
 * line, posted as it is, and only the label stays editable.
 *
 * `children` sit beside the label field (the order date), so the pair keeps one
 * row on wide screens.
 */
export function PlanFields({
  defaultPlan = "solar",
  defaultLabel,
  lockedPlan,
  children,
}: {
  /** The stored plan and label (an edit); a new order starts as a solar plant. */
  defaultPlan?: PlanType;
  defaultLabel?: string;
  /** Set once a project exists: the plan is shown, not chosen. */
  lockedPlan?: PlanType | null;
  children?: ReactNode;
}) {
  const initial = lockedPlan ?? defaultPlan;
  const [plan, setPlan] = useState<PlanType>(initial);
  const [labels, setLabels] = useState<Record<PlanType, string>>({
    solar: initial === "solar" ? (defaultLabel ?? "") : "",
    custom: initial === "custom" ? (defaultLabel ?? "") : "",
  });
  const remember = (which: PlanType, label: string) =>
    setLabels((current) => ({ ...current, [which]: label }));

  return (
    <div className="space-y-5">
      {lockedPlan ? (
        <>
          <input type="hidden" name="plan_type" value={lockedPlan} />
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Plan:</span>{" "}
            {PLAN_TYPE[lockedPlan].label} — fixed once the project has started.
          </p>
        </>
      ) : (
        <fieldset className="min-w-0 space-y-2">
          <legend className="mb-2 text-sm leading-none font-medium">Plan</legend>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {PLAN_TYPES.map((value) => (
              <label
                key={value}
                className="flex min-h-10 cursor-pointer items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50 md:min-h-8"
              >
                <input
                  type="radio"
                  name="plan_type"
                  value={value}
                  checked={plan === value}
                  onChange={() => setPlan(value)}
                  className="sr-only"
                />
                {PLAN_TYPE[value].label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <FormGrid>
        {plan === "solar" ? (
          <FormField label="Plant capacity" htmlFor="plant_capacity" required>
            <CapacityField
              id="plant_capacity"
              name="plant_capacity"
              defaultValue={labels.solar}
              suggestions={COMMON_CAPACITIES}
              previous={initial === "solar" && defaultLabel ? defaultLabel : null}
              onLabelChange={(label) => remember("solar", label)}
            />
          </FormField>
        ) : (
          <FormField label="What was sold" htmlFor="plant_capacity" required hint={CUSTOM_HINT}>
            <Input
              id="plant_capacity"
              name="plant_capacity"
              placeholder="e.g. 1 panel, Inverter + panel"
              maxLength={PLAN_LABEL_MAX}
              value={labels.custom}
              onChange={(event) => remember("custom", event.target.value)}
              className={TOUCH_INPUT}
              required
            />
          </FormField>
        )}
        {children}
      </FormGrid>
    </div>
  );
}
