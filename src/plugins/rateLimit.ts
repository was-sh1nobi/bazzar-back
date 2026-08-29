import {FastifyInstance, FastifyReply, FastifyRequest} from "fastify";
import {intEnv} from "../utils/config";

/**
 * Global in-memory fixed-window rate limiter (no external deps, same pattern
 * as the per-endpoint login guards). Applies to every route with per-zone
 * limits so a burst on one surface can't exhaust the others:
 *
 *   - /ui/api/*   → uiApiMax   (dashboard data & mutations)
 *   - /ui/*       → uiPageMax  (pages + static assets)
 *   - everything else (MC plugin endpoints: /auth, /items, /auction,
 *     /balance, /shop, /stats, /) → mcMax
 *
 * All values are env-tunable; see .env.example.
 */

export type RateLimitOptions = {
    windowMs: number;
    mcMax: number;
    uiPageMax: number;
    uiApiMax: number;
};

export const rateLimitOptionsFromEnv = (): RateLimitOptions => ({
    windowMs: intEnv("RATE_LIMIT_WINDOW_MS", 60_000),
    mcMax: intEnv("RATE_LIMIT_MC_MAX", 120),
    uiPageMax: intEnv("RATE_LIMIT_UI_MAX", 300),
    uiApiMax: intEnv("RATE_LIMIT_UI_API_MAX", 120),
});

type Bucket = {count: number; reset: number};
const buckets = new Map<string, Bucket>();

const take = (key: string, max: number, windowMs: number): {allowed: boolean; retryAfter: number} => {
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || now > b.reset) {
        buckets.set(key, {count: 1, reset: now + windowMs});
        return {allowed: true, retryAfter: 0};
    }
    if (b.count >= max) return {allowed: false, retryAfter: Math.max(1, Math.ceil((b.reset - now) / 1000))};
    b.count++;
    return {allowed: true, retryAfter: 0};
};

export const registerRateLimit = (app: FastifyInstance, opts: RateLimitOptions = rateLimitOptionsFromEnv()) => {
    // Periodic sweep so idle IPs don't pin memory forever.
    const sweep = setInterval(() => {
        const now = Date.now();
        for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
    }, opts.windowMs);
    sweep.unref?.();

    app.addHook("onRequest", async (req: FastifyRequest, res: FastifyReply) => {
        const path = (req.raw.url ?? req.url).split("?")[0];
        let max: number;
        if (path.startsWith("/ui/api/")) max = opts.uiApiMax;
        else if (path.startsWith("/ui/")) max = opts.uiPageMax;
        else max = opts.mcMax;

        const {allowed, retryAfter} = take(`${max}:${req.ip}`, max, opts.windowMs);
        if (!allowed) {
            res.code(429)
                .header("retry-after", String(retryAfter))
                .header("content-type", "application/json; charset=utf-8")
                .send({success: false, message: "too many requests — slow down and retry shortly"});
        }
    });
};
