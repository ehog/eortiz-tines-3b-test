export const STAGES = [
  "AI Working Group",
  "AI Board",
  "Business review",
  "Security / IT review",
  "Finance verification",
  "Trial",
  "Implement / Kill",
] as const;

export const FAST_TRACK_STAGES = [
  "AI Working Group",
  "Security / IT review",
  "Trial",
  "Implement / Kill",
] as const;

export type Stage = (typeof STAGES)[number];
