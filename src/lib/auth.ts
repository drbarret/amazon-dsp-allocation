import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { authorizeSignIn } from "@/lib/access-control";
import { writeAuditLog } from "@/lib/audit";
import type { UserRole } from "@/generated/prisma";

const ROLE_FRESHNESS_MS = 60_000; // 60 seconds

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    {
      id: "amazon",
      name: "Amazon",
      type: "oauth",
      authorization: {
        url: "https://www.amazon.com/ap/oa",
        params: { scope: "profile" },
      },
      token: "https://api.amazon.com/auth/o2/token",
      userinfo: "https://api.amazon.com/user/profile",
      profile(profile) {
        return {
          id: profile.user_id,
          name: profile.name,
          email: profile.email,
          image: null,
        };
      },
      clientId: process.env.AUTH_AMAZON_ID,
      clientSecret: process.env.AUTH_AMAZON_SECRET,
    },
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;

      if (account?.provider === "amazon") {
        const existingUser = await prisma.user.findUnique({
          where: { email: user.email },
        });

        if (existingUser) {
          // Update amazon sub and last login
          await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              amazonSub: account.providerAccountId,
              lastLoginAt: new Date(),
            },
          });

          // Refuse deactivated users
          if (!existingUser.active) {
            await writeAuditLog({
              eventType: "ACCESS_DENIED",
              targetUserId: existingUser.id,
              metadata: { reason: "user_deactivated", email: user.email },
            });
            return "/auth-error?error=deactivated";
          }

          // Log successful login
          await writeAuditLog({
            eventType: "LOGIN",
            actorId: existingUser.id,
          });

          return true;
        }

        // New user: check access control
        const authz = await authorizeSignIn(user.email);
        if (!authz.allowed) {
          await writeAuditLog({
            eventType: "ACCESS_DENIED",
            metadata: { reason: authz.reason, email: user.email },
          });
          return "/auth-error?error=unauthorized";
        }
      }

      return true;
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
      }

      // On first sign-in, read role from DB
      if (account?.provider === "amazon" && token.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: token.email },
          select: { role: true, amazonSub: true, active: true },
        });
        if (dbUser) {
          token.role = dbUser.role as UserRole;
          token.amazonSub = dbUser.amazonSub;
          token.active = dbUser.active;
          token.roleLastFetched = Date.now();
        }
      }

      // Re-read role from DB if freshness window expired
      const now = Date.now();
      const lastFetched = (token.roleLastFetched as number) ?? 0;
      if (token.email && now - lastFetched > ROLE_FRESHNESS_MS) {
        const dbUser = await prisma.user.findUnique({
          where: { email: token.email },
          select: { role: true, active: true },
        });
        if (dbUser) {
          token.role = dbUser.role as UserRole;
          token.active = dbUser.active;
          token.roleLastFetched = now;
        } else {
          // User row missing — fail closed
          token.active = false;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
        session.user.amazonSub = token.amazonSub as string | null;
        session.user.active = token.active as boolean | undefined;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/auth-error",
  },
  session: {
    strategy: "jwt",
  },
  trustHost: true,
});
