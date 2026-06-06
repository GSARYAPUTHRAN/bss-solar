import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createWorkOrder } from "../actions";
import { requireProfile } from "@/lib/auth";
import { getCoordinators } from "@/lib/queries";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { CoordinatorSelect } from "@/components/coordinator-select";
import { COMMON_CAPACITIES } from "@/lib/constants";

export default async function NewWorkOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireProfile();
  const { error } = await searchParams;
  const coordinators =
    profile.role === "admin" ? await getCoordinators() : [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New Work Order"
        description="Log new business captured in the field."
      >
        <Button variant="outline" asChild>
          <Link href="/work-orders">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-6">
          <form action={createWorkOrder} className="space-y-5">
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            {profile.role === "admin" && (
              <div className="space-y-2">
                <Label>Coordinator</Label>
                <CoordinatorSelect
                  name="coordinator_id"
                  coordinators={coordinators}
                  defaultValue={profile.id}
                  includeSelf={{ id: profile.id, full_name: `${profile.full_name} (me)` }}
                />
              </div>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="client_name">Client name *</Label>
                <Input id="client_name" name="client_name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client_phone">Client phone</Label>
                <Input id="client_phone" name="client_phone" type="tel" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Textarea id="address" name="address" rows={2} />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="plant_capacity">Solar plant capacity *</Label>
                <Input
                  id="plant_capacity"
                  name="plant_capacity"
                  list="capacities"
                  placeholder="e.g. 3kW"
                  required
                />
                <datalist id="capacities">
                  {COMMON_CAPACITIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-2">
                <Label htmlFor="order_date">Order date *</Label>
                <Input
                  id="order_date"
                  name="order_date"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="advance_amount">Advance collected (INR)</Label>
                <Input
                  id="advance_amount"
                  name="advance_amount"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={0}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="total_cost">Total cost (INR) *</Label>
                <Input
                  id="total_cost"
                  name="total_cost"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" asChild>
                <Link href="/work-orders">Cancel</Link>
              </Button>
              <Button type="submit">Create Work Order</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
