import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server', 'app.js'), 'utf8');
const databaseSource = fs.readFileSync(path.join(root, 'server', 'database.js'), 'utf8');

test('头程数据看板支持按预计开船月份联动筛选并同步导出', () => {
  const client = clientSource.slice(
    clientSource.indexOf('function firstMileExpectedSailingMonth('),
    clientSource.indexOf('function FirstMileDatabase(')
  );
  const server = serverSource.slice(
    serverSource.indexOf('function firstMileExpectedSailingMonth('),
    serverSource.indexOf('function splitDelimited(')
  );

  assert.match(client, /expectedSailingMonth: ''/);
  assert.match(client, /firstMileExpectedSailingMonth\(row\.expectedSailingAt\) === filters\.expectedSailingMonth/);
  assert.match(client, /expectedSailingMonths: unique\(rowsFor\('expectedSailingMonth'\)/);
  assert.match(client, /label="预计开船月份"[\s\S]*?options=\{options\.expectedSailingMonths\}/);
  assert.match(client, /expectedSailingMonth: '', keyword: ''/);
  assert.match(client, /body: JSON\.stringify\(\{ filters \}\)/);
  assert.match(server, /firstMileExpectedSailingMonth\(row\.expectedSailingAt\) === filters\.expectedSailingMonth/);
  assert.match(server, /return match \? `\$\{match\[1\]\}-\$\{match\[2\]\.padStart\(2, '0'\)\}` : '未填写'/);
});

test('头程数据看板首位展示随筛选联动的数量合计卡', () => {
  const client = clientSource.slice(
    clientSource.indexOf('function FirstMileBoard('),
    clientSource.indexOf('function DimensionLibrary(')
  );

  assert.match(client, /const filteredRows = useMemo\(\(\) => rows\.filter\(\(row\) => matchesFilters\(row\)\)/);
  assert.match(client, /const totalQuantity = filteredRows\.reduce\(\(sum, row\) => sum \+ numberValue\(row\.quantity\), 0\)/);
  assert.match(client, /<section className="metric-grid">\s*<MetricCard label="数量合计" value=\{totalQuantity\.toLocaleString\(\)\} tone="first-mile-total" \/>/);
  assert.doesNotMatch(client, /label="货物数量合计"/);
});

test('头程数据看板展示、搜索并导出目的仓库', () => {
  assert.match(clientSource, /row\.destinationWarehouse, row\.inboundWarehouseType, row\.sourceOwner/);
  assert.match(clientSource, /'店铺', '目的仓库', '入仓类型', '运营'/);
  assert.match(clientSource, /<TightCell value=\{row\.destinationWarehouse \|\| '未填写'\} \/>/);
  assert.match(clientSource, /<TightCell value=\{row\.inboundWarehouseType \|\| '未填写'\} \/>/);
  assert.match(clientSource, /搜索OA、物料、SKU、货件号、目的仓库、入仓类型、来源/);
  assert.match(serverSource, /row\.destinationWarehouse, row\.inboundWarehouseType, row\.sourceOwner/);
  assert.match(serverSource, /'店铺', '目的仓库', '入仓类型', '运营'/);
  assert.match(serverSource, /row\.storeName, row\.destinationWarehouse,\s*row\.inboundWarehouseType, row\.operatorName/);
  assert.match(serverSource, /requiresReupload: numberValue\(mapping\.__firstMileSummary\?\.parserVersion\) < FIRST_MILE_PARSER_VERSION/);
  assert.match(serverSource, /function migrateAppliedFirstMileSources\(\)/);
  assert.match(serverSource, /source_file, source_file_size/);
  assert.match(serverSource, /reparseFirstMileSource\(/);
});

test('头程数据库保存并下载已上传的原始文件', () => {
  assert.match(databaseSource, /source_file BLOB/);
  assert.match(databaseSource, /source_file_mime TEXT NOT NULL DEFAULT ''/);
  assert.match(databaseSource, /source_file_size INTEGER NOT NULL DEFAULT 0/);
  assert.match(serverSource, /app\.get\('\/api\/dimensions\/:slotId\/download', requireAuth, requirePage\('firstMileDatabase'\)/);
  assert.match(serverSource, /if \(!isFirstMileSlot\(slotId\)\) return res\.status\(404\)/);
  assert.match(serverSource, /该文件在下载功能上线前上传，请重新上传一次后再下载原文件/);
  assert.match(serverSource, /UPDATE dimension_files SET source_file = \?, source_file_mime = \?, source_file_size = \?/);
  assert.match(clientSource, /async function downloadSlot\(slot, record\)/);
  assert.match(clientSource, /slot\.firstMile && record && !record\.hasOriginalFile/);
  assert.match(clientSource, /slot\.firstMile && record && <button[\s\S]*?>\{state\.busy === 'download' \? '下载中\.\.\.' : '下载文件'\}<\/button>/);
});
