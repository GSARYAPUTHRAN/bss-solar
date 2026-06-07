import { LogIn } from "lucide-react";
import { login } from "./actions";
import { LoginShell } from "@/components/login-shell";
import { FormError, FormField } from "@/components/layout";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <LoginShell>
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
          <p className="text-sm text-muted-foreground">
            Sign in with your staff email and password to continue.
          </p>
        </div>

        <form action={login} className="space-y-5">
          <FormError message={error} />

          <FormField label="Email address" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@bsssolar.in"
              className="h-11"
              required
            />
          </FormField>

          <FormField label="Password" htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              className="h-11"
              required
            />
          </FormField>

          <SubmitButton size="lg" className="h-11 w-full gap-2" loadingText="Signing in…">
            <LogIn className="h-4 w-4" />
            Sign in
          </SubmitButton>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Staff accounts are created by your administrator.
          <br />
          Contact the office if you need access.
        </p>
      </div>
    </LoginShell>
  );
}
