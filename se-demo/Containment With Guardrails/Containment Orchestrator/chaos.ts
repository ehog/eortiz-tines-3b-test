export const CHAOS_KEYS = [
  "proofpoint_500",
  "zscaler_timeout",
  "defender_429",
  "servicenow_400",
  "isolate_fail",
] as const;

export type ChaosKey = (typeof CHAOS_KEYS)[number];
export type ChaosMode = "fail_n" | "always";

export interface ChaosSetting {
  enabled: boolean;
  mode: ChaosMode;
  failures: number;
}

export type ChaosConfig = Record<ChaosKey, ChaosSetting>;

export function defaultChaos(): ChaosConfig {
  return CHAOS_KEYS.reduce((acc, key) => {
    acc[key] = { enabled: false, mode: "fail_n", failures: 2 };
    return acc;
  }, {} as ChaosConfig);
}

export function normalizeChaos(input: unknown): ChaosConfig {
  const chaos = defaultChaos();
  if (!input || typeof input !== "object") return chaos;
  for (const key of CHAOS_KEYS) {
    const raw = (input as Record<string, unknown>)[key];
    if (!raw || typeof raw !== "object") continue;
    const setting = raw as Partial<ChaosSetting>;
    chaos[key] = {
      enabled: setting.enabled === true,
      mode: setting.mode === "always" ? "always" : "fail_n",
      failures: Math.min(6, Math.max(1, Math.trunc(Number(setting.failures ?? 2)) || 2)),
    };
  }
  return chaos;
}

export function chaosSummary(chaos: ChaosConfig): string[] {
  return CHAOS_KEYS.filter((key) => chaos[key].enabled).map((key) =>
    chaos[key].mode === "always" ? `${key}: fail always` : `${key}: fail ${chaos[key].failures} then succeed`,
  );
}
