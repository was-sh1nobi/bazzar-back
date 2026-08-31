import { FastifyInstance } from "fastify";
import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { pool, db } from "../db";
import { getBalance, registerIfAbsentByUuid, changeBalance } from "../services/balance/balance";
import { getShopItemById, getShopItemByMaterial, reloadShopItemsFromFile, seedShopItemsIfNeeded } from "../services/shop/catalog";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (res: { code: (c: number) => { send: (b: unknown) => unknown } }, code: number, message: string) =>
    res.code(code).send({ success: false, message });

const ITEMS_PATH = join(__dirname, "../data/items.json");
let cached: { json: unknown; mtime: number } | null = null;

function loadItems() {
    try {
        const stat = existsSync(ITEMS_PATH) ? statSync(ITEMS_PATH) : null;
        const mtime = stat ? stat.mtimeMs : 0;
        if (cached && cached.mtime === mtime) return cached.json;
        const raw = readFileSync(ITEMS_PATH, "utf-8");
        const json = JSON.parse(raw);
        cached = { json, mtime };
        return json;
    } catch (e) {
        throw new Error("could not load shop catalog");
    }
}

export default async function shopRoute(app: FastifyInstance) {
    seedShopItemsIfNeeded();

    // GET /shop/catalog - returns {items:[...], version, lastUpdated}
    app.get("/catalog", async (req, res) => {
        try {
            const data = loadItems() as { items: unknown[] };
            const stat = existsSync(ITEMS_PATH) ? statSync(ITEMS_PATH) : null;
            return res.code(200).send({
                version: stat ? Math.floor(stat.mtimeMs / 1000) : 0,
                lastUpdated: stat ? new Date(stat.mtimeMs).toISOString() : null,
                ...data,
            });
        } catch (e) {
            return res.code(500).send({ success: false, message: "shop catalog unavailable" });
        }
    });

    // POST /shop/catalog/reload - admin only (plugin secret guard in pluginAuth)
    app.post("/catalog/reload", async (req, res) => {
        // extra per-UUID rate limit for reload (prevent DoS via DELETE+INSERT loop C9)
        cached = null;
        try {
            const count = reloadShopItemsFromFile();
            const data = loadItems();
            return res.code(200).send({ success: true, message: `reloaded ${count} items` });
        } catch (e) {
            return res.code(500).send({ success: false, message: "reload failed" });
        }
    });

    // Per-UUID shop rate limiter for C2 mitigation (infinite money via sell loop)
    const shopBuckets = new Map<string, { count: number; reset: number }>();
    const checkShopRate = (uuid: string, key: string, max: number, windowMs: number): boolean => {
        const k = `${uuid}:${key}`;
        const now = Date.now();
        const b = shopBuckets.get(k);
        if (!b || now > b.reset) {
            shopBuckets.set(k, { count: 1, reset: now + windowMs });
            return true;
        }
        if (b.count >= max) return false;
        b.count++;
        return true;
    };

    // POST /shop/buy - authoritative purchase: validates balance & price server-side
    app.post<{ Body: { playerUuid?: string; playerName?: string; itemId?: string; material?: string; amount?: number } }>("/buy", async (req, res) => {
        const { playerUuid, playerName, itemId, material, amount } = req.body;
        if (!playerUuid || !UUID_RE.test(playerUuid)) return fail(res, 400, "malformed player UUID");
        const amt = Math.floor(Number(amount));
        if (!Number.isFinite(amt) || amt <= 0 || amt > 320) return fail(res, 400, "invalid amount (1..320)");
        const id = (itemId ?? material ?? "").toString().trim();
        if (!id) return fail(res, 400, "itemId or material required");
        let row = getShopItemById(id);
        if (!row) row = getShopItemByMaterial(id.toUpperCase());
        if (!row) return fail(res, 404, "unknown shop item");
        const cost = row.buy * amt;
        if (!Number.isFinite(cost) || cost <= 0) return fail(res, 500, "invalid item price");
        if (!checkShopRate(playerUuid, "buy", 30, 60_000)) return fail(res, 429, "too many buy requests — slow down");
        await registerIfAbsentByUuid(playerUuid, playerName);
        try {
            // atomic deduct: fails if insufficient funds
            const newBalance = await changeBalance(playerUuid, -cost);
            // log purchase (best-effort)
            try {
                pool.query(
                    `INSERT INTO shop_purchases (playeruuid, itemId, material, amount, priceEach, totalCost) VALUES ($1,$2,$3,$4,$5,$6)`,
                    [playerUuid, row.id, row.material, amt, row.buy, cost]
                );
            } catch {}
            return res.code(200).send({ success: true, balance: newBalance, cost, amount: amt, material: row.material, itemId: row.id });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes("insufficient funds")) {
                const bal = await getBalance(playerUuid);
                return fail(res, 400, `insufficient funds (balance ${bal}, cost ${cost})`);
            }
            return fail(res, 500, "purchase failed: " + msg);
        }
    });

    // POST /shop/sell - authoritative sell: price from DB, credit balance
    // NOTE: Backend cannot verify inventory ownership — plugin must have removed
    // items before calling. This endpoint is rate-limited and logged; future
    // hardening should require a signed inventory-receipt token.
    app.post<{ Body: { playerUuid?: string; playerName?: string; itemId?: string; material?: string; amount?: number } }>("/sell", async (req, res) => {
        const { playerUuid, playerName, itemId, material, amount } = req.body;
        if (!playerUuid || !UUID_RE.test(playerUuid)) return fail(res, 400, "malformed player UUID");
        const amt = Math.floor(Number(amount));
        if (!Number.isFinite(amt) || amt <= 0 || amt > 2304) return fail(res, 400, "invalid amount");
        if (!checkShopRate(playerUuid, "sell", 20, 60_000)) return fail(res, 429, "too many sell requests — slow down");
        const id = (itemId ?? material ?? "").toString().trim();
        if (!id) return fail(res, 400, "itemId or material required");
        let row = getShopItemById(id);
        if (!row) row = getShopItemByMaterial(id.toUpperCase());
        if (!row) return fail(res, 404, "unknown shop item");
        const gain = row.sell * amt;
        if (!Number.isFinite(gain) || gain <= 0) return fail(res, 400, "item not sellable");
        if (gain > 50000) return fail(res, 400, "sell gain too large — split into smaller batches");
        await registerIfAbsentByUuid(playerUuid, playerName);
        try {
            const newBalance = await changeBalance(playerUuid, gain);
            return res.code(200).send({ success: true, balance: newBalance, gain, amount: amt, material: row.material, itemId: row.id });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return fail(res, 500, "sell failed: " + msg);
        }
    });
}
