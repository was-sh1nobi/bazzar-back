import { pool } from "../db";

export const registerIfAbsent = async (username: string, playeruuid: string) => {
    try {
        pool.query(
            `INSERT INTO users (playeruuid, username, balance) VALUES ($1,$2,0)
             ON CONFLICT(playeruuid) DO UPDATE SET username = excluded.username;`,
            [playeruuid, username]
        );
    } catch (error) {
        console.error("[registerIfAbsent error]", error);
    }
};