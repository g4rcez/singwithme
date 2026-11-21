import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { Pool } from "pg";
import type { Me } from "../shared/types";
import { CLOUD, HOST_PIN } from "./paths";

/**
 * Who is using the app.
 *
 * - "accounts": the hosted service. Sign-in, sessions, cookies and the user tables are all Better Auth's
 *   (https://better-auth.com), mounted at /api/auth. This file only configures it.
 * - "local": offline use, with no accounts at all. Whoever sits at the karaoke machine (or knows the host
 *   PIN) is the only user.
 *
 * Every secret comes from the environment (Vercel / GitHub settings); none belongs in the repository.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const SECRET = process.env.BETTER_AUTH_SECRET;

export const AUTH_MODE: Me["auth"] = DATABASE_URL && SECRET ? "accounts" : "local";
export const LOCAL_USER = "local@singwithme";

/** When set, only these addresses may have an account. */
const ALLOWED_EMAILS = (process.env.SINGWITHME_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const isAllowed = (email: string, allowed = ALLOWED_EMAILS) =>
  allowed.length === 0 || allowed.includes(email.trim().toLowerCase());

const provider = (id: string | undefined, secret: string | undefined) =>
  id && secret ? { clientId: id, clientSecret: secret } : undefined;

const github = provider(process.env.GITHUB_CLIENT_ID, process.env.GITHUB_CLIENT_SECRET);
const google = provider(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
/** E-mail and password proves nothing about who owns the address, so it is opt-in (self-hosting, tests). */
const password = process.env.SINGWITHME_PASSWORD_LOGIN === "1";

/** Which sign-in buttons the interface should offer. */
export const SIGN_IN_METHODS: Me["methods"] = {
  github: AUTH_MODE === "accounts" && github !== undefined,
  google: AUTH_MODE === "accounts" && google !== undefined,
  password: AUTH_MODE === "accounts" && password,
};

function publicUrl(): string | undefined {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return production ? `https://${production}` : undefined;
}

const options = {
  appName: "SingWithMe",
  secret: SECRET,
  baseURL: publicUrl(),
  database: new Pool({ connectionString: DATABASE_URL, max: 3 }),
  emailAndPassword: { enabled: password },
  socialProviders: { ...(github && { github }), ...(google && { google }) },
  // Signed cookie copy of the session, so the frequent queue polling does not hit the database each time.
  session: { cookieCache: { enabled: true, maxAge: 300 } },
  databaseHooks: {
    user: {
      create: {
        // Runs for every way of creating an account, so the allowlist cannot be sidestepped.
        before: async (user) => {
          if (!isAllowed(user.email)) {
            throw new APIError("FORBIDDEN", { message: "Este e-mail ainda não tem acesso ao SingWithMe." });
          }
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
