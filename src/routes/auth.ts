import { FastifyInstance } from "fastify";
import { pool } from "../db";
import { ensureUser, getUserByUuid, isRegistered, setPasswordHash } from "../services/auth/auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (res: {code: (c: number) => {send: (b: unknown) => unknown}}, code: number, message: string) =>
    res.code(code).send({success: false, message});

// naive in-memory rate limit: 5 fails per 60s per uuid/ip
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

export default async function authRoute(app: FastifyInstance) {
    // GET /auth/status?player=uuid
    app.get<{Querystring: {player?: string}}>('/status', async (req, res) => {
        const player = req.query.player;
        if (!player || !UUID_RE.test(player)) return fail(res, 400, "player query param required (uuid)");
        const u = getUserByUuid(player);
        if (!u) return res.code(200).send({registered: false, hasPassword: false});
        return res.code(200).send({registered: !!u.password_hash, hasPassword: !!u.password_hash, username: u.username});
    });

    // POST /auth/register {playerUuid, playerName, password}
    app.post<{Body: {playerUuid?: string; playerName?: string; password?: string}}>('/register', async (req, res) => {
        const {playerUuid, playerName, password} = req.body;
        if (!playerUuid || !UUID_RE.test(playerUuid)) return fail(res, 400, "malformed player UUID");
        if (!playerName || /\s/.test(playerName.trim()) || playerName.trim().length < 2) return fail(res, 400, "invalid playerName");
        if (!password || password.length < 4 || password.length > 64) return fail(res, 400, "password must be 4-64 chars");

        const existing = getUserByUuid(playerUuid);
        if (existing?.password_hash) return fail(res, 400, "already registered - use login");

        ensureUser(playerUuid, playerName.trim());
        const hash = await Bun.password.hash(password);
        setPasswordHash(playerUuid, hash);
        return res.code(200).send({success: true, message: "registered"});
    });

    // POST /auth/login {playerUuid, password}
    app.post<{Body: {playerUuid?: string; password?: string}}>('/login', async (req, res) => {
        const {playerUuid, password} = req.body;
        const ip = req.ip;
        const key = `${playerUuid}:${ip}`;
        if (!playerUuid || !UUID_RE.test(playerUuid)) return fail(res, 400, "malformed player UUID");
        if (!password) return fail(res, 400, "password required");
        if (!checkRate(key)) return fail(res, 429, "too many attempts, try again in 60s");

        const u = getUserByUuid(playerUuid);
        if (!u || !u.password_hash) return fail(res, 404, "not registered - use /register");
        const ok = await Bun.password.verify(password, u.password_hash);
        if (!ok) { recordFail(key); return fail(res, 401, "invalid password"); }
        clearFail(key);
        return res.code(200).send({success: true, message: "authenticated", username: u.username});
    });

    // POST /auth/change {playerUuid, oldPassword, newPassword}
    app.post<{Body: {playerUuid?: string; oldPassword?: string; newPassword?: string}}>('/change', async (req, res) => {
        const {playerUuid, oldPassword, newPassword} = req.body;
        if (!playerUuid || !UUID_RE.test(playerUuid)) return fail(res, 400, "malformed player UUID");
        if (!newPassword || newPassword.length < 4 || newPassword.length > 64) return fail(res, 400, "new password must be 4-64 chars");
        const u = getUserByUuid(playerUuid);
        if (!u?.password_hash) return fail(res, 404, "not registered");
        const ok = oldPassword ? await Bun.password.verify(oldPassword, u.password_hash) : false;
        if (!ok) return fail(res, 401, "invalid old password");
        const hash = await Bun.password.hash(newPassword);
        setPasswordHash(playerUuid, hash);
        return res.code(200).send({success: true, message: "password changed"});
    });
}
