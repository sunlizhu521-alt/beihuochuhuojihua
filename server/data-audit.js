import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';

const dbFile = path.resolve(process.argv[2] || '');

if (!dbFile || !fs.existsSync(dbFile)) {
  throw new Error(`Database file does not exist: ${dbFile || '(missing path)'}`);
}

const stat = fs.statSync(dbFile);
if (!stat.isFile() || stat.size <= 0) {
  throw new Error(`Database file is empty or invalid: ${dbFile}`);
}

const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync(dbFile));

function rows(sql, params = []) {
  const statement = db.prepare(sql);
  const result = [];
  try {
    statement.bind(params);
    while (statement.step()) result.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return result;
}

function scalar(sql) {
  const row = rows(sql)[0] || {};
  const value = Object.values(row)[0];
  return Number(value || 0);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return fallback;
  }
}

const integrityRows = rows('PRAGMA integrity_check');
const integrity = integrityRows.map((row) => String(Object.values(row)[0] || '')).filter(Boolean);
if (integrity.length !== 1 || integrity[0].toLowerCase() !== 'ok') {
  throw new Error(`Database integrity check failed: ${integrity.join('; ') || 'no result'}`);
}

const tableNames = rows(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).map((row) => String(row.name));
const tableCounts = Object.fromEntries(tableNames.map((tableName) => {
  const quotedName = `"${tableName.replaceAll('"', '""')}"`;
  return [tableName, scalar(`SELECT COUNT(*) FROM ${quotedName}`)];
}));

const criticalTotals = {
  orderDemandCurrentQty: scalar('SELECT COALESCE(SUM(current_order_qty), 0) FROM order_demands'),
  orderDemandRemainingQty: scalar('SELECT COALESCE(SUM(tracking_remaining_qty), 0) FROM order_demands'),
  kingdeeOrderQty: scalar('SELECT COALESCE(SUM(quantity), 0) FROM kingdee_orders'),
  kingdeeInboundQty: scalar('SELECT COALESCE(SUM(inbound_qty), 0) FROM kingdee_orders'),
  progressInProductionQty: scalar('SELECT COALESCE(SUM(in_production_qty), 0) FROM supplier_progress'),
  progressFinishedQty: scalar('SELECT COALESCE(SUM(finished_qty), 0) FROM supplier_progress'),
  progressUnpreparedQty: scalar('SELECT COALESCE(SUM(unprepared_qty), 0) FROM supplier_progress'),
  progressPreparedNotStartedQty: scalar('SELECT COALESCE(SUM(prepared_not_started_qty), 0) FROM supplier_progress'),
  progressShippedQty: scalar('SELECT COALESCE(SUM(shipped_qty), 0) FROM supplier_progress'),
  inventoryQty: scalar('SELECT COALESCE(SUM(stock_qty), 0) FROM inventory'),
  appliedDimensionFiles: scalar('SELECT COUNT(*) FROM dimension_files WHERE applied = 1')
};
const migrationMarkers = Object.fromEntries(rows(
  `SELECT kind, mapping_json FROM import_mappings
   WHERE kind IN ('manual-progress-parser-version')`
).map((row) => [String(row.kind), String(row.mapping_json || '')]));

const firstMileSlotIds = [
  'firstMileData1', 'firstMileData2', 'firstMileData3',
  'firstMileData4', 'firstMileData5', 'firstMileSpare'
];
const firstMileFiles = rows(
  `SELECT slot_id, mapping_json, rows_json, source_file_size
   FROM dimension_files
   WHERE applied = 1 AND slot_id IN (${firstMileSlotIds.map(() => '?').join(', ')})`,
  firstMileSlotIds
);
const firstMileRows = firstMileFiles.flatMap((file) => {
  const parsed = parseJson(file.rows_json, []);
  return Array.isArray(parsed) ? parsed : [];
});
const firstMileParserVersions = {};
firstMileFiles.forEach((file) => {
  const mapping = parseJson(file.mapping_json, {});
  const version = String(Number(mapping?.__firstMileSummary?.parserVersion || 0));
  firstMileParserVersions[version] = (firstMileParserVersions[version] || 0) + 1;
});
const firstMile = {
  sourceCount: firstMileFiles.length,
  originalFileCount: firstMileFiles.filter((file) => Number(file.source_file_size || 0) > 0).length,
  parserVersions: firstMileParserVersions,
  rowCount: firstMileRows.length,
  destinationWarehouseRows: firstMileRows.filter((row) => String(row?.destinationWarehouse || '').trim()).length,
  fbaRows: firstMileRows.filter((row) => row?.inboundWarehouseType === 'FBA仓').length,
  fbmRows: firstMileRows.filter((row) => row?.inboundWarehouseType === 'FBM仓').length
};

console.log(JSON.stringify({
  file: dbFile,
  size: stat.size,
  modifiedAt: stat.mtime.toISOString(),
  integrity: 'ok',
  tableCounts,
  criticalTotals,
  migrationMarkers,
  firstMile
}));

db.close();
