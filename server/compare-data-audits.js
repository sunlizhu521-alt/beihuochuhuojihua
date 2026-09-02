import fs from 'node:fs';

const baselineFile = process.argv[2];
const postFile = process.argv[3];

if (!baselineFile || !postFile) {
  throw new Error('Usage: node server/compare-data-audits.js <baseline.json> <post.json>');
}

const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
const post = JSON.parse(fs.readFileSync(postFile, 'utf8'));
const ignoredTables = new Set(['sessions', 'operation_logs']);
const markerValue = (audit, key) => {
  const raw = audit.migrationMarkers?.[key];
  if (raw === undefined) return '';
  try {
    return String(JSON.parse(raw));
  } catch {
    return String(raw);
  }
};
const manualProgressMigration = markerValue(baseline, 'manual-progress-parser-version') !== '3'
  && markerValue(post, 'manual-progress-parser-version') === '3';
const manualMigrationTables = new Set([
  'import_mappings',
  'manual_progress_allocations',
  'supplier_progress',
  'supplier_progress_snapshots'
]);
const manualMigrationTotals = new Set([
  'progressInProductionQty',
  'progressFinishedQty',
  'progressUnpreparedQty',
  'progressPreparedNotStartedQty',
  'progressShippedQty'
]);

const tableNames = new Set([
  ...Object.keys(baseline.tableCounts || {}),
  ...Object.keys(post.tableCounts || {})
]);
const changedTables = [...tableNames]
  .filter((table) => !ignoredTables.has(table))
  .filter((table) => !(manualProgressMigration && manualMigrationTables.has(table)))
  .filter((table) => !(baseline.tableCounts?.[table] === undefined && post.tableCounts?.[table] === 0))
  .filter((table) => baseline.tableCounts?.[table] !== post.tableCounts?.[table])
  .map((table) => `${table}:${baseline.tableCounts?.[table] ?? 'missing'}->${post.tableCounts?.[table] ?? 'missing'}`);

const totalNames = new Set([
  ...Object.keys(baseline.criticalTotals || {}),
  ...Object.keys(post.criticalTotals || {})
]);
const changedTotals = [...totalNames]
  .filter((key) => !(manualProgressMigration && manualMigrationTotals.has(key)))
  .filter((key) => baseline.criticalTotals?.[key] !== post.criticalTotals?.[key])
  .map((key) => `${key}:${baseline.criticalTotals?.[key] ?? 'missing'}->${post.criticalTotals?.[key] ?? 'missing'}`);

const migrationValidationErrors = [];
if (manualProgressMigration) {
  if (baseline.tableCounts?.manual_progress_rows !== post.tableCounts?.manual_progress_rows) {
    migrationValidationErrors.push('manual_progress_rows count changed');
  }
  const activeSourceRows = Number(post.tableCounts?.manual_progress_rows || 0);
  const allocationRows = Number(post.tableCounts?.manual_progress_allocations || 0);
  if (activeSourceRows > 0 && allocationRows <= 0) migrationValidationErrors.push('manual progress allocations were not created');
}

if (baseline.integrity !== 'ok' || post.integrity !== 'ok' || changedTables.length || changedTotals.length || migrationValidationErrors.length) {
  throw new Error(`Post-deploy data validation failed. Tables=[${changedTables.join(',')}], totals=[${changedTotals.join(',')}], migrations=[${migrationValidationErrors.join(',')}]`);
}

console.log(JSON.stringify({
  integrity: post.integrity,
  manualProgressMigration,
  tableCounts: post.tableCounts,
  criticalTotals: post.criticalTotals,
  firstMileBefore: baseline.firstMile || {},
  firstMileAfter: post.firstMile || {}
}));
