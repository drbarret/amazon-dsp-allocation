import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  if (session.user.active === false) {
    redirect("/login?error=deactivated");
  }

  return (
    <OnboardingForm
      userName={session.user.name ?? ""}
      userEmail={session.user.email ?? ""}
    />
  );
}
