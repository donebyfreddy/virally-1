/**
 * Transactional email for auth flows (verification, password reset).
 *
 * Feature-detected exactly like every other not-yet-required provider in this
 * app (see src/lib/env.ts): with no RESEND_API_KEY, the link is logged to the
 * server console instead of failing the request, so sign-up and password
 * reset stay testable in local development with no email provider attached.
 */

export type AuthEmail = {
  to: string;
  subject: string;
  text: string;
};

export async function sendAuthEmail(email: AuthEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
     
    console.info(`[auth email — no RESEND_API_KEY, printing instead]\n${email.text}`);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Virally <noreply@virally.app>",
      to: [email.to],
      subject: email.subject,
      text: email.text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Failed to send auth email via Resend: ${response.status} ${detail}`);
  }
}
