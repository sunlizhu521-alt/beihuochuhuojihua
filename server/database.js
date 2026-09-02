import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(rootDir, 'data');
const dbPath = path.join(dataDir, 'gendanjindu.sqlite');
const backupDir = path.join(dataDir, 'backups');
const backupIntervalMs = 6 * 60 * 60 * 1000;
const backupRetentionMs = 7 * 24 * 60 * 60 * 1000;

let SQL;
let db;
let backupTimerStarted = false;

export async function initDatabase() {
  if (db) return db;
  fs.mkdirSync(dataDir, { recursive: true });
  backupDatabaseOnStartup();
  SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }
  migrate();
  saveDatabase();
  startPeriodicDatabaseBackups();
  return db;
}

export function saveDatabase() {
  if (!db) return;
  const temporaryPath = `${dbPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, Buffer.from(db.export()));
    fs.renameSync(temporaryPath, dbPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

function backupDatabaseOnStartup() {
  try {
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, path.join(dataDir, 'gendanjindu.backup.sqlite'));
    }
  } catch {
    // Backup failures must not block service startup.
  }
}

function startPeriodicDatabaseBackups() {
  if (backupTimerStarted) return;
  backupTimerStarted = true;
  const timer = setInterval(() => {
    try {
      fs.mkdirSync(backupDir, { recursive: true });
      if (!fs.existsSync(dbPath)) return;
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const hourStr = String(now.getHours()).padStart(2, '0');
      fs.copyFileSync(dbPath, path.join(backupDir, `gendanjindu-${dateStr}-${hourStr}.sqlite`));
      const expiresBefore = Date.now() - backupRetentionMs;
      fs.readdirSync(backupDir).forEach((fileName) => {
        if (!fileName.endsWith('.sqlite')) return;
        const filePath = path.join(backupDir, fileName);
        if (fs.statSync(filePath).mtimeMs < expiresBefore) {
          fs.unlinkSync(filePath);
        }
      });
    } catch {
      // Backup failures must not affect the running service.
    }
  }, backupIntervalMs);
  timer.unref?.();
}

function migrate() {
  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS inventory_risk_settings (
      setting_key TEXT PRIMARY KEY,
      params_json TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_risk_setting_history (
      id TEXT PRIMARY KEY,
      setting_key TEXT NOT NULL,
      params_json TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_risk_setting_history_updated_at
      ON inventory_risk_setting_history(updated_at);
    CREATE TABLE IF NOT EXISTS dimension_files (
      slot_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      sheet_name TEXT NOT NULL DEFAULT '',
      sheet_names TEXT NOT NULL DEFAULT '[]',
      selected_sheet_names TEXT NOT NULL DEFAULT '[]',
      mapping_json TEXT NOT NULL,
      rows_json TEXT NOT NULL,
      source_file BLOB,
      source_file_mime TEXT NOT NULL DEFAULT '',
      source_file_size INTEGER NOT NULL DEFAULT 0,
      applied INTEGER NOT NULL DEFAULT 0,
      uploaded_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_manual_reconciliation_notes (
      note_key TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      business_unit TEXT NOT NULL,
      material_code TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_manual_notes_category
      ON inventory_manual_reconciliation_notes(category);
  `);

  const dimensionColumns = all('PRAGMA table_info(dimension_files)').map((row) => row.name);
  if (!dimensionColumns.includes('sheet_name')) {
    run("ALTER TABLE dimension_files ADD COLUMN sheet_name TEXT NOT NULL DEFAULT ''");
  }
  if (!dimensionColumns.includes('sheet_names')) {
    run("ALTER TABLE dimension_files ADD COLUMN sheet_names TEXT NOT NULL DEFAULT '[]'");
  }
  if (!dimensionColumns.includes('selected_sheet_names')) {
    run("ALTER TABLE dimension_files ADD COLUMN selected_sheet_names TEXT NOT NULL DEFAULT '[]'");
  }
  if (!dimensionColumns.includes('source_file')) {
    run('ALTER TABLE dimension_files ADD COLUMN source_file BLOB');
  }
  if (!dimensionColumns.includes('source_file_mime')) {
    run("ALTER TABLE dimension_files ADD COLUMN source_file_mime TEXT NOT NULL DEFAULT ''");
  }
  if (!dimensionColumns.includes('source_file_size')) {
    run('ALTER TABLE dimension_files ADD COLUMN source_file_size INTEGER NOT NULL DEFAULT 0');
  }
}

export function run(sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.run(params);
  } finally {
    statement.free();
  }
}

export function runMany(sql, rows = []) {
  if (!rows.length) return;
  const statement = db.prepare(sql);
  try {
    rows.forEach((params) => statement.run(params));
  } finally {
    statement.free();
  }
}

export function all(sql, params = []) {
  const statement = db.prepare(sql);
  const rows = [];
  try {
    statement.bind(params);
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

export function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

export function transaction(callback) {
  run('BEGIN');
  let committed = false;
  try {
    const result = callback();
    run('COMMIT');
    committed = true;
    saveDatabase();
    return result;
  } catch (error) {
    if (!committed) {
      run('ROLLBACK');
    } else if (fs.existsSync(dbPath)) {
      db.close();
      db = new SQL.Database(fs.readFileSync(dbPath));
    }
    throw error;
  }
}
