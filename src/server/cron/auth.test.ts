import { describe, it, expect } from "vitest";
import { checkCronRequest } from "./auth";

const SECRET = "s3cr3t-value";

describe("checkCronRequest", () => {
  it("fails closed when no secret is configured", () => {
    expect(checkCronRequest(`Bearer ${SECRET}`, undefined)).toMatchObject({ ok: false, status: 503 });
    expect(checkCronRequest(`Bearer ${SECRET}`, "")).toMatchObject({ ok: false, status: 503 });
    expect(checkCronRequest("Bearer    ", "   ")).toMatchObject({ ok: false, status: 503 });
  });

  it("accepts exactly 'Bearer <secret>'", () => {
    expect(checkCronRequest(`Bearer ${SECRET}`, SECRET)).toEqual({ ok: true });
  });

  it("rejects a missing, wrong or malformed header", () => {
    for (const header of [
      null,
      "",
      SECRET,
      `bearer ${SECRET}`,
      `Bearer ${SECRET} `,
      `Bearer ${SECRET}x`,
      `Basic ${SECRET}`,
      "Bearer wrong",
    ]) {
      expect(checkCronRequest(header, SECRET)).toMatchObject({ ok: false, status: 401 });
    }
  });
});
