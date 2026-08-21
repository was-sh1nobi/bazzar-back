export type Origin = "survival" | "creative" | "command" | "unknown";
export type Source = "player" | "creative" | "command" | "admin" | "unknown";

const BLOCKED_ORIGINS = new Set<string>(["creative", "command", "unknown"]);
const BLOCKED_SOURCES = new Set<string>(["creative", "admin", "command"]);

export const normalizeOrigin = (raw: unknown): Origin => {
    const v = String(raw ?? "survival").trim().toLowerCase();
    if (v === "creative" || v === "command" || v === "unknown" || v === "survival") return v as Origin;
    return "unknown";
};

export const normalizeSource = (raw: unknown): Source => {
    const v = String(raw ?? "player").trim().toLowerCase();
    if (v === "player" || v === "creative" || v === "command" || v === "admin" || v === "unknown") return v as Source;
    return "unknown";
};

export const isBlocked = (source: unknown, origin: unknown): boolean => {
    const s = normalizeSource(source);
    const o = normalizeOrigin(origin);
    return BLOCKED_SOURCES.has(s) || BLOCKED_ORIGINS.has(o);
};

export const blockedReason = (source: unknown, origin: unknown): string | null => {
    const s = normalizeSource(source);
    const o = normalizeOrigin(origin);
    if (BLOCKED_SOURCES.has(s)) return `blocked source: ${s}`;
    if (BLOCKED_ORIGINS.has(o)) return `blocked origin: ${o}`;
    return null;
};
