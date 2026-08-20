// Test-only runtime overrides may shorten validation budgets, but they must
// never expand compiled production authority.
export function narrowedTestLimit(raw: string | undefined, hardMax: number): number {
  if (!Number.isSafeInteger(hardMax) || hardMax < 1) {
    throw new Error("hardMax must be a positive safe integer")
  }
  if (raw === undefined || raw.trim() === "") return hardMax
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) return hardMax
  return Math.min(value, hardMax)
}
