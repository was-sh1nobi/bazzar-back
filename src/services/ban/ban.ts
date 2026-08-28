import { db } from "../../db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/**
 * Ban state for Minecraft players. Kept in an in-memory set so the request
 * guard never hits SQLite on the hot path; refreshed on change + every 30s
 * (so manual DB edits are picked up too).
 */
type BannedCache = {set: Set<string>; loadedAt: number};
let cache: BannedCache = {set: new Set(), loadedAt: 0};
const CACHE_TTL = 30_000;

export const loadBanned = (): Set<string> => {
    const rows = db.query(`SELECT playeruuid FROM users WHERE banned = 1`).all() as {playeruuid: string}[];
    cache = {set: new Set(rows.map((r) => r.playeruuid.toLowerCase())), loadedAt: Date.now()};
    return cache.set;
};

export const isBanned = (uuid: string): boolean => {
    if (Date.now() - cache.loadedAt > CACHE_TTL) loadBanned();
    return cache.set.has(uuid.toLowerCase());
};

export const setBanned = (uuid: string, banned: boolean) => {
    db.query(`UPDATE users SET banned = $1 WHERE playeruuid = $2`).run(banned ? 1 : 0, uuid);
    loadBanned();
};

export type BannedRow = {playeruuid: string; username: string; created_at: number | null};

export const listBanned = (): BannedRow[] =>
    db.query(`SELECT playeruuid, username, created_at FROM users WHERE banned = 1 ORDER BY created_at DESC`)
        .all() as BannedRow[];

/**
 * Pull every UUID-shaped player identifier out of a request (query + parsed
 * body) so the guard can check them all before any endpoint runs.
 */
export const extractPlayerUuids = (req: {query?: Record<string, unknown>; body?: unknown}): string[] => {
    const out: string[] = [];
    const push = (v: unknown) => { if (isUuid(v)) out.push(v.toLowerCase()); };
    const q = req.query ?? {};
    push(q.player);
    const b = req.body;
    if (b && typeof b === "object") {
        const body = b as Record<string, unknown>;
        push(body.playerUuid);
        push(body.buyerId);
        push(body.sellerId);
        push(body.player);
    }
    return out;
};