import { FastifyInstance } from "fastify";
import { extractPlayerUuids, isBanned, loadBanned } from "../services/ban/ban";

/**
 * Registered BEFORE every route in index.ts. Runs at `preValidation` — the
 * earliest Fastify lifecycle point where the parsed JSON body is available —
 * so banned players are rejected before validation, before any handler, on
 * any endpoint (items, auction, balance, auth, shop, ...).
 *
 * `/ui/*` requests are skipped: those are cookie-authenticated admin pages,
 * and the ban API itself must be able to unban a banned player.
 */
export const registerBanGuard = (app: FastifyInstance) => {
    loadBanned();
    app.addHook("preValidation", async (req, res) => {
        const path = req.url.split("?")[0];
        if (path.startsWith("/ui")) return;
        for (const uuid of extractPlayerUuids(req)) {
            if (isBanned(uuid)) {
                return res.code(403).send({success: false, message: "you are banned from the marketplace"});
            }
        }
    });
};