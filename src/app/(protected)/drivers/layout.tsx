import { requireRole } from "@/lib/authz";

export default async function DriversLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // SUPERVISOR+ can manage driver vehicle restrictions
  await requireRole("SUPERVISOR");
  return <>{children}</>;
}
