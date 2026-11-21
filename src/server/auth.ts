import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { emailOTP } from "better-auth/plugins/email-otp";
import { Pool } from "pg";
import type { Me } from "../shared/types";
import { CAN_SEND_EMAIL, CODE_MINUTES, sendSignInCode } from "./mailer";
import { CLOUD, HOST_PIN } from "./paths";

/**
 * Who is using the app.
 *
 * - "accounts": the hosted service. People sign in with a one-time code sent to their e-mail. Accounts,
 *   codes, sessions and cookies are all Better Auth's (https://better-auth.com), mounted at /api/auth;
 *   this file only configures it.
 * - "local": offline use, with no accounts at all. Whoever sits at the karaoke machine (or knows the host
 *   PIN) is the only user.
 *
 * Every secret comes from the environment (Vercel / GitHub settings); none belongs in the repository.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const SECRET = process.env.BETTER_AUTH_SECRET;

export const AUTH_MODE: Me["auth"] = DATABASE_URL && SECRET ? "accounts" : "local";
export const LOCAL_USER = "local@singwithme";
export const EMAIL_SIGN_IN = AUTH_MODE === "accounts" && CAN_SEND_EMAIL;

/** When set, only these addresses may have an account. */
const ALLOWED_EMAILS = (process.env.SINGWITHME_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const isAllowed = (email: string, allowed = ALLOWED_EMAILS) =>
  allowed.length === 0 || allowed.includes(email.trim().toLowerCase());

const NOT_ALLOWED = "Este e-mail ainda não tem acesso ao SingWithMe.";

function publicUrl(): string | undefined {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return production ? `https://${production}` : undefined;
}

const SEND_CODE_PATH = "/email-otp/send-verification-otp";

const options = {
  appName: "SingWithMe",
  secret: SECRET,
  baseURL: publicUrl(),
  database: new Pool({ connectionString: DATABASE_URL, max: 3 }),
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: CODE_MINUTES * 60,
      allowedAttempts: 5,
      // Sent and awaited inside the request: on serverless, work left running after the response is lost.
      sendVerificationOTP: async ({ email, otp }) => sendSignInCode(email, otp),
    }),
  ],
  // Counted in the database, so the limits hold across every serverless instance.
  rateLimit: {
    enabled: true,
    storage: "database",
    customRules: {
      [SEND_CODE_PATH]: { window: 60, max: 3 },
      "/sign-in/email-otp": { window: 60, max: 10 },
    },
  },
  // Signed cookie copy of the session, so the frequent queue polling does not hit the database each time.
  session: { cookieCache: { enabled: true, maxAge: 300 } },
  hooks: {
    // Refuse before a code is generated or an e-mail goes out: nobody off the list receives anything.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== SEND_CODE_PATH) return;
      const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
      if (!isAllowed(email)) throw new APIError("FORBIDDEN", { message: NOT_ALLOWED });
    }),
  },
  databaseHooks: {
    user: {
      create: {
        // Runs for every way of creating an account, so the allowlist cannot be sidestepped.
        before: async (user) => {
          if (!isAllowed(user.email)) throw new APIError("FORBIDDEN", { message: NOT_ALLOWED });
        },
      },
    },
  },
} satisfies BetterAuthOptions;

/** Only built in accounts mode: offline installs never open a Postgres connection. */
export const auth = AUTH_MODE === "accounts" ? betterAuth(options) : null;

/** Postgres errors raised when another instance created the same table or type a moment earlier. */
const CREATED_ELSEWHERE = new Set(["42P07", "42710", "23505"]);

/**
 * Creates or updates Better Auth's own tables. Instances that start together can collide while creating
 * them; the loser waits and re-plans, and by then there is nothing left to create.
 */
export async function migrateAuth(attempts = 5): Promise<void> {
  if (!auth) return;
  for (let attempt = 1; ; attempt++) {
    try {
      const { runMigrations } = await getMigrations(options);
      return await runMigrations();
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      if (attempt >= attempts || !CREATED_ELSEWHERE.has(code)) throw error;
      await Bun.sleep(150 * attempt);
    }
  }
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** The signed-in person's e-mail, or null. `address` is the socket address of the request. */
export async function currentUser(request: Request, address: string): Promise<string | null> {
  if (auth) {
    const session = await auth.api.getSession({ headers: request.headers });
    const email = session?.user.email.toLowerCase();
    // Re-checked on every request, so removing an address from the allowlist locks it out.
    return email && isAllowed(email) ? email : null;
  }
  if (HOST_PIN) return request.headers.get("x-host-pin") === HOST_PIN ? LOCAL_USER : null;
  // A forwarded request came through a proxy or tunnel, so its loopback address says nothing about the sender.
  if (CLOUD || request.headers.has("x-forwarded-for")) return null;
  return LOOPBACK.has(address) ? LOCAL_USER : null;
}
