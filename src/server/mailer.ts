import { Resend } from "resend";
import { CLOUD } from "./paths";

/**
 * Sends the sign-in codes. Delivery goes through Resend (https://resend.com) when RESEND_API_KEY is set.
 * Without it, a local install prints the code to the terminal instead, which is enough to develop with;
 * a hosted install has no way to deliver codes and switches e-mail sign-in off.
 */
const RESEND_API_KEY = process.env.RESEND_API_KEY;
/** Resend only delivers from a verified domain; its test sender reaches nobody but the account owner. */
const FROM = process.env.SINGWITHME_EMAIL_FROM ?? "SingWithMe <onboarding@resend.dev>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export const CAN_SEND_EMAIL = resend !== null || !CLOUD;

export const CODE_MINUTES = 10;

function render(code: string): { subject: string; text: string; html: string } {
  const subject = `${code} é o seu código do SingWithMe`;
  const text = `Seu código para entrar no SingWithMe é ${code}.\n\nEle vale por ${CODE_MINUTES} minutos. Se não foi você que pediu, ignore este e-mail.`;
  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#0b0714;font-family:system-ui,sans-serif;color:#ffffff">
    <div style="max-width:420px;margin:0 auto;padding:40px 24px;text-align:center">
      <p style="font-size:24px;font-weight:900;margin:0 0 24px">Sing<span style="color:#ff3d9a">With</span>Me</p>
      <p style="color:#c9c3d6;margin:0 0 16px">Seu código para entrar:</p>
      <p style="font-size:40px;font-weight:800;letter-spacing:10px;margin:0 0 24px">${code}</p>
      <p style="color:#8a829c;font-size:13px;margin:0">Vale por ${CODE_MINUTES} minutos. Se não foi você que pediu, ignore este e-mail.</p>
    </div>
  </body>
</html>`;
  return { subject, text, html };
}

export async function sendSignInCode(email: string, code: string): Promise<void> {
  const message = render(code);
  if (!resend) {
    // Local development only: CAN_SEND_EMAIL keeps hosted instances from ever getting here.
    console.log(`[singwithme] código de acesso para ${email}: ${code}`);
    return;
  }
  const { error } = await resend.emails.send({ from: FROM, to: email, ...message });
  if (error) throw new Error(`Resend recusou o envio: ${error.message}`);
}
