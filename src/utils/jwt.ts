import {createHmac, timingSafeEqual, randomUUID} from "crypto";
import {isProduction} from "./config";

/**
 * Minimal HS256 JWT implementation (sign + verify) built on node:crypto.
 * The project intentionally avoids extra dependencies; this covers the
 * Bazzar web-UI session tokens only.
 */

export type JwtRole = "member" | "admin" | "owner";

export type JwtPayload = {
    sub: string;            // playeruuid
    username: string;
    role: JwtRole;
    iat: number;
    exp: number;
};

const getSecret = (): string => {
    let secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
        if (isProduction) {
            // Fail fast rather than silently signing sessions with a weak key.
            throw new Error("[jwt] JWT_SECRET must be set to at least 32 characters in production (openssl rand -hex 32)");
        }
        // Fall back to an ephemeral secret so dev servers still boot;
        // sessions simply reset on restart. Set JWT_SECRET in production.
        console.warn("[jwt] JWT_SECRET missing/short — using an ephemeral random secret (sessions will not survive restarts)");
        secret = randomUUID() + randomUUID() + randomUUID();
        process.env.JWT_SECRET = secret;
    }
    return secret;
};

const b64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

export const signJwt = (payload: Pick<JwtPayload, "sub" | "username" | "role">, ttlSeconds: number): string => {
    const header = b64url(JSON.stringify({alg: "HS256", typ: "JWT"}));
    const now = Math.floor(Date.now() / 1000);
    const body = b64url(JSON.stringify({...payload, iat: now, exp: now + ttlSeconds}));
    const signature = createHmac("sha256", getSecret()).update(`${header}.${body}`).digest("base64url");
    return `${header}.${body}.${signature}`;
};

export const verifyJwt = (token: string): JwtPayload | null => {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expected = createHmac("sha256", getSecret()).update(`${header}.${body}`).digest("base64url");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as JwtPayload;
        if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
        if (typeof payload.sub !== "string" || typeof payload.username !== "string") return null;
        if (payload.role !== "member" && payload.role !== "admin" && payload.role !== "owner") return null;
        return payload;
    } catch {
        return null;
    }
};