import Fastify, {FastifyInstance} from "fastify";
import {pool} from "../db";
import {ItemsAddBody} from "../types/items/items";
import {registerIfAbsent} from "../utils/registerIfAbsent";
import {getItems, getBySeller, getByBuyer, getHistory} from "../services/items/items";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const envelope = (data: {
    items: unknown[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}) => ({
    page: data.page,
    pageSize: data.pageSize,
    total: data.total,
    totalPages: data.totalPages,
    items: data.items,
});

interface ListQuery {
    page?: number;
    pageSize?: number;
    player?: string;
}

const parsePage = (raw: unknown, fallback: number) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

const materialRe = /^[A-Z0-9_]+$/;

const fail = (res: {code: (c: number) => {send: (b: unknown) => unknown}}, code: number, message: string) =>
    res.code(code).send({success: false, message});

export default async function itemsRoute(app: FastifyInstance) {
    app.get<{Querystring: ListQuery}>('/', async (req, res) => {
        const page = parsePage(req.query.page, 0);
        const pageSize = parsePage(req.query.pageSize, 45);
        const data = await getItems(page, pageSize);
        res.code(200).send(envelope(data));
    });

    app.get<{Querystring: ListQuery}>('/active', async (req, res) => {
        const player = req.query.player;
        if (!player) return fail(res, 400, "player query param is required");
        const page = parsePage(req.query.page, 0);
        const pageSize = parsePage(req.query.pageSize, 45);
        const data = await getBySeller(player, page, pageSize);
        res.code(200).send(envelope(data));
    });

    app.get<{Querystring: ListQuery}>('/bought', async (req, res) => {
        const player = req.query.player;
        if (!player) return fail(res, 400, "player query param is required");
        const page = parsePage(req.query.page, 0);
        const pageSize = parsePage(req.query.pageSize, 45);
        const data = await getByBuyer(player, page, pageSize);
        res.code(200).send(envelope(data));
    });

    app.get<{Querystring: ListQuery}>('/history', async (req, res) => {
        const player = req.query.player;
        if (!player) return fail(res, 400, "player query param is required");
        const page = parsePage(req.query.page, 0);
        const pageSize = parsePage(req.query.pageSize, 45);
        const data = await getHistory(player, page, pageSize);
        res.code(200).send(envelope(data));
    });

    app.post<{Body: ItemsAddBody}>('/add', async (req, res) => {
        const {playeruuid, playerName, material, amount, price, source, origin} = req.body;
        registerIfAbsent(playerName, playeruuid);
        if (price.length > 20) return fail(res, 400, "Price length cant go higher than 20");
        if (/\s/.test(playerName.trim())) return fail(res, 400, "Player name cannot contain spaces");
        if (!materialRe.test(material.trim())) return fail(res, 400, "material must be uppercase");
        const amt = Number(amount.trim());
        if (!Number.isFinite(amt) || amt <= 0 || amt > 64) return fail(res, 400, "invalid amount of item");

        try {
            const stmt = await pool.query(
                `INSERT INTO items (seller, material, amount, price, source, origin, status)
                 VALUES ($1,$2,$3,$4,$5,$6,'AVAILABLE') RETURNING id`,
                [playerName.trim(), material.trim(), amount, price, source, origin]
            );
            return res.code(200).send({success: true, message: `item created with id : ${stmt.rows[0].id}`});
        } catch (error) {
            console.error(error);
            return fail(res, 500, "unexpected error occurred");
        }
    });

    app.post<{Body: {wantedId?: number; buyerId?: string}}>('/buy', async (req, res) => {
        const {wantedId, buyerId} = req.body;
        if (!Number.isFinite(Number(wantedId))) return fail(res, 400, "invalid wantedId");
        if (!buyerId || !UUID_RE.test(buyerId)) return fail(res, 400, "malformed buyer UUID");

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const data = await client.query(
                `UPDATE items SET status = 'PENDING'
                 WHERE id = $1 AND status = 'AVAILABLE'
                 RETURNING *`,
                [wantedId]
            );

            if (data.rows.length === 0) {
                const check = await client.query(`SELECT status FROM items WHERE id = $1`, [wantedId]);

                if (check.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return fail(res, 404, "item not found");
                }

                const status = check.rows[0].status;
                await client.query('ROLLBACK');

                if (status === "PENDING") return fail(res, 400, "item is processing for someone else");
                if (status === "SOLD") return fail(res, 400, "item sold out");
            }

            const item = data.rows[0];

            await client.query("UPDATE items SET status = 'SOLD' WHERE id = $1", [wantedId]);

            const response = await client.query(
                `INSERT INTO history (seller, buyer, material, price, amount, source, origin)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
                [item.seller, buyerId, item.material, item.price, item.amount, item.source, item.origin]
            );

            await client.query('COMMIT');

            return res.code(200).send({
                success: true,
                message: `item added with id : ${response.rows[0].id}`,
            });
        } catch (e) {
            await client.query('ROLLBACK');
            console.error(e);
            return fail(res, 500, "unexpected error occurred");
        } finally {
            client.release();
        }
    });
}
