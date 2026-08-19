import Fastify, {FastifyInstance} from "fastify";
import {pool, bumpVersion} from "../db";
import {ItemsAddBody} from "../types/items/items";
import {registerIfAbsent} from "../utils/registerIfAbsent";
import {getItems, getBySeller, getByBuyer, getHistory} from "../services/items/items";
import {getBalance, changeBalance} from "../services/balance/balance";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ListQuery {
    page?: number;
    pageSize?: number;
    player?: string;
    since?: number;
    timeout?: number;
}

const parsePage = (raw: unknown, fallback: number) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

const materialRe = /^[A-Z0-9_]+$/;

const fail = (res: {code: (c: number) => {send: (b: unknown) => unknown}}, code: number, message: string) =>
    res.code(code).send({success: false, message});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default async function itemsRoute(app: FastifyInstance) {
    app.get<{Querystring: ListQuery}>('/', async (req, res) => {
        const page = parsePage(req.query.page, 0);
        const pageSize = parsePage(req.query.pageSize, 45);
        const player = req.query.player && UUID_RE.test(req.query.player) ? req.query.player : undefined;
        const data = await getItems(page, pageSize, player);
        res.code(200).send(data);
    });

    app.get<{Querystring: ListQuery}>('/poll', async (req, res) => {
        const page = parsePage(req.query.page, 0);
        const pageSize = parsePage(req.query.pageSize, 45);
        const player = req.query.player && UUID_RE.test(req.query.player) ? req.query.player : undefined;
        const since = Number(req.query.since) || 0;
        const timeoutMs = Math.min(Math.max(Number(req.query.timeout) || 25, 1), 60) * 1000;

        const deadline = Date.now() + timeoutMs;
        let data;
        for (;;) {
            data = await getItems(page, pageSize, player);
            if (data.version > since || Date.now() >= deadline) break;
            await sleep(500);
        }
        res.code(200).send(data);
    });

    app.get<{Querystring: ListQuery}>('/active', async (req, res) => {
        const player = req.query.player;
        if (!player) return fail(res, 400, "player query param is required");
        const page = parsePage(req.query.page, 0);
        const pageSize = parsePage(req.query.pageSize, 45);
        const data = await getBySeller(player, page, pageSize);
        res.code(200).send(data);
    });

    app.get<{Querystring: ListQuery}>('/bought', async (req, res) => {
        const player = req.query.player;
        if (!player) return fail(res, 400, "player query param is required");
        const page = parsePage(req.query.page, 0);
        const pageSize = parsePage(req.query.pageSize, 45);
        const data = await getByBuyer(player, page, pageSize);
        res.code(200).send(data);
    });

    app.get<{Querystring: ListQuery}>('/history', async (req, res) => {
        const player = req.query.player;
        if (!player) return fail(res, 400, "player query param is required");
        const page = parsePage(req.query.page, 0);
        const pageSize = parsePage(req.query.pageSize, 45);
        const data = await getHistory(player, page, pageSize);
        res.code(200).send(data);
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
            bumpVersion();
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

        const item = await pool.query(`SELECT * FROM items WHERE id = $1`, [wantedId]);
        if (item.rows.length === 0) return fail(res, 404, "item not found");

        const listing = item.rows[0] as {
            id: number;
            seller: string;
            material: string;
            amount: number;
            price: string;
            source: string;
            origin: string;
            status: string;
        };

        if (listing.status !== 'AVAILABLE') {
            if (listing.status === 'PENDING') return fail(res, 400, "item is processing for someone else");
            return fail(res, 400, "item sold out");
        }

        const ownerUuid = (pool.query(
            `SELECT playeruuid FROM users WHERE username = $1 LIMIT 1`, [listing.seller]
        ).rows[0] as {playeruuid?: string} | undefined)?.playeruuid;

        if (ownerUuid && ownerUuid === buyerId) {
            return fail(res, 400, "you cannot buy your own listing");
        }

        const cost = Number(listing.price) * listing.amount;
        const buyerBalance = await getBalance(buyerId);
        if (buyerBalance < cost) return fail(res, 400, "insufficient funds");

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
                await client.query('ROLLBACK');
                return fail(res, 400, "item sold out");
            }

            const current = data.rows[0] as typeof listing;
            if (current.seller === listing.seller && ownerUuid && ownerUuid === buyerId) {
                await client.query('ROLLBACK');
                return fail(res, 400, "you cannot buy your own listing");
            }

            await client.query("UPDATE items SET status = 'SOLD' WHERE id = $1", [wantedId]);

            const response = await client.query(
                `INSERT INTO history (seller, buyer, material, price, amount, source, origin)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
                [listing.seller, buyerId, listing.material, listing.price, listing.amount, listing.source, listing.origin]
            );

            await client.query('COMMIT');

            const newBalance = await changeBalance(buyerId, -cost);
            if (ownerUuid) {
                try {
                    await changeBalance(ownerUuid, cost);
                } catch (e) {
                    // seller credit best-effort
                }
            }
            bumpVersion();

            return res.code(200).send({
                success: true,
                balance: newBalance,
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

    app.post<{Body: {wantedId?: number; sellerId?: string}}>('/retrieve', async (req, res) => {
        const {wantedId, sellerId} = req.body;
        if (!Number.isFinite(Number(wantedId))) return fail(res, 400, "invalid wantedId");
        if (!sellerId || !UUID_RE.test(sellerId)) return fail(res, 400, "malformed seller UUID");

        const item = await pool.query(`SELECT * FROM items WHERE id = $1`, [wantedId]);
        if (item.rows.length === 0) return fail(res, 404, "item not found");

        const listing = item.rows[0] as {
            id: number;
            seller: string;
            material: string;
            amount: number;
            price: string;
            status: string;
        };

        if (listing.status !== 'AVAILABLE') return fail(res, 400, "item is not available to retrieve");

        const ownerUuid = (pool.query(
            `SELECT playeruuid FROM users WHERE username = $1 LIMIT 1`, [listing.seller]
        ).rows[0] as {playeruuid?: string} | undefined)?.playeruuid;

        if (!ownerUuid || ownerUuid !== sellerId) return fail(res, 400, "you can only retrieve your own listings");

        pool.query(`UPDATE items SET status = 'REMOVED' WHERE id = $1`, [wantedId]);
        bumpVersion();
        return res.code(200).send({
            success: true,
            material: listing.material,
            amount: listing.amount,
            message: `item ${wantedId} retrieved`,
        });
    });
}