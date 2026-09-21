import { auth } from "./auth";
import { prisma } from "./db";

/**
 * This is the single most security-critical function in the codebase (spec
 * §58). Every API route calls getSession() and trusts the companyId it
 * returns to scope every database query — get this wrong and one company can
 * see another's data.
 *
 * A user can belong to more than one company (e.g. an admin who consults for
 * two contractors). We resolve "which company" via an `x-company-id` header
 * the frontend sends, defaulting to the user's first active membership if
 * omitted. Reject outright if the requested company isn't one they belong to
 * — never trust a client-supplied companyId without checking membership.
 */

export interface Session {
  userId: string;
  companyId: string;
  role: "OWNER" | "ADMIN" | "MANAGER" | "FIELD";
}

export async function getSession(req: Request): Promise<Session | null> {
  const authSession = await auth();
  if (!authSession?.user?.id) return null;

  const requestedCompanyId = req.headers.get("x-company-id");

  const membership = await prisma.companyUser.findFirst({
    where: {
      userId: authSession.user.id,
      status: "ACTIVE",
      ...(requestedCompanyId ? { companyId: requestedCompanyId } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  // A requested company the user doesn't belong to is a forged/stale header,
  // not a "pick the default" situation — fail closed.
  if (requestedCompanyId && !membership) return null;
  if (!membership) return null;

  return { userId: authSession.user.id, companyId: membership.companyId, role: membership.role };
}

export function requireRole(session: Session, roles: Session["role"][]) {
  if (!roles.includes(session.role)) {
    throw new ApiError(403, "Forbidden");
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
