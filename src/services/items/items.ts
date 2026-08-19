import {pool} from "../../db";

// seller column stores the player NAME; the plugin queries by UUID,
// so match on name directly or resolve the UUID through users.
const sellerClause = `(seller = $1 OR seller IN (SELECT username FROM users WHERE playeruuid = $1))`;
const priceCast = `CAST(price AS REAL) AS price`;

export const getItems = async (page: number, pageSize: number) => {
    const offset = page * pageSize;

    const [data, countResult] = await Promise.all([
        pool.query(
            `SELECT id, seller AS sellerName, material, amount, ${priceCast}
             FROM items
             WHERE status = 'AVAILABLE' AND source NOT IN ('creative', 'admin')
             ORDER BY id
             LIMIT $1 OFFSET $2`,
            [pageSize, offset]
        ),
        pool.query(
            `SELECT COUNT(*) AS count FROM items
             WHERE status = 'AVAILABLE' AND source NOT IN ('creative', 'admin')`
        ),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    return {
        items: data.rows,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
    };
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

    return {
        items: data.rows,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
    };
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

    return {
        items: data.rows,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
    };
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

    return {
        items: data.rows,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
    };
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
