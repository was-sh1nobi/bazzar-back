import {FastifyInstance} from "fastify";
import {pool, bumpVersion} from "../db";
import {registerIfAbsent} from "../utils/registerIfAbsent";
import {isBlocked, normalizeOrigin, normalizeSource} from "../utils/provenance";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const materialRe = /^[A-Z0-9_]+$/;

const fail = (res: {code: (c: number) => {send: (b: unknown) => unknown}}, code: number, message: string) =>
    res.code(code).send({success: false, message});

export default async function auctionRoute(app: FastifyInstance) {
    app.post<{
        Body: {playerUuid?: string; playerName?: string; material?: string; amount?: number; price?: number; source?: string; origin?: string}
    }>('/list', async (req, res) => {
        const {playerUuid, playerName, material, amount, price, source, origin} = req.body;

        if (!playerUuid || !UUID_RE.test(playerUuid)) return fail(res, 400, "malformed player UUID");
        if (!playerName || /\s/.test(playerName.trim())) return fail(res, 400, "Player name cannot contain spaces");
        if (!material || !materialRe.test(material.trim())) return fail(res, 400, "material must be uppercase");
        const amt = Number(amount);
        if (!Number.isFinite(amt) || amt <= 0 || amt > 64) return fail(res, 400, "invalid amount of item");
        const p = Number(price);
        if (!Number.isFinite(p) || p <= 0) return fail(res, 400, "invalid price");

        // ---- Provenance double-check (backend authoritative) ----
        const src = normalizeSource(source);
        const org = normalizeOrigin(origin);
        if (isBlocked(src, org)) {
            return fail(res, 400, `blocked origin: ${org} (source=${src}) cannot enter economy`);
        }

        registerIfAbsent(playerName.trim(), playerUuid);
        try {
            const stmt = await pool.query(
                `INSERT INTO items (seller, material, amount, price, source, origin, status)
                 VALUES ($1,$2,$3,$4,$5,$6,'AVAILABLE') RETURNING id`,
                [playerName.trim(), material.trim(), amt, String(p), src, org]
            );
            bumpVersion();
            return res.code(200).send({success: true, message: `item created with id : ${stmt.rows[0].id}`});
        } catch (error) {
            console.error(error);
            return fail(res, 500, "unexpected error occurred");
        }
    });
}