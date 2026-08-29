import {db, pool, bumpVersion} from "../../db";

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

/**
 * Permanently removes a Minecraft player: their row (balance + auth) and all
 * of their listings, in a single transaction. Purchase history is retained —
 * it is denormalized audit data keyed by username.
 */
export const deletePlayerData = (uuid: string, username: string): {removedItems: number} => {
    let removedItems = 0;
    const tx = db.transaction(() => {
        removedItems = Number(db.query(`DELETE FROM items WHERE seller = ?`).run(username).changes);
        db.query(`DELETE FROM users WHERE playeruuid = ?`).run(uuid);
    });
    tx();
    bumpVersion();
    return {removedItems};
};
