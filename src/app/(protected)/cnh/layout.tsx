import { requireRole } from "@/lib/authz";

export default async function CnhLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // CNH collection is a supervisor action (SUPERVISOR or above).
  await requireRole("SUPERVISOR");
  return <>{children}</>;
}
