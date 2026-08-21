import Fastify from 'fastify'
import itemsRoute from "./routes/items";
import auctionRoute from "./routes/auction";
import balanceRoute from "./routes/balance";
import authRoute from "./routes/auth";
import {getStats} from "./services/items/items";


const app = Fastify({logger: true});

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

const start = async () => {
    try {
        const port = process.env.PORT || 3000;
        await app.listen({port : Number(process.env.PORT || 3000)});
        console.log(`🚀 We are up on port ${port}`);
    } catch (e) {
        app.log.error(e);
        process.exit(1);
    }
}
start();
