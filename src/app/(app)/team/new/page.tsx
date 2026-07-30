import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { profilesRepository } from "@/server/data";
import { createTeamMember } from "../actions";
import { isSuperAdminRole, roleOptions } from "@/lib/domain/role";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";
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
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { FormSelect } from "@/components/form-select";

export default async function NewTeamMemberPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await requireAdmin();
  const { error } = await searchParams;
  // Mirrors canGrantSuperAdmin() in team/actions.ts, which re-checks on submit.
  const canGrantSuperAdmin =
    isSuperAdminRole(me.role) || !(await profilesRepository.superAdminExists());

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
              hint={`Minimum ${MIN_PASSWORD_LENGTH} characters. Share securely with the new member.`}
            >
              <Input
                id="password"
                name="password"
                type="password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            </FormField>
            <FormField
              label="Role"
              htmlFor="role"
              hint={
                canGrantSuperAdmin
                  ? "There can only be one Super Admin."
                  : undefined
              }
            >
              <FormSelect
                id="role"
                name="role"
                defaultValue="coordinator"
                options={roleOptions(canGrantSuperAdmin)}
              />
            </FormField>
          </FormGrid>

          <FormActions>
            <Button variant="outline" asChild>
              <Link href="/team">Cancel</Link>
            </Button>
            <SubmitButton loadingText="Adding…">Add Member</SubmitButton>
          </FormActions>
        </form>
      </Section>
    </Page>
  );
}
