import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = fs.readFileSync(path.join(root, 'server', 'app.js'), 'utf8');
const maintenanceSource = appSource.slice(
  appSource.indexOf("app.post('/api/maintenance/repair-supplier-short-names'"),
  appSource.indexOf('app.use((err, req, res, next) =>')
);

test('供应商简称修复接口在事务中回填并返回修复报告', () => {
  assert.ok(maintenanceSource.length > 0, '维护接口必须位于 API 错误处理中间件之前');
  assert.match(maintenanceSource, /getDimensionRows\('purchaseAssignment'\)/);
  assert.match(maintenanceSource, /SELECT DISTINCT supplier FROM order_demands WHERE active=1/);
  assert.match(maintenanceSource, /transaction\(\(\) => \{/);
  assert.match(maintenanceSource, /UPDATE order_demands SET supplier_short_name=\?/);
  assert.match(maintenanceSource, /fixedByDim/);
  assert.match(maintenanceSource, /fixedByHeuristic/);
  assert.match(maintenanceSource, /remainingAfterFix/);
  assert.match(maintenanceSource, /report\.success = report\.remainingAfterFix === 0/);
});

test('数据完整性接口校验简称空值和金蝶双向覆盖', () => {
  assert.match(maintenanceSource, /app\.get\('\/api\/maintenance\/data-completeness', requireAuth/);
  assert.match(maintenanceSource, /supplier_short_name空值/);
  assert.match(maintenanceSource, /金蝶剩余>0但需求无匹配/);
  assert.match(maintenanceSource, /需求有数量但金蝶无匹配/);
  assert.match(maintenanceSource, /当前金蝶非零订单完整展示/);
  assert.match(maintenanceSource, /sourceCount: sourceOrderKeys\.size/);
  assert.match(maintenanceSource, /missingOrderKeys/);
  assert.match(maintenanceSource, /duplicateOrderKeys/);
  assert.match(maintenanceSource, /NOT EXISTS \(SELECT 1 FROM order_demands d WHERE d\.demand_key = k\.demand_key AND d\.active = 1\)/);
  assert.match(maintenanceSource, /NOT EXISTS \(SELECT 1 FROM kingdee_orders k WHERE k\.demand_key = d\.demand_key\)/);
  assert.match(maintenanceSource, /checks\.filter\(c => c\.check !== '核心表行数'\)\.every\(c => c\.passed\)/);
});
