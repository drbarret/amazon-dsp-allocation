import { prisma } from "@/lib/prisma";
import { encrypt, computeCpfBlindIndex } from "@/lib/crypto";
import { writeAuditLog } from "@/lib/audit";
import type { VehicleType, VehicleRestrictionCode } from "@/generated/prisma";

/**
 * Check whether a DRIVER user needs to complete onboarding.
 * Returns true if the user is a DRIVER and either has no DriverProfile
 * or has one with onboardingCompleted === false.
 */
export async function needsOnboarding(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      driverProfile: { select: { onboardingCompleted: true } },
    },
  });

  if (!user) return false;
  if (user.role !== "DRIVER") return false;
  if (!user.driverProfile) return true;
  return !user.driverProfile.onboardingCompleted;
}

/**
 * Validate a CPF number (Brazilian individual taxpayer ID).
 * Checks format, repeated digits, and the two check digits.
 */
export function validateCpf(cpf: string): { valid: boolean; normalized: string } {
  const normalized = cpf.replace(/\D/g, "");

  if (normalized.length !== 11) return { valid: false, normalized };
  if (/^(\d)\1{10}$/.test(normalized)) return { valid: false, normalized };

  // Validate first check digit
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(normalized[i]) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(normalized[9])) return { valid: false, normalized };

  // Validate second check digit
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(normalized[i]) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(normalized[10])) return { valid: false, normalized };

  return { valid: true, normalized };
}

/**
 * Validate a Brazilian phone number.
 * Accepts formats: (XX) XXXXX-XXXX, (XX) XXXX-XXXX, +55 (XX) XXXXX-XXXX, etc.
 * Returns the normalized digits-only string.
 */
export function validatePhone(phone: string): { valid: boolean; normalized: string } {
  const normalized = phone.replace(/\D/g, "");

  // Brazilian mobile: 55 + DDD (2) + 9 + 8 digits = 13
  // Brazilian landline: 55 + DDD (2) + 8 digits = 12
  // Without country code: DDD (2) + 9 + 8 digits = 11 (mobile) or DDD + 8 = 10 (landline)
  if (normalized.length === 13 && normalized.startsWith("55")) {
    // +55 (XX) XXXXX-XXXX
    return { valid: true, normalized };
  }
  if (normalized.length === 12 && normalized.startsWith("55")) {
    // +55 (XX) XXXX-XXXX
    return { valid: true, normalized };
  }
  if (normalized.length === 11) {
    // (XX) XXXXX-XXXX
    return { valid: true, normalized };
  }
  if (normalized.length === 10) {
    // (XX) XXXX-XXXX
    return { valid: true, normalized };
  }

  return { valid: false, normalized };
}

/** The 8 cities a driver can choose as preferences. */
export const ALLOWED_CITIES = [
  "Jundiaí",
  "Louveira",
  "Várzea Paulista",
  "Campo Limpo",
  "Itupeva",
  "Itatiba",
  "Cabreúva",
  "Vinhedo",
] as const;

export type AllowedCity = (typeof ALLOWED_CITIES)[number];

/**
 * Validate city preferences: 1-3 cities, no duplicates, all from the allowed list.
 * Returns { valid: true } or { valid: false, error: "..." }.
 */
export function validateCityPreferences(cities: string[]): { valid: boolean; error?: string } {
  if (!Array.isArray(cities) || cities.length < 1 || cities.length > 3) {
    return { valid: false, error: "Selecione entre 1 e 3 cidades de preferência." };
  }

  const uniqueCities = new Set(cities);
  if (uniqueCities.size !== cities.length) {
    return { valid: false, error: "Não é permitido selecionar a mesma cidade mais de uma vez." };
  }

  for (const city of cities) {
    if (!(ALLOWED_CITIES as readonly string[]).includes(city)) {
      return { valid: false, error: `Cidade inválida: "${city}". Selecione uma das cidades disponíveis.` };
    }
  }

  return { valid: true };
}

export interface OnboardingInput {
  cpf: string;
  phone: string;
  vehicleType: VehicleType;
  restrictionCodes: VehicleRestrictionCode[];
  transporterId: string;
  consentGiven: boolean;
  cityPreferenceCities: string[];
}

export interface OnboardingResult {
  success: boolean;
  error?: string;
}

/**
 * Pure function: validate and persist driver onboarding data.
 * Callable from Server Actions or test scripts.
 */
export async function completeOnboarding(
  userId: string,
  input: OnboardingInput,
): Promise<OnboardingResult> {
  // 1. Validate CPF
  const cpfResult = validateCpf(input.cpf);
  if (!cpfResult.valid) {
    return { success: false, error: "CPF inválido. Verifique os dígitos e tente novamente." };
  }

  // 2. Validate phone
  const phoneResult = validatePhone(input.phone);
  if (!phoneResult.valid) {
    return {
      success: false,
      error: "Telefone inválido. Use o formato (XX) XXXXX-XXXX.",
    };
  }

  // 3. Validate vehicle type
  const validVehicleTypes: VehicleType[] = ["CARGO_VAN", "LARGE_VAN", "PASSEIO"];
  if (!validVehicleTypes.includes(input.vehicleType)) {
    return { success: false, error: "Tipo de veículo inválido." };
  }

  // 4. Validate consent
  if (!input.consentGiven) {
    return {
      success: false,
      error: "É necessário consentir com o processamento dos dados pessoais (LGPD).",
    };
  }

  // 5. Validate city preferences (1-3 from the 8 allowed cities)
  const cities = input.cityPreferenceCities ?? [];
  const cityValidation = validateCityPreferences(cities);
  if (!cityValidation.valid) {
    return { success: false, error: cityValidation.error! };
  }

  // 6. Check CPF uniqueness via blind index
  const blindIndex = computeCpfBlindIndex(cpfResult.normalized);
  const existing = await prisma.driverProfile.findUnique({
    where: { cpfBlindIndex: blindIndex },
  });
  if (existing && existing.userId !== userId) {
    return {
      success: false,
      error: "Este CPF já está cadastrado para outro motorista.",
    };
  }

  // 7. Encrypt sensitive fields
  const encryptedCpf = encrypt(cpfResult.normalized);
  const encryptedPhone = encrypt(phoneResult.normalized);

  // 8. Upsert driver profile
  await prisma.driverProfile.upsert({
    where: { userId },
    create: {
      userId,
      cpf: encryptedCpf,
      cpfBlindIndex: blindIndex,
      phone: encryptedPhone,
      phoneFormatted: input.phone,
      vehicleType: input.vehicleType,
      transporterId: input.transporterId || null,
      onboardingCompleted: true,
      vehicleRestrictions: {
        create: input.restrictionCodes.map((code) => ({ code })),
      },
      regionPreferences: {
        create: cities.map((city, index) => ({
          city,
          priority: index + 1,
        })),
      },
    },
    update: {
      cpf: encryptedCpf,
      cpfBlindIndex: blindIndex,
      phone: encryptedPhone,
      phoneFormatted: input.phone,
      vehicleType: input.vehicleType,
      transporterId: input.transporterId || null,
      onboardingCompleted: true,
      vehicleRestrictions: {
        deleteMany: {},
        create: input.restrictionCodes.map((code) => ({ code })),
      },
      regionPreferences: {
        deleteMany: {},
        create: cities.map((city, index) => ({
          city,
          priority: index + 1,
        })),
      },
    },
  });

  // 9. Audit log (never store CPF)
  await writeAuditLog({
    eventType: "CONSENT_GIVEN",
    actorId: userId,
    targetUserId: userId,
    metadata: {
      action: "onboarding_completed",
      vehicleType: input.vehicleType,
      restrictionCount: input.restrictionCodes.length,
      cityPreferenceCount: cities.length,
    },
  });

  return { success: true };
}
