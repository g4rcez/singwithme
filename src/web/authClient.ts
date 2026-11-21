import { createAuthClient } from "better-auth/react";

/** Better Auth's browser client. It talks to /api/auth on this same origin, so cookies stay first-party. */
export const authClient = createAuthClient();
