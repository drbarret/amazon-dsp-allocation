import { NextResponse } from "next/server";
import { sendCnhReminders } from "@/lib/cnh-reminder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Protected trigger for the CNH expiry reminder job.
 *
 * This endpoint is NOT open: it requires a bearer token matching CRON_SECRET.
 * An open endpoint that mass-emails drivers would be a serious vulnerability,
 * so the token is mandatory. On Vercel this can be wired to a cron schedule
 * (vercel.json "crons") or invoked manually with the secret.
 *
 *   curl -X POST https://<host>/api/cron/cnh-reminders \
 *        -H "Authorization: Bearer $CRON_SECRET"
 *
 * Optional query params:
 *   ?dryRun=1  — log what would be sent without sending or recording.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  try {
    const result = await sendCnhReminders({ dryRun });
    return NextResponse.json({
      ok: true,
      dryRun,
      due: result.due.length,
      sent: result.sent.length,
      alreadyReminded: result.alreadyReminded.length,
      degraded: result.degraded.length,
      failed: result.failed.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cnh-reminder] Falha no job:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
