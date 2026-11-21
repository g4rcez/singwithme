import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "./errors";
import { CLOUD, HOST_PIN } from "./paths";

/**
 * Who is using the app.
 *
 * - "email": the hosted service. People sign in with a one-time code sent to their e-mail by Neon Auth
 *   (managed Better Auth). The code is checked server to server and we keep our own signed session cookie,
 *   so the browser never talks to another origin.
 * - "local": offline use. Whoever sits at the karaoke machine (or knows the host PIN) is the only user.
 */
const AUTH_URL = process.env.NEON_AUTH_BASE_URL?.replace(/\/+$/, "") ?? null;
const SESSION_SECRET = process.env.SINGWITHME_SESSION_SECRET ?? null;
/** When set, only these addresses may sign in. */
const ALLOWED_EMAILS = (process.env.SINGWITHME_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const AUTH_MODE: "email" | "local" = AUTH_URL ? "email" : "local";
export const LOCAL_USER = "local@singwithme";

const COOKIE = "swm_session";
const SESSION_DAYS = 30;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

if (AUTH_MODE === "email" && !SESSION_SECRET) {
  throw new Error("Defina SINGWITHME_SESSION_SECRET para usar o login por e-mail.");
}

const sign = (payload: string) =>
  createHmac("sha256", SESSION_SECRET ?? "")
    .update(payload)
    .digest("base64url");

/** A session is its own proof: `payload.signature`, with the e-mail and an expiry inside the payload. */
export function createSession(email: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ email, exp: now + SESSION_DAYS * 86_400_000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readSession(token: string, now = Date.now()): string | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { email, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      email?: unknown;
      exp?: unknown;
    };
    return typeof email === "string" && typeof exp === "number" && exp > now ? email : null;
  } catch {
    return null;
  }
}

export const isAllowed = (email: string) => ALLOWED_EMAILS.length === 0 || ALLOWED_EMAILS.includes(email);

export const sessionCookie = (token: string | null) =>
  `${COOKIE}=${token ?? ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? SESSION_DAYS * 86_400 : 0}${CLOUD ? "; Secure" : ""}`;

function cookieValue(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=");
  }
  return null;
}

/** The signed-in person's e-mail, or null. `address` is the socket address of the request. */
export function currentUser(request: Request, address: string): string | null {
  if (AUTH_MODE === "email") {
    const token = cookieValue(request);
    const email = token ? readSession(token) : null;
    // The allowlist is re-checked on every request, so removing an address locks it out at once.
    return email && isAllowed(email) ? email : null;
  }
  if (HOST_PIN) return request.headers.get("x-host-pin") === HOST_PIN ? LOCAL_USER : null;
  // A forwarded request came through a proxy or tunnel, so its loopback address says nothing about the sender.
  if (CLOUD || request.headers.has("x-forwarded-for")) return null;
  return LOOPBACK.has(address) ? LOCAL_USER : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cleanEmail(input: unknown): string {
  const email = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) throw new HttpError("Informe um e-mail válido.");
  return email;
}

/** Calls a Neon Auth (Better Auth) endpoint. The Origin must be one of the auth project's trusted domains. */
async function authRequest(path: string, body: unknown, origin: string): Promise<{ ok: boolean; code: string }> {
  const response = await fetch(`${AUTH_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) return { ok: true, code: "" };
  const detail = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
  console.error(`Neon Auth ${path} -> ${response.status} ${detail?.code ?? ""} ${detail?.message ?? ""}`);
  return { ok: false, code: detail?.code ?? String(response.status) };
}

/** Sends a sign-in code to the address, if it is allowed in. */
export async function requestCode(email: string, origin: string): Promise<void> {
  if (!isAllowed(email)) throw new HttpError("Este e-mail ainda não tem acesso ao SingWithMe.", 403);
  const result = await authRequest("/email-otp/send-verification-otp", { email, type: "sign-in" }, origin);
  if (!result.ok) throw new HttpError("Não foi possível enviar o código agora. Tente de novo em instantes.", 502);
}

/** Checks the code and returns a session token for the address. */
export async function verifyCode(email: string, code: unknown, origin: string): Promise<string> {
  if (!isAllowed(email)) throw new HttpError("Este e-mail ainda não tem acesso ao SingWithMe.", 403);
  const otp = typeof code === "string" ? code.trim() : "";
  if (!/^\d{4,8}$/.test(otp)) throw new HttpError("Digite o código numérico que chegou por e-mail.");
  const result = await authRequest("/sign-in/email-otp", { email, otp }, origin);
  if (!result.ok) {
    throw new HttpError(
      result.code === "TOO_MANY_ATTEMPTS"
        ? "Muitas tentativas. Peça um novo código."
        : "Código incorreto ou expirado. Confira o e-mail ou peça um novo código.",
      401,
    );
  }
  return createSession(email);
}
