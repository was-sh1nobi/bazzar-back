import {pool, getVersion} from "../../db";

// seller column stores the player NAME; the plugin queries by UUID,
// so match on name directly or resolve the UUID through users.
const sellerClause = `(seller = $1 OR seller IN (SELECT username FROM users WHERE playeruuid = $1))`;
const priceCast = `CAST(price AS REAL) AS price`;

const envelopeData = (rows: unknown[], total: number, page: number, pageSize: number) => ({
    items: rows,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    version: getVersion(),
});

export const getItems = async (page: number, pageSize: number, excludePlayer?: string) => {
    const offset = page * pageSize;

    const where = excludePlayer
        ? `status = 'AVAILABLE' AND source NOT IN ('creative', 'admin')
           AND seller NOT IN (SELECT username FROM users WHERE playeruuid = $1)
           AND seller <> $1`
        : `status = 'AVAILABLE' AND source NOT IN ('creative', 'admin')`;

    const [data, countResult] = await Promise.all([
        pool.query(
            `SELECT id, seller AS sellerName, material, amount, ${priceCast}
             FROM items
             WHERE ${where}
             ORDER BY id
             LIMIT ${excludePlayer ? '$2' : '$1'} OFFSET ${excludePlayer ? '$3' : '$2'}`,
            excludePlayer ? [excludePlayer, pageSize, offset] : [pageSize, offset]
        ),
        pool.query(
            `SELECT COUNT(*) AS count FROM items WHERE ${where}`,
            excludePlayer ? [excludePlayer] : []
        ),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);
    return envelopeData(data.rows, total, page, pageSize);
};

export const getBySeller = async (seller: string, page: number, pageSize: number) => {
    const offset = page * pageSize;

    const [data, countResult] = await Promise.all([
        pool.query(
            `SELECT id, seller AS sellerName, material, amount, ${priceCast}
             FROM items
             WHERE status = 'AVAILABLE' AND ${sellerClause}
             ORDER BY id
             LIMIT $2 OFFSET $3`,
            [seller, pageSize, offset]
        ),
        pool.query(
            `SELECT COUNT(*) AS count FROM items WHERE status = 'AVAILABLE' AND ${sellerClause}`,
            [seller]
        ),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);
    return envelopeData(data.rows, total, page, pageSize);
};

export const getByBuyer = async (buyer: string, page: number, pageSize: number) => {
    const offset = page * pageSize;

    const [data, countResult] = await Promise.all([
        pool.query(
            `SELECT id, seller AS sellerName, buyer, material, amount, ${priceCast}
             FROM history
             WHERE buyer = $1
             ORDER BY id DESC
             LIMIT $2 OFFSET $3`,
            [buyer, pageSize, offset]
        ),
        pool.query(`SELECT COUNT(*) AS count FROM history WHERE buyer = $1`, [buyer]),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);
    return envelopeData(data.rows, total, page, pageSize);
};

export const getHistory = async (player: string, page: number, pageSize: number) => {
    const offset = page * pageSize;

    const [data, countResult] = await Promise.all([
        pool.query(
            `SELECT id, seller AS sellerName, buyer, material, amount, ${priceCast}
             FROM history
             WHERE seller = $1 OR buyer = $1 OR seller IN (SELECT username FROM users WHERE playeruuid = $1)
             ORDER BY id DESC
             LIMIT $2 OFFSET $3`,
            [player, pageSize, offset]
        ),
        pool.query(
            `SELECT COUNT(*) AS count FROM history
             WHERE seller = $1 OR buyer = $1 OR seller IN (SELECT username FROM users WHERE playeruuid = $1)`,
            [player]
        ),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);
    return envelopeData(data.rows, total, page, pageSize);
};

export const getStats = async (player: string) => {
    const [totalListings, activeListings, totalSold, myListings, mySold, myPurchases] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS count FROM items`),
        pool.query(`SELECT COUNT(*) AS count FROM items WHERE status = 'AVAILABLE'`),
        pool.query(`SELECT COUNT(*) AS count FROM history`),
        pool.query(`SELECT COUNT(*) AS count FROM items WHERE ${sellerClause}`, [player]),
        pool.query(`SELECT COUNT(*) AS count FROM history WHERE ${sellerClause}`, [player]),
        pool.query(`SELECT COUNT(*) AS count FROM history WHERE buyer = $1`, [player]),
    ]);

    return {
        totalListings: parseInt(totalListings.rows[0].count, 10),
        activeListings: parseInt(activeListings.rows[0].count, 10),
        totalSold: parseInt(totalSold.rows[0].count, 10),
        myListings: parseInt(myListings.rows[0].count, 10),
        mySold: parseInt(mySold.rows[0].count, 10),
        myPurchases: parseInt(myPurchases.rows[0].count, 10),
    };
};