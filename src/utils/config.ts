/**
 * Central environment access — the single place that reads process.env.
 * No secrets are ever hardcoded or defaulted here: missing critical values
 * either fall back to ephemeral dev-only values or fail fast in production.
 */

const nodeEnv = (process.env.NODE_ENV ?? "development").toLowerCase();
export const isProduction = nodeEnv === "production" || nodeEnv === "prod";

/** Positive integer env var with a fallback. */
export const intEnv = (name: string, fallback: number): number => {
    const raw = process.env[name];
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Non-empty trimmed string env var, or undefined. */
export const strEnv = (name: string): string | undefined => {
    const v = process.env[name];
    return v && v.trim() ? v.trim() : undefined;
};

/** Boolean env var ("1"/"true" → true). */
export const boolEnv = (name: string, fallback = false): boolean => {
    const v = strEnv(name);
    if (v === undefined) return fallback;
    return v === "1" || v.toLowerCase() === "true";
};
