// Order is load-bearing: the low→high ramp, not just a validation set.
export const effortLevels = ["low", "medium", "high", "max"] as const;

export type EffortLevel = (typeof effortLevels)[number];

export function isEffortLevel(value: unknown): value is EffortLevel {
  return (
    typeof value === "string" &&
    (effortLevels as readonly string[]).includes(value)
  );
}

// Per-model effort capability: an ordered rule list matched against the model id;
// the first matching rule's `levels` win. A model that matches no rule (or a
// provider with no rules) has no reasoning-effort knob.
export type ModelEffortRule = {
  pattern: RegExp;
  levels: readonly EffortLevel[];
};

export function availableEffortLevels(
  rules: readonly ModelEffortRule[],
  model: string
): readonly EffortLevel[] {
  return rules.find((rule) => rule.pattern.test(model))?.levels ?? [];
}

// Clamp a requested level to what the model offers, or null when the model has
// no reasoning-effort knob.
export function clampEffort(
  rules: readonly ModelEffortRule[],
  model: string,
  effort: EffortLevel
): EffortLevel | null {
  const available = availableEffortLevels(rules, model);
  if (available.includes(effort)) return effort;
  return available.at(-1) ?? null;
}
