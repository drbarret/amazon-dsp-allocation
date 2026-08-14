import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { signInDecision } from "@/lib/sign-in-decision";
import { jwtCallback } from "@/lib/jwt-callback";
import type { UserRole } from "@/generated/prisma";

export { ROLE_FRESHNESS_MS, jwtCallback } from "@/lib/jwt-callback";

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
        const decision = await signInDecision({
          email: user.email,
          providerAccountId: account.providerAccountId,
        });

        if (!decision.allowed) {
          if (decision.reason === "user_deactivated") {
            return "/auth-error?error=deactivated";
          }
          return "/auth-error?error=unauthorized";
        }

        return true;
      }

      return true;
    },
    jwt: jwtCallback,
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
