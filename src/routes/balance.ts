import {FastifyInstance} from "fastify";
import {getBalance} from "../services/balance/balance";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (res: {code: (c: number) => {send: (b: unknown) => unknown}}, code: number, message: string) =>
    res.code(code).send({success: false, message});

// Balance writes are PRIVATE — no public endpoint.
// All mutations go through private services:
//   - POST /shop/buy  (price from DB, atomic deduct)
//   - POST /shop/sell (price from DB, atomic credit)
//   - POST /items/buy (auction purchase, internal changeBalance)
// Plugin never sends a delta; it only sends MATERIAL/itemId + amount.
// GET /balance remains public (read-only) for UI.

export default async function balanceRoute(app: FastifyInstance) {
    app.get<{Querystring: {player?: string}}>('/', async (req, res) => {
        const player = req.query.player;
        if (!player || !UUID_RE.test(player)) return fail(res, 400, "player query param is required");
        const balance = await getBalance(player);
        res.code(200).send({playerUuid: player, balance});
    });
}