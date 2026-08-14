"use server";

import { auth } from "@/lib/auth";
import { completeOnboarding } from "@/lib/onboarding";
import { redirect } from "next/navigation";
import type { VehicleType, VehicleRestrictionCode } from "@/generated/prisma";

export async function submitOnboarding(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const cpf = (formData.get("cpf") as string) ?? "";
  const phone = (formData.get("phone") as string) ?? "";
  const vehicleType = (formData.get("vehicleType") as string) ?? "CARGO_VAN";
  const transporterId = (formData.get("transporterId") as string) ?? "";
  const consentGiven = formData.get("consent") === "on";

  // Parse restriction codes from checkboxes
  const restrictionCodes: VehicleRestrictionCode[] = [];
  const validCodes: VehicleRestrictionCode[] = [
    "GNV",
    "REFRIGERADOR",
    "CAPACIDADE_REDUZIDA",
  ];
  for (const code of validCodes) {
    if (formData.get(`restriction_${code}`) === "on") {
      restrictionCodes.push(code);
    }
  }

  // Parse city preferences (1-3 cities, comma-separated in order)
  const cityPreferencesRaw = (formData.get("cityPreferences") as string) ?? "";
  const cityPreferenceCities = cityPreferencesRaw
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const result = await completeOnboarding(session.user.id, {
    cpf,
    phone,
    vehicleType: vehicleType as VehicleType,
    restrictionCodes,
    transporterId,
    consentGiven,
    cityPreferenceCities,
  });

  if (!result.success) {
    return { error: result.error! };
  }

  redirect("/dashboard");
}
