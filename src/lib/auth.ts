import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@/generated/prisma";

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

      // On first sign-in, create the user with a default DRIVER role.
      // The Prisma adapter already creates the user row, but we need to
      // set the role and amazonSub. We do this via a DB check after the
      // adapter has created the user.
      if (account?.provider === "amazon") {
        const existingUser = await prisma.user.findUnique({
          where: { email: user.email },
        });

        if (existingUser) {
          // Update amazonSub and lastLoginAt on every login
          await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              amazonSub: account.providerAccountId,
              lastLoginAt: new Date(),
            },
          });

          // Block inactive users
          if (!existingUser.active) {
            return false;
          }
        }
      }

      return true;
    },
    async session({ session, user }) {
      // Attach role and amazonSub to the session
      if (session.user) {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { role: true, amazonSub: true },
        });
        if (dbUser) {
          session.user.role = dbUser.role as UserRole;
          session.user.amazonSub = dbUser.amazonSub;
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "database",
  },
});
