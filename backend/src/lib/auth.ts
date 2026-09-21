import NextAuth from "next-auth";
import EmailProvider from "next-auth/providers/email";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";

/**
 * Auth.js configuration. Email magic-link sign-in — no passwords to manage,
 * which fits a small-contractor B2B tool better than building password reset
 * flows. Swap the provider (e.g. Google OAuth) here if you'd rather.
 *
 * Requires EMAIL_SERVER, EMAIL_FROM, and NEXTAUTH_SECRET in .env — see
 * .env.example. Auth.js's Prisma adapter needs the standard Account/Session/
 * VerificationToken models; add those to schema.prisma (see the comment at
 * the bottom of prisma/schema.prisma) and re-run `prisma migrate dev`.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    EmailProvider({
      server: process.env.EMAIL_SERVER,
      from: process.env.EMAIL_FROM,
    }),
  ],
  session: { strategy: "database" },
  pages: {
    signIn: "/sign-in",
  },
});

