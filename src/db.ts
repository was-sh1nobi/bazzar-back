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
        username TEXT PRIMARY KEY,
        balance INTEGER NOT NULL DEFAULT 0,
        playeruuid TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
    CREATE INDEX IF NOT EXISTS idx_items_seller ON items(seller);
    CREATE INDEX IF NOT EXISTS idx_history_buyer ON history(buyer);
`);

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