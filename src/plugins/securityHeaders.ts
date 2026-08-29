import {FastifyInstance, FastifyReply, FastifyRequest} from "fastify";

/**
 * Baseline HTTP security headers applied to every response (no external deps).
 * HTML responses additionally get a strict CSP; JSON API responses are marked
 * no-store so authenticated data never lands in shared caches.
 */

const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
].join("; ");

export const registerSecurityHeaders = (app: FastifyInstance) => {
    app.addHook("onSend", async (_req: FastifyRequest, res: FastifyReply, payload) => {
        res.header("x-content-type-options", "nosniff");
        res.header("x-frame-options", "DENY");
        res.header("referrer-policy", "strict-origin-when-cross-origin");
        res.header("x-permitted-cross-domain-policies", "none");

        const ctype = String(res.getHeader("content-type") ?? "");
        if (ctype.startsWith("text/html")) {
            res.header("content-security-policy", CSP);
        } else if (ctype.startsWith("application/json")) {
            res.header("cache-control", "no-store");
        }
        return payload;
    });
};
