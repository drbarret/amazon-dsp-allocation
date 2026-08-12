import type { UserRole } from "@/generated/prisma";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: UserRole;
      amazonSub?: string | null;
    };
  }

  interface User {
    role?: UserRole;
    amazonSub?: string | null;
  }
}

declare module "@auth/core/adapters" {
  interface AdapterUser {
    role?: UserRole;
    amazonSub?: string | null;
  }
}
