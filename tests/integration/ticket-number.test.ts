import { describe, it, expect, afterEach } from "vitest";
import { serviceClient } from "./helpers";

/**
 * Ticket numbers are assigned by a DB sequence/trigger on insert, guaranteeing
 * uniqueness (the old app-side "4 random digits" collided against the UNIQUE
 * constraint). Explicit numbers are preserved.
 */
describe("service ticket numbering", () => {
  const svc = serviceClient();
  const ids: string[] = [];

  afterEach(async () => {
    if (ids.length) {
      await svc.from("service_tickets").delete().in("id", ids);
      ids.length = 0;
    }
  });

  it("auto-assigns a unique BSS-YYMM-#### number when none is given", async () => {
    const a = await svc
      .from("service_tickets")
      .insert({ ticket_type: "adhoc" })
      .select("id, ticket_no")
      .single();
    const b = await svc
      .from("service_tickets")
      .insert({ ticket_type: "adhoc" })
      .select("id, ticket_no")
      .single();

    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    ids.push(a.data!.id, b.data!.id);

    expect(a.data!.ticket_no).toMatch(/^BSS-\d{4}-\d{4}$/);
    expect(b.data!.ticket_no).toMatch(/^BSS-\d{4}-\d{4}$/);
    expect(a.data!.ticket_no).not.toBe(b.data!.ticket_no);
  });

  it("preserves an explicitly supplied ticket number", async () => {
    const explicit = "BSS-EXPLICIT-9999";
    const res = await svc
      .from("service_tickets")
      .insert({ ticket_type: "adhoc", ticket_no: explicit })
      .select("id, ticket_no")
      .single();
    expect(res.error).toBeNull();
    ids.push(res.data!.id);
    expect(res.data!.ticket_no).toBe(explicit);
  });
});
