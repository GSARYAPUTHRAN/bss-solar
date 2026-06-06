import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createTeamMember } from "../actions";
import {
  Page,
  PageHeader,
  Section,
  FormField,
  FormGrid,
  FormActions,
  FormError,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormSelect } from "@/components/form-select";

export default async function NewTeamMemberPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { error } = await searchParams;

  return (
    <Page size="tight">
      <PageHeader
        title="Add Team Member"
        description="Create a coordinator or admin account for your staff."
        backHref="/team"
      />

      <Section>
        <form action={createTeamMember} className="space-y-5">
          <FormError message={error} />

          <FormField label="Full name" htmlFor="full_name" required>
            <Input id="full_name" name="full_name" required />
          </FormField>

          <FormGrid>
            <FormField label="Email" htmlFor="email" required>
              <Input id="email" name="email" type="email" required />
            </FormField>
            <FormField label="Phone" htmlFor="phone">
              <Input id="phone" name="phone" type="tel" />
            </FormField>
          </FormGrid>

          <FormGrid>
            <FormField
              label="Password"
              htmlFor="password"
              required
              hint="Minimum 6 characters. Share securely with the new member."
            >
              <Input
                id="password"
                name="password"
                type="password"
                minLength={6}
                required
              />
            </FormField>
            <FormField label="Role">
              <FormSelect
                name="role"
                defaultValue="coordinator"
                options={[
                  { value: "coordinator", label: "Coordinator" },
                  { value: "admin", label: "Admin" },
                ]}
              />
            </FormField>
          </FormGrid>

          <FormActions>
            <Button variant="outline" asChild>
              <Link href="/team">Cancel</Link>
            </Button>
            <Button type="submit">Add Member</Button>
          </FormActions>
        </form>
      </Section>
    </Page>
  );
}
