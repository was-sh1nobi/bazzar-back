import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { strEnv, isProduction } from "../utils/config";

/**
 * Plugin-to-backend authentication.
 * All mutating MC endpoints (shop buy/sell, auction list, items/*) require
 * header `x-plugin-secret` matching PLUGIN_SECRET env.
 * Without it any curl can spoof any playerUuid (C1).
 *
 * - If PLUGIN_SECRET is not set: in production fail closed (503),
 *   in dev/test allow but warn (so local dev without secret works).
 * - GET /balance and GET /shop/catalog remain public (read-only).
 * - /ui/* is cookie-JWT authenticated separately, not checked here.
 */
const getSecret = () => strEnv("PLUGIN_SECRET");

export const requirePluginSecret = (req: FastifyRequest, res: FastifyReply): boolean => {
    const secret = getSecret();
    if (!secret) {
        if (isProduction) {
            res.code(503).send({ success: false, message: "server misconfigured — PLUGIN_SECRET not set" });
            return false;
        }
        // dev: allow without secret but log once
        return true;
    }
    const provided = (req.headers["x-plugin-secret"] as string | undefined) ?? (req.headers["x-bazzar-secret"] as string | undefined);
    if (provided !== secret) {
        res.code(401).send({ success: false, message: "unauthorized — invalid plugin secret" });
        return false;
    }
    return true;
};

export const registerPluginAuth = (app: FastifyInstance) => {
    // Only guard mutating MC routes; keep reads open.
    const guarded = new Set(["POST", "PUT", "PATCH", "DELETE"]);
    const guardedPrefixes = ["/shop/buy", "/shop/sell", "/list", "/items/add", "/items/buy", "/items/retrieve", "/shop/catalog/reload"];
    app.addHook("preValidation", async (req, res) => {
        if (!guarded.has(req.method.toUpperCase())) return;
        const path = (req.raw.url ?? req.url).split("?")[0];
        // skip /ui and /auth and /balance (already private except GET)
        if (path.startsWith("/ui") || path.startsWith("/auth")) return;
        const needsAuth = guardedPrefixes.some(p => path === p || path.startsWith(p + "/") || path === p);
        // also guard /shop/catalog/reload exactly
        if (!needsAuth) return;
        if (!requirePluginSecret(req as FastifyRequest, res as FastifyReply)) {
            // hook must return to stop handler
            return;
        }
    });
};
