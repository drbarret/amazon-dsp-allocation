import { requireRole } from "@/lib/authz";
import {
  listPendingDeactivationRequests,
  listResolvedDeactivationRequests,
} from "../actions";
import { DeactivationRequestsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function DeactivationRequestsPage() {
  await requireRole("SUPERVISOR");

  const pending = await listPendingDeactivationRequests();
  const resolved = await listResolvedDeactivationRequests();

  return (
    <DeactivationRequestsClient
      pending={pending}
      resolved={resolved}
    />
  );
}
