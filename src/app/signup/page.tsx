import Link from "next/link";
import { signup } from "../login/actions";
import { AuthShell, FormError, FormField } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <AuthShell
      title="Create account"
      description="New users are created as Coordinators. An admin can upgrade roles."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-foreground underline">
            Sign in
          </Link>
        </>
      }
    >
      <form action={signup} className="space-y-4">
        <FormError message={error} />
        <FormField label="Full name" htmlFor="full_name">
          <Input id="full_name" name="full_name" type="text" required />
        </FormField>
        <FormField label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" required />
        </FormField>
        <FormField label="Password" htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            minLength={6}
            required
          />
        </FormField>
        <Button type="submit" className="w-full">
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
