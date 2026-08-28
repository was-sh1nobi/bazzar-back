import { pool } from "../../db";

export type UiRole = "member" | "admin" | "owner";

export type WebUser = {
    id: number;
    username: string;
    password_hash: string;
    role: UiRole;
    created_at: number | null;
};

/**
 * Website accounts live in the dedicated `web_users` table — completely
 * separate from Minecraft players (`users`), which the plugin owns.
 */
export const getWebUserByUsername = (username: string): WebUser | null => {
    const row = pool.query(
        `SELECT id, username, password_hash, role FROM web_users WHERE username = $1 LIMIT 1`,
        [username]
    ).rows[0] as WebUser | undefined;
    return row ?? null;
};

export const webUsernameExists = (username: string): boolean => getWebUserByUsername(username) !== null;

export const createWebUser = (username: string, passwordHash: string): WebUser => {
    const row = pool.query(
        `INSERT INTO web_users (username, password_hash, role) VALUES ($1, $2, 'member')
         RETURNING id, username, role, created_at`,
        [username, passwordHash]
    ).rows[0] as WebUser;
    return row;
};

export type WebUserRow = {
    id: number;
    username: string;
    role: UiRole;
    created_at: number | null;
};

export const listWebUsers = (): WebUserRow[] =>
    pool.query(
        `SELECT id, username, role, created_at FROM web_users ORDER BY created_at DESC, username ASC LIMIT 500`
    ).rows as WebUserRow[];

export const isPrivileged = (role: string): boolean => role === "owner" || role === "admin";