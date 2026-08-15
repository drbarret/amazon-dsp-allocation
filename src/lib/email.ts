/**
 * Email sending via Resend.
 *
 * Graceful degradation: if RESEND_API_KEY is not configured, the system logs
 * an explicit warning and returns { sent: false, degraded: true } instead of
 * throwing. It never fails silently and never crashes the application.
 *
 * Env vars:
 *   - RESEND_API_KEY  — Resend API key (required to actually send).
 *   - EMAIL_FROM      — sender address, e.g. "Amazon DSP <no-reply@example.com>".
 *   - EMAIL_TO_OVERRIDE — optional; when set, ALL emails are redirected to this
 *     address (used for testing — never send to real drivers during dev).
 */

export interface EmailResult {
  sent: boolean;
  degraded: boolean;
  id?: string;
  error?: string;
}

function getConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() || "Amazon DSP <no-reply@amazon-dsp-allocation.vercel.app>";
  const toOverride = process.env.EMAIL_TO_OVERRIDE?.trim();
  return { apiKey, from, toOverride };
}

/**
 * Send a plain-text email. Returns { sent: true } on success, or
 * { sent: false, degraded: true } when Resend is not configured.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<EmailResult> {
  const { apiKey, from, toOverride } = getConfig();

  if (!apiKey) {
    // Explicit, visible degradation — never silent, never a crash.
    console.warn(
      "[email] RESEND_API_KEY não configurada. E-mail NÃO enviado para " +
        `${opts.to} (assunto: "${opts.subject}"). Configure RESEND_API_KEY para ativar o envio.`,
    );
    return { sent: false, degraded: true };
  }

  const to = toOverride || opts.to;

  try {
    // Lazy-import Resend so the module loads even when the key is absent.
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: opts.subject,
      text: opts.text,
    });
    if (error) {
      console.error("[email] Falha ao enviar e-mail via Resend:", error.message);
      return { sent: false, degraded: false, error: error.message };
    }
    return { sent: true, degraded: false, id: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email] Erro ao enviar e-mail via Resend:", msg);
    return { sent: false, degraded: false, error: msg };
  }
}
