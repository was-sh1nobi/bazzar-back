import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { db, pool } from "../../db";

const ITEMS_PATH = join(__dirname, "../../data/items.json");

export type ShopItemRow = { id: string; material: string; category: string; buy: number; sell: number };

let seeded = false;

export function seedShopItemsIfNeeded() {
    if (seeded) return;
    seeded = true;
    try {
        const count = pool.query(`SELECT COUNT(*) as c FROM shop_items`).rows[0] as { c: number };
        if (Number(count.c) > 0) return;
        if (!existsSync(ITEMS_PATH)) {
            console.warn(`[shop] items.json not found at ${ITEMS_PATH}, skip seed`);
            return;
        }
        const raw = readFileSync(ITEMS_PATH, "utf-8");
        const json = JSON.parse(raw) as { items: ShopItemRow[] };
        const items = json.items ?? [];
        const stmt = db.prepare(`INSERT OR IGNORE INTO shop_items (id, material, category, buy, sell) VALUES (?,?,?,?,?)`);
        let inserted = 0;
        for (const it of items) {
            if (!it.id || !it.material || !it.category) continue;
            const buy = Number(it.buy);
            const sell = Number(it.sell);
            if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy < 0 || sell < 0) continue;
            stmt.run(it.id, it.material, it.category, buy, sell);
            inserted++;
        }
        console.log(`[shop] seeded ${inserted} shop_items from items.json`);
    } catch (e) {
        console.error("[shop] seed failed", e);
    }
}

export function getShopItemById(id: string): ShopItemRow | null {
    const res = pool.query(`SELECT id, material, category, buy, sell FROM shop_items WHERE id = $1 LIMIT 1`, [id]);
    if (res.rows.length === 0) return null;
    return res.rows[0] as ShopItemRow;
}

export function getShopItemByMaterial(material: string): ShopItemRow | null {
    const res = pool.query(`SELECT id, material, category, buy, sell FROM shop_items WHERE material = $1 LIMIT 1`, [material]);
    if (res.rows.length === 0) return null;
    return res.rows[0] as ShopItemRow;
}

export function reloadShopItemsFromFile(): number {
    if (!existsSync(ITEMS_PATH)) throw new Error("items.json not found");
    const raw = readFileSync(ITEMS_PATH, "utf-8");
    const json = JSON.parse(raw) as { items: ShopItemRow[] };
    const items = json.items ?? [];
    db.exec("DELETE FROM shop_items");
    const stmt = db.prepare(`INSERT INTO shop_items (id, material, category, buy, sell) VALUES (?,?,?,?,?)`);
    let inserted = 0;
    for (const it of items) {
        if (!it.id || !it.material || !it.category) continue;
        const buy = Number(it.buy);
        const sell = Number(it.sell);
        if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy < 0 || sell < 0) continue;
        stmt.run(it.id, it.material, it.category, buy, sell);
        inserted++;
    }
    return inserted;
}

export function updateShopItemPrices(id: string, buy?: number, sell?: number): ShopItemRow | null {
    const item = getShopItemById(id);
    if (!item) return null;
    const newBuy = buy !== undefined && Number.isFinite(buy) && buy >= 0 ? buy : item.buy;
    const newSell = sell !== undefined && Number.isFinite(sell) && sell >= 0 ? sell : item.sell;
    pool.query(`UPDATE shop_items SET buy = $1, sell = $2 WHERE id = $3`, [newBuy, newSell, id]);
    return { ...item, buy: newBuy, sell: newSell };
}
