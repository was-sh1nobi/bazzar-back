import {Database} from "bun:sqlite";

const dbPath = process.env.DATABASE_URL ?? "./bazzar.db";

export const db = new Database(dbPath, {create: true});

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
    CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seller TEXT NOT NULL,
        material TEXT,
        amount INTEGER,
        price TEXT,
        source TEXT,
        origin TEXT,
        status TEXT NOT NULL DEFAULT 'AVAILABLE'
    );

    CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seller TEXT,
        buyer TEXT,
        material TEXT,
        price TEXT,
        amount INTEGER,
        source TEXT,
        origin TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
        playeruuid TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        password_hash TEXT,
        created_at INTEGER DEFAULT (unixepoch())
    );

    -- Website accounts are intentionally SEPARATE from Minecraft players:
    -- no UUID, no balance, and the plugin never touches this table.
    CREATE TABLE IF NOT EXISTS web_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS shop_items (
        id TEXT PRIMARY KEY,
        material TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        buy REAL NOT NULL CHECK(buy >= 0),
        sell REAL NOT NULL CHECK(sell >= 0)
    );

    CREATE TABLE IF NOT EXISTS shop_purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        playeruuid TEXT NOT NULL,
        itemId TEXT NOT NULL,
        material TEXT NOT NULL,
        amount INTEGER NOT NULL,
        priceEach REAL NOT NULL,
        totalCost REAL NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY(playeruuid) REFERENCES users(playeruuid)
    );

    CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
    CREATE INDEX IF NOT EXISTS idx_items_seller ON items(seller);
    CREATE INDEX IF NOT EXISTS idx_history_buyer ON history(buyer);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_web_users_username ON web_users(username);
    CREATE INDEX IF NOT EXISTS idx_shop_material ON shop_items(material);
    CREATE INDEX IF NOT EXISTS idx_shop_category ON shop_items(category);
    CREATE INDEX IF NOT EXISTS idx_shop_purchases_player ON shop_purchases(playeruuid);
`);

// --- Migration: legacy users(username PK) -> users(playeruuid PK) ---
try {
    const cols = db.query(`PRAGMA table_info(users)`).all() as {name: string}[];
    const hasUsernamePk = cols.some(c => c.name === 'username') && cols.find(c => c.name === 'playeruuid') === undefined || (() => {
        const sql = (db.query(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`).get() as {sql: string} | undefined)?.sql ?? "";
        return sql.includes("username TEXT PRIMARY KEY");
    })();
    if (hasUsernamePk) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS users_new (
                playeruuid TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                balance REAL NOT NULL DEFAULT 0,
                password_hash TEXT,
                created_at INTEGER DEFAULT (unixepoch())
            );
            INSERT OR IGNORE INTO users_new (playeruuid, username, balance)
                SELECT COALESCE(playeruuid, hex(randomblob(16))), username, balance FROM users WHERE playeruuid IS NOT NULL
                UNION ALL
                SELECT hex(randomblob(16)), username, balance FROM users WHERE playeruuid IS NULL;
            DROP TABLE users;
            ALTER TABLE users_new RENAME TO users;
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        `);
        console.log("[db] migrated users table to playeruuid PK");
    }
    // Ensure columns exist for fresh DBs that already had new schema but missing cols
    const colNames = new Set(((db.query(`PRAGMA table_info(users)`).all() as {name: string}[]).map(c => c.name)));
    if (!colNames.has("password_hash")) db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT;`);
    if (!colNames.has("created_at")) db.exec(`ALTER TABLE users ADD COLUMN created_at INTEGER DEFAULT (unixepoch());`);
    if (!colNames.has("banned")) db.exec(`ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;`);
    // Legacy cleanup: roles moved to the separate web_users table; revert users to its original schema
    if (colNames.has("role")) {
        try {
            db.exec(`ALTER TABLE users DROP COLUMN role;`);
            console.log("[db] dropped legacy users.role column (roles now live in web_users)");
        } catch (e) {
            console.error("[db] could not drop legacy users.role column", e);
        }
    }
} catch (e) {
    console.error("[db] migration check failed", e);
}

export const mutationVersion = { value: 0 };
export const bumpVersion = () => {
    mutationVersion.value += 1;
};
export const getVersion = () => mutationVersion.value;

const run = (text: string, params: unknown[] = []) => {
    const stmt = db.query(text);
    return params.length > 0 ? stmt.all(...params) : stmt.all();
};

export const pool = {
    query: (text: string, params?: unknown[]) => ({rows: run(text, params)}),
    connect: async () => ({
        query: (text: string, params?: unknown[]) => ({rows: run(text, params)}),
        release: () => {},
    }),
};