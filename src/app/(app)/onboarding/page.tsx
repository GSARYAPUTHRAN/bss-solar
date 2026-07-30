import { requireAdmin } from "@/lib/auth";
import { profilesRepository } from "@/server/data";
import { Page, PageHeader, Section } from "@/components/layout";
import { BulkImportForm } from "@/components/bulk-import-form";
import { IMPORT_HEADERS } from "@/lib/domain/import";
import { PROJECT_STAGES } from "@/lib/constants";

export const metadata = { title: "Onboarding — Import Projects" };

const REQUIRED = new Set(["client_name", "plant_capacity", "total_cost"]);

export default async function OnboardingPage() {
  const me = await requireAdmin();
  const members = await profilesRepository.list();

  return (
    <Page size="wide">
      <PageHeader
        title="Onboarding — Import Existing Projects"
        description="A one-time bulk import to bring your existing installations into the system. Each row creates an approved work order and an active project at the stage you specify."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="How it works" className="lg:col-span-1">
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Upload or paste a CSV with a header row. Download the template for a
              ready-to-fill example. Each valid row becomes a project; the result
              of every row is reported so you can fix and re-import any failures.
            </p>
            <div>
              <p className="mb-1 font-medium text-foreground">Columns</p>
              <ul className="space-y-1">
                {IMPORT_HEADERS.map((h) => (
                  <li key={h} className="font-mono text-xs">
                    {h}
                    {REQUIRED.has(h) && (
                      <span className="ml-1 text-destructive">*required</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 font-medium text-foreground">Notes</p>
              <ul className="list-disc space-y-1 pl-4">
                <li>
                  <span className="font-mono text-xs">current_stage</span> accepts
                  a stage key or its label; defaults to the first stage.
                </li>
                <li>
                  <span className="font-mono text-xs">is_completed</span> =
                  true/yes marks the project commissioned (all milestones done).
                </li>
                <li>
                  <span className="font-mono text-xs">coordinator_email</span>{" "}
                  matches an existing staff account; otherwise the default
                  coordinator is used.
                </li>
                <li>Dates use YYYY-MM-DD.</li>
                <li>
                  Money received ={" "}
                  <span className="font-mono text-xs">advance_amount</span> +{" "}
                  <span className="font-mono text-xs">first_payment_amount</span>{" "}
                  +{" "}
                  <span className="font-mono text-xs">
                    second_payment_amount
                  </span>
                  . A commissioned row with a balance left is flagged{" "}
                  <strong>payment pending</strong>.
                </li>
                <li>
                  Every column except the three required ones may be left blank.
                </li>
              </ul>
            </div>
            <details className="rounded-md border p-2">
              <summary className="cursor-pointer text-xs font-medium text-foreground">
                Valid stage keys
              </summary>
              <ul className="mt-2 space-y-0.5">
                {PROJECT_STAGES.map((s) => (
                  <li key={s.value} className="font-mono text-[11px]">
                    {s.value}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </Section>

        <Section title="Import" className="lg:col-span-2">
          <BulkImportForm
            members={members.map((m) => ({ id: m.id, full_name: m.full_name }))}
            defaultId={me.id}
          />
        </Section>
      </div>
    </Page>
  );
}
