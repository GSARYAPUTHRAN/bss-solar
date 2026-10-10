import { NextResponse, type NextRequest } from "next/server";
import { todayISO } from "@/lib/format";
import { checkCronRequest } from "@/server/cron/auth";
import {
  cronDeliverer,
  loadActiveFeasibilityProjects,
  runFeasibilityAlerts,
} from "@/server/cron/feasibility";

/**
 * Daily scheduled job (vercel.json: 02:30 UTC = 08:00 IST). Today it sends the
 * KSEB feasibility alerts; add further daily jobs here. Public in the proxy
 * (no session cookie on a cron call) — the bearer secret is the only gate.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const gate = checkCronRequest(request.headers.get("authorization"));
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status, headers: NO_STORE });
  }

  try {
    const feasibility = await runFeasibilityAlerts({
      today: todayISO(),
      loadProjects: loadActiveFeasibilityProjects,
      deliver: cronDeliverer(),
    });
    return NextResponse.json({ ok: true, feasibility }, { headers: NO_STORE });
  } catch (error) {
    console.error("[cron/daily] failed:", error);
    return NextResponse.json(
      { ok: false, error: "The daily job failed. See the server logs." },
      { status: 500, headers: NO_STORE },
    );
  }
}
