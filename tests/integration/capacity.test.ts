import { describe, it, expect, afterAll } from "vitest";
import { serviceClient, signedInAs, USERS, withDb } from "./helpers";
import { createFixtures, must } from "./fixtures";
import { parseCapacityKw } from "@/lib/domain/capacity";

/**
 * KSEB registration is priced per kW, so the free-text capacity label needs a
 * number behind it. `work_orders.plant_capacity_kw` is GENERATED from the label
 * by `parse_capacity_kw()` (migration 20261010120100), and forms/imports
 * preview the same figure with `parseCapacityKw()`. A mismatch would quote the
 * customer one fee on screen and store another — so the two are pinned here.
 */
const svc = serviceClient();
const fx = createFixtures(svc);

afterAll(() => fx.cleanup());

/** Evaluates parse_capacity_kw() over every label in one statement. */
async function sqlCapacities(labels: readonly (string | null)[]) {
  const { rows } = await withDb((db) =>
    db.query<{ label: string | null; kw: string | null }>(
      `select t.label, public.parse_capacity_kw(t.label)::text as kw
         from unnest($1::text[]) with ordinality as t(label, n)
        order by t.n`,
      [labels],
    ),
  );
  return rows.map((r) => ({
    label: r.label,
    kw: r.kw === null ? null : Number(r.kw),
  }));
}

const LABELS: readonly (string | null)[] = [
  // How field staff actually write it
  "3kW",
  "3 kW",
  "3KW",
  "3kw",
  "  4 KW  ",
  "5 kWp",
  "5kwp",
  "5 k",
  "10",
  "4.5",
  "3.5kW",
  "3.25 kW",
  "12.345 kW",
  "999999",
  // Watts
  "3000W",
  "3000 W",
  "3000Wp",
  "750 w",
  "1,500w",
  "3,000 W",
  "545 Wp",
  // Half-way roundings Postgres resolves away from zero
  "1.005kW",
  "1005 W",
  "2.675 kW",
  "1.015 kW",
  "0.145 kW",
  "0.005",
  "5 W",
  // First number wins; everything around it is noise
  "Solar 5kW plant",
  "2.2kw + 1kw battery",
  "3kW (6 x 545Wp)",
  "-3kW",
  ".5kW",
  "5 kVA",
  "5.kW",
  "5..5 kW",
  // No number at all
  "",
  "abc",
  "kW",
  "-",
  null,
];

describe("parse_capacity_kw() ≡ parseCapacityKw()", () => {
  it("agrees on every label", async () => {
    const sql = await sqlCapacities(LABELS);
    expect(sql).toEqual(
      LABELS.map((label) => ({ label, kw: parseCapacityKw(label) })),
    );
  });

  // Half-way values are where binary-float rounding diverges from Postgres'
  // exact decimal round(numeric, 2) — a realistic 15 × 555 Wp array ("8325 W")
  // must be 8.33 kW on screen and in the generated column alike
  // (lib/domain/rounding.ts).
  it("agrees on half-way watt totals above 2 kW", async () => {
    const labels = ["8325 W", "4145 W", "4.145 kW", "10.075 kW", "2135W"];
    const sql = await sqlCapacities(labels);
    expect(sql).toEqual(
      labels.map((label) => ({ label, kw: parseCapacityKw(label) })),
    );
  });
});

describe("work_orders.plant_capacity_kw", () => {
  it("follows the label whenever it is edited", async () => {
    const id = await fx.workOrder({
      client_name: "Capacity Fixture",
      plant_capacity: "3kW",
    });
    const read = async () =>
      must(
        await svc
          .from("work_orders")
          .select("plant_capacity_kw")
          .eq("id", id)
          .single(),
        "capacity",
      ).plant_capacity_kw;
    expect(await read()).toBe(3);

    // The owner edits the label; the number moves with it.
    const rahul = await signedInAs(USERS.rahul);
    must(
      await rahul
        .from("work_orders")
        .update({ plant_capacity: "4500 W" })
        .eq("id", id)
        .select("id")
        .single(),
      "edit label",
    );
    expect(await read()).toBe(4.5);

    const listed = must(
      await svc
        .from("work_orders_list")
        .select("plant_capacity_kw")
        .eq("id", id)
        .single(),
      "list row",
    );
    expect(listed.plant_capacity_kw).toBe(4.5);

    await svc
      .from("work_orders")
      .update({ plant_capacity: "to be surveyed" })
      .eq("id", id);
    expect(await read()).toBeNull();
  });

  it("cannot be written directly — the label is the single source of truth", async () => {
    const id = await fx.workOrder({
      client_name: "Capacity Write Fixture",
      plant_capacity: "3kW",
    });
    const { error } = await svc
      .from("work_orders")
      // @ts-expect-error — generated column: the Update type is `never`.
      .update({ plant_capacity_kw: 10 })
      .eq("id", id);
    expect(error?.code).toBe("428C9");

    const row = must(
      await svc
        .from("work_orders")
        .select("plant_capacity_kw")
        .eq("id", id)
        .single(),
      "capacity",
    );
    expect(row.plant_capacity_kw).toBe(3);
  });
});
