import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFileSync } from "fs";
import { join } from "path";
import { signJwt, verifyJwt, JwtPayload } from "../utils/jwt";
import { createWebUser, getWebUserByUsername, isPrivileged, listWebUsers, UiRole } from "../services/auth/ui";
import { deletePlayerData } from "../services/auth/auth";
import { pool } from "../db";
import { isUuid, setBanned, listBanned } from "../services/ban/ban";

const PUBLIC_DIR = join(__dirname, "../public/ui");
const COOKIE_NAME = "bazzar_ui_session";
const COOKIE_TTL = 60 * 60 * 8; // 8h

const CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
};

const fail = (res: FastifyReply, code: number, message: string) =>
    res.code(code).send({success: false, message});

const servePage = (res: FastifyReply, file: string, code = 200) => {
    const ext = file.slice(file.lastIndexOf("."));
    try {
        return res.code(code).type(CONTENT_TYPES[ext] ?? "text/plain").send(readFileSync(join(PUBLIC_DIR, file)));
    } catch {
        return res.code(500).send({success: false, message: "ui asset unavailable"});
    }
};

// naive in-memory rate limit (same pattern as /auth): 5 fails per 60s per key
const failMap = new Map<string, {count: number; reset: number}>();
const checkRate = (key: string): boolean => {
    const now = Date.now();
    const e = failMap.get(key);
    if (!e || now > e.reset) { failMap.set(key, {count: 0, reset: now + 60_000}); return true; }
    return e.count < 5;
};
const recordFail = (key: string) => {
    const e = failMap.get(key);
    if (!e) failMap.set(key, {count: 1, reset: Date.now() + 60_000});
    else e.count++;
};
const clearFail = (key: string) => failMap.delete(key);

const parseCookies = (req: FastifyRequest): Record<string, string> => {
    const header = req.headers.cookie;
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(";")) {
        const idx = part.indexOf("=");
        if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
    return out;
};

const getSession = (req: FastifyRequest): JwtPayload | null => {
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return null;
    return verifyJwt(token);
};

const sessionCookie = (token: string, secure = false) =>
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/ui; SameSite=Lax; Max-Age=${COOKIE_TTL}${secure ? "; Secure" : ""}`;

const clearedCookie = () => `${COOKIE_NAME}=; HttpOnly; Path=/ui; SameSite=Lax; Max-Age=0`;

/** Guard for /ui/api/* data endpoints: returns the session or null (response already sent). */
const requirePrivilegedApi = (req: FastifyRequest, res: FastifyReply): JwtPayload | null => {
    const session = getSession(req);
    if (!session) { fail(res, 401, "authentication required"); return null; }
    if (!isPrivileged(session.role)) { fail(res, 403, "not authorized"); return null; }
    return session;
};

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

export default async function uiRoute(app: FastifyInstance) {
    // CSRF hardening: cookie-authenticated mutations under /ui/api/* must
    // originate from our own host. Requests without an Origin header (curl,
    // the MC plugin, tests) are unaffected; browsers always send Origin on
    // cross-site POST/DELETE, which is exactly what we block.
    app.addHook("onRequest", async (req, res) => {
        if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase())) return;
        const path = (req.raw.url ?? req.url).split("?")[0];
        if (!path.startsWith("/ui/api/")) return;
        const origin = req.headers.origin;
        if (!origin) return;
        try {
            if (new URL(origin).host !== req.headers.host) return fail(res, 403, "cross-origin request blocked");
        } catch {
            return fail(res, 403, "cross-origin request blocked");
        }
    });

    // ---------------- pages ----------------

    // GET /ui -> smart redirect (dashboard when already signed in, login otherwise)
    app.get("/", async (req, res) => {
        const session = getSession(req);
        const target = session && isPrivileged(session.role) ? "/ui/dashboard" : "/ui/login";
        return res.code(302).header("location", target).send();
    });

    // GET /ui/login - public login page (only owner & admin can actually sign in)
    app.get("/login", async (req, res) => servePage(res, "login.html"));

    // GET /ui/signup - public signup page (always creates a member account)
    app.get("/signup", async (req, res) => servePage(res, "signup.html"));

    // GET /ui/dashboard - strictly owner/admin; members get a styled 403 page
    app.get("/dashboard", async (req, res) => {
        const session = getSession(req);
        if (!session) return res.code(302).header("location", "/ui/login").send();
        if (!isPrivileged(session.role)) return servePage(res, "forbidden.html", 403);
        return servePage(res, "dashboard.html");
    });

    // GET /ui/assets/:file - static assets (css/js) for the pages above
    app.get("/assets/:file", async (req, res) => {
        const {file} = req.params as {file: string};
        if (!/^[A-Za-z0-9._-]+$/.test(file)) return fail(res, 400, "invalid asset name");
        return servePage(res, file);
    });

    // ---------------- api: signup ----------------

    // POST /ui/api/signup {username, password, confirmPassword?}
    // Flow: request -> backend verifies inputs -> user is added as member.
    // Website accounts are stored in the dedicated `web_users` table,
    // fully separate from Minecraft players (`users`).
    app.post("/api/signup", async (req, res) => {
        const body = (req.body ?? {}) as {username?: string; password?: string; confirmPassword?: string};
        const rateKey = `signup:${req.ip}`;
        if (!checkRate(rateKey)) return fail(res, 429, "too many attempts, try again in 60s");

        const username = (body.username ?? "").trim();
        const password = body.password ?? "";
        if (!USERNAME_RE.test(username)) return fail(res, 400, "username must be 3-16 characters (letters, numbers, underscore)");
        if (password.length < 8 || password.length > 64) return fail(res, 400, "password must be 8-64 characters");
        if (body.confirmPassword !== undefined && body.confirmPassword !== password) return fail(res, 400, "passwords do not match");
        if (getWebUserByUsername(username)) return fail(res, 409, "username already taken");

        const hash = await Bun.password.hash(password);
        const user = createWebUser(username, hash);
        clearFail(rateKey);
        return res.code(201).send({success: true, message: "account created", role: user.role});
    });

    // ---------------- api: login / logout / session ----------------

    // POST /ui/api/login {username, password} - ONLY owner & admin get a session
    app.post("/api/login", async (req, res) => {
        const body = (req.body ?? {}) as {username?: string; password?: string};
        const username = (body.username ?? "").trim();
        const password = body.password ?? "";
        if (!username || !password) return fail(res, 400, "username and password are required");

        const rateKey = `login:${username}:${req.ip}`;
        if (!checkRate(rateKey)) return fail(res, 429, "too many attempts, try again in 60s");

        const user = getWebUserByUsername(username);
        if (!user?.password_hash) { recordFail(rateKey); return fail(res, 401, "invalid username or password"); }

        const ok = await Bun.password.verify(password, user.password_hash);
        if (!ok) { recordFail(rateKey); return fail(res, 401, "invalid username or password"); }

        if (!isPrivileged(user.role)) {
            recordFail(rateKey);
            return fail(res, 403, "this account is not authorized for dashboard access");
        }

        clearFail(rateKey);
        // Mark the cookie Secure when serving over TLS (directly or via a proxy
        // that sets X-Forwarded-Proto), so the session is never sent over http.
        const secure = String(req.headers["x-forwarded-proto"] ?? "").includes("https") || req.protocol === "https";
        const token = signJwt({sub: String(user.id), username: user.username, role: user.role as UiRole}, COOKIE_TTL);
        return res.code(200)
            .header("set-cookie", sessionCookie(token, secure))
            .send({success: true, message: "authenticated", username: user.username, role: user.role});
    });

    // POST /ui/api/logout - clears the session cookie
    app.post("/api/logout", async (req, res) =>
        res.code(200).header("set-cookie", clearedCookie()).send({success: true, message: "logged out"})
    );

    // GET /ui/api/me - current session identity
    app.get("/api/me", async (req, res) => {
        const session = getSession(req);
        if (!session) return fail(res, 401, "authentication required");
        return res.code(200).send({username: session.username, role: session.role});
    });

    // ---------------- api: dashboard data (owner/admin only) ----------------

    // GET /ui/api/stats - global marketplace stats for the dashboard cards
    app.get("/api/stats", async (req, res) => {
        if (!requirePrivilegedApi(req, res)) return;
        const filteredAvailable = `status = 'AVAILABLE'
            AND LOWER(COALESCE(source,'player')) NOT IN ('creative','admin','command')
            AND LOWER(COALESCE(origin,'survival')) NOT IN ('creative','command','unknown')`;
        const row = pool.query(
            `SELECT
                (SELECT COUNT(*) FROM items) AS totalListings,
                (SELECT COUNT(*) FROM items WHERE ${filteredAvailable}) AS activeListings,
                (SELECT COUNT(*) FROM history) AS totalSold,
                (SELECT COUNT(*) FROM web_users) AS totalUsers,
                (SELECT COUNT(*) FROM users) AS totalPlayers,
                (SELECT COALESCE(SUM(balance), 0) FROM users) AS totalBalance`
        ).rows[0] as Record<string, string>;
        return res.code(200).send({
            totalListings: parseInt(row.totalListings, 10),
            activeListings: parseInt(row.activeListings, 10),
            totalSold: parseInt(row.totalSold, 10),
            totalUsers: parseInt(row.totalUsers, 10),
            totalPlayers: parseInt(row.totalPlayers, 10),
            totalBalance: parseFloat(row.totalBalance),
        });
    });

    // GET /ui/api/users - read-only WEBSITE user list (roles are managed manually in the DB)
    app.get("/api/users", async (req, res) => {
        if (!requirePrivilegedApi(req, res)) return;
        return res.code(200).send({users: listWebUsers()});
    });

    // ---------------- pages: management views (owner/admin only) ----------------

    // GET /ui/listings  - total listings table
    app.get("/listings", async (req, res) => servePage(res, "listings.html"));

    // GET /ui/active    - active (AVAILABLE) listings only
    app.get("/active", async (req, res) => servePage(res, "active.html"));

    // GET /ui/sold      - purchase history
    app.get("/sold", async (req, res) => servePage(res, "sold.html"));

    // GET /ui/players   - Minecraft players + ban controls
    app.get("/players", async (req, res) => servePage(res, "players.html"));

    // GET /ui/players/:player - one player's listings & history
    app.get("/players/:player", async (req, res) => servePage(res, "player.html"));

    // ---------------- api: marketplace management (owner/admin only) ----------------

    // GET /ui/api/listings?page=&pageSize=&status=AVAILABLE|PENDING|SOLD|REMOVED&seller=
    app.get("/api/listings", async (req, res) => {
        if (!requirePrivilegedApi(req, res)) return;
        const q = req.query as {page?: string; pageSize?: string; status?: string; seller?: string};
        const page = Math.max(0, parseInt(q.page ?? "0", 10) || 0);
        const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? "25", 10) || 25));
        const status = (q.status ?? "").toUpperCase();
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (["AVAILABLE", "PENDING", "SOLD", "REMOVED"].includes(status)) { params.push(status); conditions.push(`status = $${params.length}`); }
        const seller = (q.seller ?? "").trim().replace(/[%_\\]/g, "");
        if (seller) { params.push(`%${seller}%`); conditions.push(`seller LIKE $${params.length}`); }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const total = parseInt((pool.query(`SELECT COUNT(*) AS count FROM items ${where}`, params).rows[0] as {count: string}).count, 10);
        const items = pool.query(
            `SELECT id, seller, material, amount, CAST(price AS REAL) AS price, status, source, origin
             FROM items ${where} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${page * pageSize}`,
            params
        ).rows;
        return res.code(200).send({page, pageSize, total, totalPages: Math.ceil(total / pageSize), items});
    });

    // GET /ui/api/sold?page=&pageSize= - purchase history
    app.get("/api/sold", async (req, res) => {
        if (!requirePrivilegedApi(req, res)) return;
        const q = req.query as {page?: string; pageSize?: string};
        const page = Math.max(0, parseInt(q.page ?? "0", 10) || 0);
        const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? "25", 10) || 25));
        const total = parseInt((pool.query(`SELECT COUNT(*) AS count FROM history`).rows[0] as {count: string}).count, 10);
        const items = pool.query(
            `SELECT id, seller, buyer, material, amount, CAST(price AS REAL) AS price, source, origin
             FROM history ORDER BY id DESC LIMIT ${pageSize} OFFSET ${page * pageSize}`
        ).rows;
        return res.code(200).send({page, pageSize, total, totalPages: Math.ceil(total / pageSize), items});
    });

    // GET /ui/api/players?q=&banned=1 - Minecraft players with ban state
    app.get("/api/players", async (req, res) => {
        if (!requirePrivilegedApi(req, res)) return;
        const q = req.query as {q?: string; banned?: string};
        const search = (q.q ?? "").trim().replace(/[%_\\]/g, "");
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (search) { params.push(`%${search}%`); conditions.push(`username LIKE $${params.length}`); }
        if (q.banned === "1") conditions.push(`banned = 1`);
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const players = pool.query(
            `SELECT playeruuid, username, balance, banned, created_at FROM users ${where}
             ORDER BY banned DESC, created_at DESC LIMIT 500`,
            params
        ).rows;
        return res.code(200).send({players});
    });

    // GET /ui/api/player/:name - one player's profile, listings and history
    app.get("/api/player/:name", async (req, res) => {
        if (!requirePrivilegedApi(req, res)) return;
        const name = decodeURIComponent((req.params as {name: string}).name);
        const player = pool.query(
            `SELECT playeruuid, username, balance, banned, created_at FROM users WHERE username = $1 LIMIT 1`,
            [name]
        ).rows[0] as undefined | {playeruuid: string; username: string; balance: number; banned: number; created_at: number | null};
        if (!player) return fail(res, 404, "player not found");
        const listings = pool.query(
            `SELECT id, material, amount, CAST(price AS REAL) AS price, status, source, origin
             FROM items WHERE seller = $1 ORDER BY id DESC LIMIT 200`,
            [name]
        ).rows;
        const history = pool.query(
            `SELECT id, seller, buyer, material, amount, CAST(price AS REAL) AS price, source, origin
             FROM history WHERE seller = $1 OR buyer = $1 ORDER BY id DESC LIMIT 200`,
            [name]
        ).rows;
        return res.code(200).send({player, listings, history});
    });

    // POST /ui/api/ban {player: uuid|username, banned: boolean}
    app.post("/api/ban", async (req, res) => {
        if (!requirePrivilegedApi(req, res)) return;
        const body = (req.body ?? {}) as {player?: string; banned?: boolean};
        const target = (body.player ?? "").trim();
        if (!target) return fail(res, 400, "player is required (uuid or username)");

        let uuid: string | undefined;
        if (isUuid(target)) uuid = target.toLowerCase();
        else {
            uuid = (pool.query(`SELECT playeruuid FROM users WHERE username = $1 LIMIT 1`, [target])
                .rows[0] as {playeruuid?: string} | undefined)?.playeruuid;
        }
        if (!uuid) return fail(res, 404, "player not found");

        setBanned(uuid, body.banned !== false);
        const row = pool.query(`SELECT username, banned FROM users WHERE playeruuid = $1 LIMIT 1`, [uuid])
            .rows[0] as {username: string; banned: number};
        return res.code(200).send({success: true, playeruuid: uuid, username: row.username, banned: !!row.banned});
    });

    // GET /ui/api/bans - currently banned players
    app.get("/api/bans", async (req, res) => {
        if (!requirePrivilegedApi(req, res)) return;
        return res.code(200).send({bans: listBanned()});
    });

    // DELETE /ui/api/players/:uuid - permanently delete a Minecraft player,
    // their balance and all of their listings (purchase history is kept).
    app.delete("/api/players/:uuid", async (req, res) => {
        if (!requirePrivilegedApi(req, res)) return;
        const uuid = decodeURIComponent((req.params as {uuid: string}).uuid).toLowerCase();
        if (!isUuid(uuid)) return fail(res, 400, "player must be identified by uuid");

        const row = pool.query(
            `SELECT playeruuid, username FROM users WHERE playeruuid = $1 LIMIT 1`,
            [uuid]
        ).rows[0] as {playeruuid: string; username: string} | undefined;
        if (!row) return fail(res, 404, "player not found");

        const {removedItems} = deletePlayerData(row.playeruuid, row.username);
        return res.code(200).send({
            success: true,
            message: `player ${row.username} deleted`,
            playeruuid: row.playeruuid,
            username: row.username,
            removedItems,
        });
    });
}