import {describe, expect, it, beforeAll, afterAll} from "bun:test";
import Fastify from "fastify";
import uiRoute from "../src/routes/ui";
import itemsRoute from "../src/routes/items";
import balanceRoute from "../src/routes/balance";
import {registerBanGuard} from "../src/plugins/banGuard";
import {setBanned} from "../src/services/ban/ban";
import {seedShopItemsIfNeeded} from "../src/services/shop/catalog";
import {db} from "../src/db";
import {signJwt} from "../src/utils/jwt";

const app = Fastify();

// Test users live under a reserved prefix so the real/plugin data is never touched
const PREFIX = "ui_test_";
const clean = () => {
    db.query(`DELETE FROM web_users WHERE username LIKE '${PREFIX}%'`).run();
    db.query(`DELETE FROM users WHERE username LIKE '${PREFIX}%'`).run();
};

const MEMBER = `${PREFIX}member`;
const OWNER = `${PREFIX}owner`;
const PASSWORD = "supersecret1";

let ownerCookie = "";

beforeAll(async () => {
    clean();
    app.register(uiRoute, {prefix: "/ui"});
    await app.ready();
});

afterAll(async () => {
    await app.close();
    clean();
});

const post = (url: string, payload: unknown, cookie?: string) =>
    app.inject({
        method: "POST",
        url,
        payload,
        ...(cookie ? {headers: {cookie}} : {}),
    });

const get = (url: string, cookie?: string) =>
    app.inject({
        method: "GET",
        url,
        ...(cookie ? {headers: {cookie}} : {}),
    });

// app.inject returns set-cookie as an array of header strings
const firstCookie = (res: {headers: Record<string, unknown>}): string => {
    const sc = res.headers["set-cookie"];
    return Array.isArray(sc) ? String(sc[0]) : String(sc ?? "");
};

describe("ui pages", () => {
    it("serves the login page", async () => {
        const res = await get("/ui/login");
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("text/html");
        expect(res.body).toContain("Admin sign in");
    });

    it("serves the signup page", async () => {
        const res = await get("/ui/signup");
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("text/html");
        expect(res.body).toContain("Create your account");
    });

    it("redirects /ui/dashboard to login without a session", async () => {
        const res = await get("/ui/dashboard");
        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("/ui/login");
    });

    it("redirects /ui to the login page", async () => {
        const res = await get("/ui");
        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("/ui/login");
    });

    it("serves static assets with the right content type", async () => {
        const res = await get("/ui/assets/styles.css");
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("text/css");
    });
});

describe("signup flow", () => {
    it("rejects a malformed username", async () => {
        const res = await post("/ui/api/signup", {username: "a!", password: PASSWORD});
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).success).toBe(false);
    });

    it("rejects a short password", async () => {
        const res = await post("/ui/api/signup", {username: MEMBER, password: "short"});
        expect(res.statusCode).toBe(400);
    });

    it("rejects mismatched confirmPassword", async () => {
        const res = await post("/ui/api/signup", {username: MEMBER, password: PASSWORD, confirmPassword: "different1"});
        expect(res.statusCode).toBe(400);
    });

    it("creates a member account", async () => {
        const res = await post("/ui/api/signup", {username: MEMBER, password: PASSWORD});
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.success).toBe(true);
        expect(body.role).toBe("member");
    });

    it("rejects duplicate usernames", async () => {
        const res = await post("/ui/api/signup", {username: MEMBER, password: PASSWORD});
        expect(res.statusCode).toBe(409);
    });

    it("keeps the Minecraft users table untouched", async () => {
        const row = db.query(`SELECT COUNT(*) AS c FROM users WHERE username LIKE '${PREFIX}%'`).get() as {c: number};
        expect(row.c).toBe(0);
        const webRow = db.query(`SELECT COUNT(*) AS c FROM web_users WHERE username = $1`).get(MEMBER) as {c: number};
        expect(webRow.c).toBe(1);
    });
});

describe("login & role gating", () => {
    it("rejects a member account from the UI login", async () => {
        const res = await post("/ui/api/login", {username: MEMBER, password: PASSWORD});
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).success).toBe(false);
    });

    it("rejects a wrong password", async () => {
        const res = await post("/ui/api/login", {username: MEMBER, password: "wrongpassword1"});
        expect(res.statusCode).toBe(401);
    });

    it("lets an owner sign in and receives an HttpOnly session cookie", async () => {
        await post("/ui/api/signup", {username: OWNER, password: PASSWORD});
        db.query(`UPDATE web_users SET role = 'owner' WHERE username = $1`).run(OWNER);

        const res = await post("/ui/api/login", {username: OWNER, password: PASSWORD});
        expect(res.statusCode).toBe(200);
        const setCookie = firstCookie(res);
        expect(setCookie).toContain("bazzar_ui_session=");
        expect(setCookie).toContain("HttpOnly");
        ownerCookie = setCookie.split(";")[0];
    });

    it("serves the dashboard to a privileged session", async () => {
        const res = await get("/ui/dashboard", ownerCookie);
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("text/html");
        expect(res.body).toContain("Dashboard");
    });

    it("blocks a member-role token from the dashboard with 403", async () => {
        const token = signJwt({sub: "00000000-0000-4000-8000-000000000000", username: MEMBER, role: "member"}, 600);
        const res = await get("/ui/dashboard", `bazzar_ui_session=${token}`);
        expect(res.statusCode).toBe(403);
    });

    it("rejects a tampered token", async () => {
        const res = await get("/ui/dashboard", "bazzar_ui_session=abc.def.ghi");
        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("/ui/login");
    });

    it("rejects an expired token", async () => {
        const token = signJwt({sub: "00000000-0000-4000-8000-000000000000", username: OWNER, role: "owner"}, -10);
        const res = await get("/ui/dashboard", `bazzar_ui_session=${token}`);
        expect(res.statusCode).toBe(302);
    });

    it("returns the session identity from /ui/api/me", async () => {
        const res = await get("/ui/api/me", ownerCookie);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.username).toBe(OWNER);
        expect(body.role).toBe("owner");
    });

    it("requires auth for /ui/api/me", async () => {
        const res = await get("/ui/api/me");
        expect(res.statusCode).toBe(401);
    });

    it("returns 401 for dashboard data without a session", async () => {
        const users = await get("/ui/api/users");
        expect(users.statusCode).toBe(401);
        const stats = await get("/ui/api/stats");
        expect(stats.statusCode).toBe(401);
    });

    it("returns 403 (not 401) for a member token on dashboard data", async () => {
        const token = signJwt({sub: "00000000-0000-4000-8000-000000000000", username: MEMBER, role: "member"}, 600);
        const res = await get("/ui/api/users", `bazzar_ui_session=${token}`);
        expect(res.statusCode).toBe(403);
    });

    it("serves dashboard stats and users to the owner", async () => {
        const stats = await get("/ui/api/stats", ownerCookie);
        expect(stats.statusCode).toBe(200);
        const statsBody = JSON.parse(stats.body);
        for (const key of ["totalListings", "activeListings", "totalSold", "totalUsers", "totalPlayers", "totalBalance"]) {
            expect(statsBody).toHaveProperty(key);
        }

        const users = await get("/ui/api/users", ownerCookie);
        expect(users.statusCode).toBe(200);
        const list = JSON.parse(users.body).users as {username: string; role: string}[];
        expect(list.some((u) => u.username === MEMBER && u.role === "member")).toBe(true);
        expect(list.some((u) => u.username === OWNER && u.role === "owner")).toBe(true);
    });

    it("logs out and clears the cookie", async () => {
        const res = await post("/ui/api/logout", {});
        expect(res.statusCode).toBe(200);
        expect(firstCookie(res)).toContain("Max-Age=0");
    });
});

describe("marketplace management & ban guard", () => {
    const app2 = Fastify();
    const BANNED_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    let cookie2 = "";

    beforeAll(async () => {
        // Ensure shop table is populated regardless of test execution order
        seedShopItemsIfNeeded();

        // Ban guard registered FIRST, before any route — mirrors index.ts
        registerBanGuard(app2);
        app2.register(itemsRoute, {prefix: "/items"});
        app2.register(balanceRoute, {prefix: "/balance"});
        app2.register(uiRoute, {prefix: "/ui"});
        await app2.ready();

        // MC player + one listing
        db.query(
            `INSERT OR REPLACE INTO users (playeruuid, username, balance, banned)
             VALUES ('${BANNED_UUID}', 'BanTest', 500, 0)`
        ).run();
        db.query(
            `INSERT INTO items (seller, material, amount, price, source, origin, status)
             VALUES ('BanTest', 'DIAMOND', 2, '150', 'player', 'survival', 'AVAILABLE')`
        ).run();

        // owner session (OWNER was promoted by the previous describe block)
        const login = await app2.inject({
            method: "POST", url: "/ui/api/login",
            payload: {username: OWNER, password: PASSWORD},
        });
        expect(login.statusCode).toBe(200);
        cookie2 = firstCookie(login).split(";")[0];
    });

    afterAll(async () => {
        await app2.close();
        setBanned(BANNED_UUID, false);
        db.query(`DELETE FROM items WHERE seller = 'BanTest'`).run();
        db.query(`DELETE FROM history WHERE seller = 'BanTest' OR buyer = 'BanTest'`).run();
        db.query(`DELETE FROM users WHERE username = 'BanTest'`).run();
    });

    it("requires auth to ban", async () => {
        const res = await app2.inject({method: "POST", url: "/ui/api/ban", payload: {player: BANNED_UUID}});
        expect(res.statusCode).toBe(401);
    });

    it("bans a player by uuid", async () => {
        const res = await app2.inject({
            method: "POST", url: "/ui/api/ban", headers: {cookie: cookie2},
            payload: {player: BANNED_UUID, banned: true},
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).banned).toBe(true);
    });

    it("blocks a banned player before any endpoint (query)", async () => {
        const res = await app2.inject({method: "GET", url: `/items?player=${BANNED_UUID}`});
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).message).toContain("banned");
    });

    it("blocks a banned player before any endpoint (body)", async () => {
        const res = await app2.inject({
            method: "POST", url: "/balance/change",
            payload: {playerUuid: BANNED_UUID, playerName: "BanTest", delta: 10},
        });
        expect(res.statusCode).toBe(403);
    });

    it("unbans a player by username", async () => {
        const res = await app2.inject({
            method: "POST", url: "/ui/api/ban", headers: {cookie: cookie2},
            payload: {player: "BanTest", banned: false},
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).banned).toBe(false);
        const after = await app2.inject({method: "GET", url: `/items?player=${BANNED_UUID}`});
        expect(after.statusCode).toBe(200);
    });

    it("returns 404 when banning an unknown player", async () => {
        const res = await app2.inject({
            method: "POST", url: "/ui/api/ban", headers: {cookie: cookie2},
            payload: {player: "ghost_player_404"},
        });
        expect(res.statusCode).toBe(404);
    });

    it("lists marketplace listings (all + filtered)", async () => {
        const all = await get2("/ui/api/listings");
        expect(all.statusCode).toBe(200);
        const allBody = JSON.parse(all.body);
        expect(allBody.items.some((i: {seller: string}) => i.seller === "BanTest")).toBe(true);

        const active = await get2("/ui/api/listings?status=AVAILABLE&seller=BanTest");
        const activeBody = JSON.parse(active.body);
        expect(activeBody.total).toBeGreaterThanOrEqual(1);

        const sold = await get2("/ui/api/listings?status=SOLD&seller=BanTest");
        expect(JSON.parse(sold.body).total).toBe(0);
    });

    it("lists purchase history", async () => {
        const res = await get2("/ui/api/sold");
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toHaveProperty("items");
        expect(JSON.parse(res.body)).toHaveProperty("total");
    });

    it("lists MC players with search and banned filters", async () => {
        const byName = await get2("/ui/api/players?q=BanTest");
        expect(JSON.parse(byName.body).players.some((p: {username: string}) => p.username === "BanTest")).toBe(true);
        expect(JSON.parse(byName.body).players[0]).toHaveProperty("banned");
    });

    it("shows a player's profile, listings and history", async () => {
        const res = await get2("/ui/api/player/BanTest");
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.player.username).toBe("BanTest");
        expect(body.listings.length).toBeGreaterThanOrEqual(1);
        expect(body.history).toEqual([]);

        const missing = await get2("/ui/api/player/ghost_player_404");
        expect(missing.statusCode).toBe(404);
    });

    it("serves all management pages to the owner", async () => {
        for (const url of ["/ui/listings", "/ui/active", "/ui/sold", "/ui/players", "/ui/players/BanTest", "/ui/shop", "/ui/purchases"]) {
            const res = await get2(url);
            expect(res.statusCode).toBe(200);
            expect(res.headers["content-type"]).toContain("text/html");
        }
    });

    it("returns shop catalog and purchases API data with pagination", async () => {
        const shopRes = await get2("/ui/api/shop?page=0&pageSize=10");
        expect(shopRes.statusCode).toBe(200);
        const shopBody = JSON.parse(shopRes.body);
        expect(Array.isArray(shopBody.items)).toBe(true);
        expect(shopBody.items.length).toBeLessThanOrEqual(10);
        expect(Array.isArray(shopBody.categories)).toBe(true);
        expect(shopBody).toHaveProperty("total");
        expect(shopBody).toHaveProperty("hasMore");

        const purchasesRes = await get2("/ui/api/purchases");
        expect(purchasesRes.statusCode).toBe(200);
        const purchasesBody = JSON.parse(purchasesRes.body);
        expect(Array.isArray(purchasesBody.purchases)).toBe(true);
        expect(purchasesBody).toHaveProperty("total");
    });

    it("updates shop item prices via PATCH /ui/api/shop/:id", async () => {
        const patchRes = await app2.inject({
            method: "PATCH",
            url: "/ui/api/shop/stone",
            headers: {cookie: cookie2},
            payload: {buy: 12.5, sell: 4.5},
        });
        expect(patchRes.statusCode).toBe(200);
        const body = JSON.parse(patchRes.body);
        expect(body.success).toBe(true);
        expect(body.item.buy).toBe(12.5);
        expect(body.item.sell).toBe(4.5);

        // invalid values rejected
        const invalidRes = await app2.inject({
            method: "PATCH",
            url: "/ui/api/shop/stone",
            headers: {cookie: cookie2},
            payload: {buy: -5},
        });
        expect(invalidRes.statusCode).toBe(400);
    });

    function get2(url: string) {
        return app2.inject({method: "GET", url, headers: {cookie: cookie2}});
    }
});

describe("DELETE /ui/api/players/:uuid", () => {
    const app3 = Fastify();
    const DEL_UUID = "dddddddd-1111-4222-8333-444444444444";
    let cookie3 = "";

    beforeAll(async () => {
        app3.register(uiRoute, {prefix: "/ui"});
        await app3.ready();

        // MC player + one listing to be deleted
        db.query(
            `INSERT OR IGNORE INTO users (playeruuid, username, balance) VALUES ($1, 'DelTest', 42)`
        ).run(DEL_UUID);
        db.query(
            `INSERT INTO items (seller, material, amount, price, source, origin, status)
             VALUES ('DelTest', 'EMERALD', 3, '90', 'player', 'survival', 'AVAILABLE')`
        ).run();

        // owner session (OWNER was promoted by the earlier describe block)
        const login = await app3.inject({
            method: "POST", url: "/ui/api/login",
            payload: {username: OWNER, password: PASSWORD},
        });
        expect(login.statusCode).toBe(200);
        cookie3 = firstCookie(login).split(";")[0];
    });

    afterAll(async () => {
        await app3.close();
        db.query(`DELETE FROM items WHERE seller = 'DelTest'`).run();
        db.query(`DELETE FROM users WHERE username = 'DelTest'`).run();
    });

    it("requires authentication", async () => {
        const res = await app3.inject({method: "DELETE", url: `/ui/api/players/${DEL_UUID}`});
        expect(res.statusCode).toBe(401);
    });

    it("rejects a malformed uuid", async () => {
        const res = await app3.inject({
            method: "DELETE", url: "/ui/api/players/not-a-uuid", headers: {cookie: cookie3},
        });
        expect(res.statusCode).toBe(400);
    });

    it("returns 404 for an unknown player", async () => {
        const res = await app3.inject({
            method: "DELETE",
            url: "/ui/api/players/99999999-9999-4999-8999-999999999999",
            headers: {cookie: cookie3},
        });
        expect(res.statusCode).toBe(404);
    });

    it("deletes the player and their listings", async () => {
        const res = await app3.inject({
            method: "DELETE", url: `/ui/api/players/${DEL_UUID}`, headers: {cookie: cookie3},
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.success).toBe(true);
        expect(body.username).toBe("DelTest");
        expect(body.removedItems).toBe(1);

        const userRow = db.query(`SELECT COUNT(*) AS c FROM users WHERE playeruuid = $1`).get(DEL_UUID) as {c: number};
        expect(userRow.c).toBe(0);
        const itemRow = db.query(`SELECT COUNT(*) AS c FROM items WHERE seller = 'DelTest'`).get() as {c: number};
        expect(itemRow.c).toBe(0);
    });

    it("returns 404 when deleting an already-deleted player", async () => {
        const res = await app3.inject({
            method: "DELETE", url: `/ui/api/players/${DEL_UUID}`, headers: {cookie: cookie3},
        });
        expect(res.statusCode).toBe(404);
    });
});