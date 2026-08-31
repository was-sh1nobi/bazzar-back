import {pool} from "../../db";

const resolveUuid = async (playerUuid: string): Promise<string | null> => {
    const res = pool.query(`SELECT playeruuid FROM users WHERE playeruuid = $1 LIMIT 1`, [playerUuid]);
    return res.rows.length > 0 ? playerUuid : null;
};

export const registerIfAbsentByUuid = async (playerUuid: string, username?: string) => {
    const name = (username ?? playerUuid).trim();
    pool.query(
        `INSERT INTO users (playeruuid, username, balance) VALUES ($1,$2,0)
         ON CONFLICT(playeruuid) DO UPDATE SET username = excluded.username`,
        [playerUuid, name]
    );
};

export const getBalance = async (playerUuid: string): Promise<number> => {
    const res = pool.query(`SELECT balance FROM users WHERE playeruuid = $1 LIMIT 1`, [playerUuid]);
    if (res.rows.length === 0) {
        await registerIfAbsentByUuid(playerUuid);
        return 0;
    }
    return Number(res.rows[0].balance) || 0;
};

export const setBalance = async (playerUuid: string, balance: number) => {
    await registerIfAbsentByUuid(playerUuid);
    pool.query(`UPDATE users SET balance = $1 WHERE playeruuid = $2`, [balance, playerUuid]);
    return balance;
};

export const changeBalance = async (playerUuid: string, delta: number): Promise<number> => {
    await registerIfAbsentByUuid(playerUuid);
    // atomic: only succeed if resulting balance >=0
    const res = pool.query(
        `UPDATE users SET balance = balance + $1 WHERE playeruuid = $2 AND balance + $1 >= 0 RETURNING balance`,
        [delta, playerUuid]
    );
    if (res.rows.length === 0) {
        // distinguish insufficient funds vs missing user (should not happen after register)
        const cur = await getBalance(playerUuid);
        if (cur + delta < 0) throw new Error("insufficient funds");
        throw new Error("balance update failed");
    }
    return Number(res.rows[0].balance);
};

export const deductBalanceAtomic = async (playerUuid: string, cost: number): Promise<number> => {
    if (cost <= 0) throw new Error("invalid cost");
    return changeBalance(playerUuid, -cost);
};

export const creditIfRegistered = async (sellerName: string, amount: number) => {
    // Prefer UUID lookup via history; fallback to username
    const res = pool.query(`SELECT playeruuid FROM users WHERE username = $1 LIMIT 1`, [sellerName]);
    if (res.rows.length === 0) return;
    const sellerUuid = res.rows[0].playeruuid;
    if (!sellerUuid) return;
    await changeBalance(sellerUuid, amount);
};