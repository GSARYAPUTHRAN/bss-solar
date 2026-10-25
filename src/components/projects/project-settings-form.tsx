import { Settings2 } from "lucide-react";
import { updateProjectSettings } from "@/app/(app)/projects/actions";
import { FormField, Section } from "@/components/layout";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { STAGE_LABELS } from "@/lib/constants";
import { FEASIBILITY_CAPTURE_STAGE } from "@/lib/domain/project-progress";

/**
 * Office-only: the KSEB feasibility date of a solar plant (a custom plan has
 * none, so the page does not render this for it). Each coordinator's incentive
 * has its own form — see CoordinatorIncentivesSection. Projects are
 * office-write by RLS, and the action re-checks the role — this form being
 * absent for coordinators is presentation, not the guard.
 */
export function ProjectSettingsForm({
  projectId,
  feasibilityDate,
  today,
  className,
}: {
  projectId: string;
  feasibilityDate: string | null;
  /** IST date from the server; the date may not be later. */
  today: string;
  className?: string;
}) {
  return (
    <Section
      title="Project settings"
      description="Office only."
      icon={Settings2}
      className={className}
    >
      <form action={updateProjectSettings} className="space-y-4">
        <input type="hidden" name="project_id" value={projectId} />
        <FormField
          label="KSEB feasibility date"
          htmlFor="feasibility_date"
          hint={`Filled in automatically when “${STAGE_LABELS[FEASIBILITY_CAPTURE_STAGE]}” is completed. Clear it to remove.`}
        >
          <Input
            id="feasibility_date"
            name="feasibility_date"
            type="date"
            max={today}
            defaultValue={feasibilityDate ?? ""}
            className="h-10"
          />
        </FormField>
        <SubmitButton className="h-10 w-full" loadingText="Saving…">
          Save settings
        </SubmitButton>
      </form>
    </Section>
  );
}
