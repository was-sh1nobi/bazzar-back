import Fastify from "fastify";
import itemsRoute from "./routes/items";
import auctionRoute from "./routes/auction";
import balanceRoute from "./routes/balance";
import authRoute from "./routes/auth";
import shopRoute from "./routes/shop";
import uiRoute from "./routes/ui";
import {registerBanGuard} from "./plugins/banGuard";
import {registerRateLimit} from "./plugins/rateLimit";
import {registerSecurityHeaders} from "./plugins/securityHeaders";
import {registerPluginAuth} from "./plugins/pluginAuth";
import {getStats} from "./services/items/items";
import {intEnv, strEnv, boolEnv} from "./utils/config";


const app = Fastify({
    logger: true,
    // Only trust X-Forwarded-* when explicitly deployed behind a reverse
    // proxy — otherwise req.ip (used for rate limiting) could be spoofed.
    trustProxy: boolEnv("TRUST_PROXY"),
});

// Normalize all errors (incl. FST_ERR_CTP_INVALID_JSON_BODY) to {success:false,message}
app.setErrorHandler((error, req, res) => {
    const status = (error as {statusCode?: number}).statusCode ?? 500;
    const msg = error.message ?? "unexpected error";
    // Fastify validation / JSON parse errors already have status 400
    res.code(status).send({success: false, message: msg, code: (error as {code?: string}).code});
});

// Security headers on every response (CSP on pages, no-store on API JSON)
registerSecurityHeaders(app);
// Global per-zone rate limiting: /ui/api/*, /ui/* and MC plugin endpoints
registerRateLimit(app);
// Plugin secret auth for mutating MC endpoints (prevents UUID spoofing C1)
registerPluginAuth(app);
// Ban guard: runs before every route/handler — banned players never reach any endpoint
registerBanGuard(app);

app.get('/', async (req, res) => {
    return {status: 200, message: 'Welcome to Fastify'};
})

app.get<{Querystring: {player?: string}}>('/stats', async (req, res) => {
    const player = req.query.player;
    if (!player) return res.code(400).send({success: false, message: "player query param is required"});
    res.code(200).send(await getStats(player));
})

app.register(itemsRoute , {prefix : "/items"});
app.register(auctionRoute);
app.register(balanceRoute , {prefix : "/balance"});
app.register(authRoute , {prefix : "/auth"});
app.register(shopRoute , {prefix : "/shop"});
app.register(uiRoute , {prefix : "/ui"});

const start = async () => {
    try {
        const port = intEnv("PORT", 3000);
        const host = strEnv("HOST") ?? "0.0.0.0";
        await app.listen({port, host});
        console.log(`🚀 We are up on ${host}:${port}`);
    } catch (e) {
        app.log.error(e);
        process.exit(1);
    }
}
start();
