import { requireRole } from "@/lib/authz";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Enforce ACCOUNT_MANAGER+ at layout level
  await requireRole("ACCOUNT_MANAGER");
  return <>{children}</>;
}
