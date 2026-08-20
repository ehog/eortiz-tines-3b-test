/** Configurable blended rate — the single lever that turns hours into dollars. */
export const BLENDED_RATE_USD = Number(process.env.BLENDED_HOURLY_RATE ?? 96);
export const RATE_BASIS =
  "Blended fully-loaded internal rate across billable and non-billable roles, set by Finance.";
export const HISTORY_DAYS = 90;
export const DUPLICATE_THRESHOLD = 0.5;
