import {describe, expect, it, beforeAll, afterAll} from "bun:test";
import Fastify from "fastify";
import itemsRoute from "../src/routes/items";
import auctionRoute from "../src/routes/auction";
import balanceRoute from "../src/routes/balance";

let app: ReturnType<typeof Fastify>;
let db: string;

beforeAll(async () => {
    process.env.DATABASE_URL = "./bazzar-test.db";
    db = "./bazzar-test.db";
    app = Fastify();
    app.register(itemsRoute, {prefix: "/items"});
    app.register(auctionRoute); // mounts POST /list at root, mirroring index.ts
    app.register(balanceRoute, {prefix: "/balance"}); // server-side money
    await app.ready();
});

afterAll(async () => {
    await app.close();
    await Bun.$`rm -f ${db} ${db}-shm ${db}-wal`.quiet();
});

const list = (n: number) => ({
    playerUuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5",
    playerName: "Steve",
    material: "DIAMOND",
    amount: 1,
    price: n,
});

describe("auction API", () => {
    it("lists a fresh item via POST /items/list", async () => {
        const res = await app.inject({method: "POST", url: "/list", payload: list(100)});
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).success).toBe(true);
    });

    it("rejects a lowercase material with success:false", async () => {
        const res = await app.inject({method: "POST", url: "/list", payload: {...list(100), material: "diamond"}});
        expect(JSON.parse(res.body).success).toBe(false);
    });

    it("returns a 0-based enveloped feed on GET /items?page=0", async () => {
        const res = await app.inject({method: "GET", url: "/items?page=0&pageSize=45"});
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.page).toBe(0);
        expect(body.items[0].sellerName).toBe("Steve");
        expect(Number(body.items[0].price)).toBe(100);
    });

    it("shows the listing in /items/active by uuid", async () => {
        const res = await app.inject({method: "GET", url: "/items/active?player=069a79f4-44e9-4726-a5be-fca90e38aaf5"});
        expect(JSON.parse(res.body).total).toBeGreaterThan(0);
    });

    it("rejects buying your own listing", async () => {
        const feed = await app.inject({method: "GET", url: "/items?page=0&pageSize=45"});
        const id = JSON.parse(feed.body).items[0].id;

        const buy = await app.inject({
            method: "POST",
            url: "/items/buy",
            payload: {wantedId: id, buyerId: "069a79f4-44e9-4726-a5be-fca90e38aaf5"},
        });
        expect(buy.statusCode).toBe(400);
        expect(JSON.parse(buy.body).success).toBe(false);
        expect(JSON.parse(buy.body).message).toBe("you cannot buy your own listing");
    });

    it("buys the item and records it in bought/history", async () => {
        const alex = "11111111-2222-3333-4444-555555555555";
        // Balance writes are private now — seed directly via DB instead of POST /balance/change
        const {pool} = await import("../src/db");
        pool.query(`INSERT INTO users (playeruuid, username, balance) VALUES ($1,$2,$3) ON CONFLICT(playeruuid) DO UPDATE SET balance = $3`, [alex, "Alex", 10000]);

        const feed = await app.inject({method: "GET", url: "/items?page=0&pageSize=45"});
        const id = JSON.parse(feed.body).items[0].id;

        const buy = await app.inject({
            method: "POST",
            url: "/items/buy",
            payload: {wantedId: id, buyerId: alex},
        });
        expect(buy.statusCode).toBe(200);
        expect(JSON.parse(buy.body).success).toBe(true);

        const bought = await app.inject({method: "GET", url: "/items/bought?player=" + alex});
        expect(JSON.parse(bought.body).total).toBeGreaterThan(0);

        const history = await app.inject({method: "GET", url: "/items/history?player=" + alex});
        expect(JSON.parse(history.body).total).toBeGreaterThan(0);
    });

    it("returns 404 for buying a missing item", async () => {
        const buy = await app.inject({method: "POST", url: "/items/buy", payload: {wantedId: 999999, buyerId: "11111111-2222-3333-4444-555555555555"}});
        expect(buy.statusCode).toBe(404);
    });
});
