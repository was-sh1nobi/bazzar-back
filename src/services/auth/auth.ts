import { pool } from "../../db";

export type AuthUser = {
    playeruuid: string;
    username: string;
    password_hash: string | null;
};

export const getUserByUuid = (uuid: string): AuthUser | null => {
    const row = pool.query(`SELECT playeruuid, username, password_hash FROM users WHERE playeruuid = $1 LIMIT 1`, [uuid]).rows[0] as AuthUser | undefined;
    return row ?? null;
};

export const getUserByName = (name: string): AuthUser | null => {
    const row = pool.query(`SELECT playeruuid, username, password_hash FROM users WHERE username = $1 LIMIT 1`, [name]).rows[0] as AuthUser | undefined;
    return row ?? null;
};

export const ensureUser = (uuid: string, username: string) => {
    pool.query(
        `INSERT INTO users (playeruuid, username, balance, password_hash) VALUES ($1,$2,0,NULL)
         ON CONFLICT(playeruuid) DO UPDATE SET username = excluded.username`,
        [uuid, username]
    );
};

export const setPasswordHash = (uuid: string, hash: string) => {
    pool.query(`UPDATE users SET password_hash = $1 WHERE playeruuid = $2`, [hash, uuid]);
};

export const isRegistered = (uuid: string): boolean => {
    const u = getUserByUuid(uuid);
    return !!(u && u.password_hash);
};
