import { pool } from "../db";

export const registerIfAbsent = async (username: string, playeruuid: string) => {
    try {
        pool.query(
            `INSERT INTO users (username, balance, playeruuid)
             VALUES ($1, $2, $3)
             ON CONFLICT (username) DO NOTHING;`,
            [username, 0, playeruuid]
        );
    } catch (error) {
        console.error("[registerIfAbsent error]", error);
    }
};