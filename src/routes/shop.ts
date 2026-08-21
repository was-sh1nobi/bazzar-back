import { FastifyInstance } from "fastify";
import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";

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

    // POST /shop/catalog/reload - admin hot reload (optional, checks mtime)
    app.post("/catalog/reload", async (req, res) => {
        cached = null;
        try {
            const data = loadItems();
            return res.code(200).send({ success: true, message: "reloaded" });
        } catch (e) {
            return res.code(500).send({ success: false, message: "reload failed" });
        }
    });
}
