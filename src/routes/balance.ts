import {FastifyInstance} from "fastify";
import {getBalance, registerIfAbsentByUuid, setBalance, changeBalance} from "../services/balance/balance";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (res: {code: (c: number) => {send: (b: unknown) => unknown}}, code: number, message: string) =>
    res.code(code).send({success: false, message});

export default async function balanceRoute(app: FastifyInstance) {
    app.get<{Querystring: {player?: string}}>('/', async (req, res) => {
        const player = req.query.player;
        if (!player || !UUID_RE.test(player)) return fail(res, 400, "player query param is required");
        const balance = await getBalance(player);
        res.code(200).send({playerUuid: player, balance});
    });

    app.post<{Body: {playerUuid?: string; playerName?: string; balance?: number}}>('/set', async (req, res) => {
        const {playerUuid, playerName, balance} = req.body;
        if (!playerUuid || !UUID_RE.test(playerUuid)) return fail(res, 400, "malformed player UUID");
        const b = Number(balance);
        if (!Number.isFinite(b) || b < 0) return fail(res, 400, "invalid balance");
        registerIfAbsentByUuid(playerUuid, playerName);
        await setBalance(playerUuid, b);
        res.code(200).send({success: true, balance: b});
    });

    app.post<{Body: {playerUuid?: string; playerName?: string; delta?: number}}>('/change', async (req, res) => {
        const {playerUuid, playerName, delta} = req.body;
        if (!playerUuid || !UUID_RE.test(playerUuid)) return fail(res, 400, "malformed player UUID");
        const d = Number(delta);
        if (!Number.isFinite(d)) return fail(res, 400, "invalid delta");
        registerIfAbsentByUuid(playerUuid, playerName);
        try {
            const balance = await changeBalance(playerUuid, d);
            res.code(200).send({success: true, balance});
        } catch (e) {
            res.code(400).send({success: false, message: "insufficient funds"});
        }
    });
}