/**
 * CNH expiry date validation (shared, non-server module).
 *
 * Bounds:
 *   - Lower bound: 1990-01-01. The modern Brazilian CNH was introduced in the
 *     1990s; an expiry date before 1990 is implausible for any active driver.
 *   - Upper bound: today + 10 years. Brazilian CNH validity is up to 10 years
 *     (drivers under 50), so a date more than 10 years out is implausible and
 *     almost certainly a data-entry error.
 */
export const CNH_MIN_DATE = new Date("1990-01-01T00:00:00.000Z");
export const CNH_MAX_FUTURE_YEARS = 10;

export function isValidCnhDate(value: Date): { valid: boolean; error?: string } {
  if (Number.isNaN(value.getTime())) {
    return { valid: false, error: "Data de vencimento da CNH inválida." };
  }
  if (value < CNH_MIN_DATE) {
    return {
      valid: false,
      error: "Data de vencimento da CNH anterior a 1990 é inválida.",
    };
  }
  const max = new Date();
  max.setFullYear(max.getFullYear() + CNH_MAX_FUTURE_YEARS);
  if (value > max) {
    return {
      valid: false,
      error: `Data de vencimento da CNH não pode ser mais de ${CNH_MAX_FUTURE_YEARS} anos no futuro.`,
    };
  }
  return { valid: true };
}
