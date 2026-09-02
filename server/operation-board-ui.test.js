import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('运营看板辅助列包含供应商、创建人并且仍参与搜索和导出', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const dashboard = client.slice(client.indexOf('function Dashboard('), client.indexOf('function AppliedTimeNote('));
  const expectedColumns = "'供应商', '创建人', '供应商简称'";

  assert.equal((dashboard.match(new RegExp(expectedColumns, 'g')) || []).length, 1);
  assert.match(dashboard, /showOperationAuxiliaryColumns \? \['运营', '供应商', '创建人'\] : \[\]/);
  assert.match(dashboard, /showOperationAuxiliaryColumns \? \[row\.operatorName, row\.supplier, row\.orderCreator\] : \[\]/);
  assert.equal((dashboard.match(/row\.supplier,\s+row\.orderCreator,\s+orderSupplierName\(row\)/g) || []).length, 1);
  assert.match(dashboard, /row\.supplier,\s+row\.orderCreator,\s+row\.productLine/);
  assert.match(dashboard, /placeholder="搜索运营、供应商、创建人/);
});

test('运营看板默认隐藏八个辅助列并可切换显示，导出保留完整字段', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
  const dashboard = client.slice(client.indexOf('function Dashboard('), client.indexOf('function AppliedTimeNote('));
  const expectedColumns = "'采购订单号', '来源文件', '有效订单条件', '关闭状态', '单据状态', '事业部'";

  assert.equal((dashboard.match(new RegExp(expectedColumns, 'g')) || []).length, 1);
  assert.match(dashboard, /useState\(false\)/);
  assert.match(dashboard, /showOperationAuxiliaryColumns \? \['来源文件', '有效订单条件', '关闭状态', '单据状态'\] : \[\]/);
  assert.match(dashboard, /showOperationAuxiliaryColumns \? \['OA备货流程号'\] : \[\]/);
  assert.match(dashboard, /showOperationAuxiliaryColumns \? \[row\.sourceFile, row\.effectiveOrderCondition, row\.closeStatus, row\.documentStatus\] : \[\]/);
  assert.match(dashboard, /showOperationAuxiliaryColumns \? \[row\.oaFlowNo\] : \[\]/);
  assert.match(dashboard, /显示订单辅助信息/);
  assert.match(dashboard, /隐藏订单辅助信息/);
  assert.match(dashboard, /aria-pressed=\{showOperationAuxiliaryColumns\}/);
  assert.match(styles, /\.operation-table-toolbar\s*\{[^}]*gap:\s*8px/);
  assert.match(styles, /\.operation-table-toolbar \.compact-button\s*\{[^}]*margin-left:\s*0/);
  assert.doesNotMatch(styles, /\.operation-table-toolbar \.compact-button\s*\{[^}]*margin-left:\s*auto/);
  assert.match(dashboard, /rows\.flatMap/);
  assert.match(dashboard, /if \(row\.operationOrderLevel\) return \[row\]/);
  assert.doesNotMatch(dashboard, /row\.effectiveOrderCondition === '有效订单'/);
  assert.match(dashboard, /numberValue\(row\.remainingInboundQty\) !== 0/);
  assert.match(dashboard, /demandKey: `\$\{row\.demandKey\}\|\$\{orderRow\.orderNo\}`/);
});

test('运营看板数据仍只来自当前应用金蝶采购订单', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const dashboard = client.slice(client.indexOf('function Dashboard('), client.indexOf('function AppliedTimeNote('));

  assert.doesNotMatch(dashboard, /row\.dataStatus === '采购订单数据'/);
});

test('运营看板支持成品和配件联动筛选', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const dashboard = client.slice(client.indexOf('function Dashboard('), client.indexOf('function AppliedTimeNote('));

  assert.match(dashboard, /purchaseOwner: \[\], productType: \[\]/);
  assert.match(dashboard, /omit === 'productType'[\s\S]*?row\.productLine === '其他\/配件' \? '配件' : '成品'/);
  assert.match(dashboard, /productTypes: \['成品', '配件'\]/);
  assert.doesNotMatch(dashboard, /productTypes: \['成品', '配件'\]\.filter/);
  assert.match(dashboard, /productType: options\.productTypes/);
  assert.match(dashboard, /label="成品\/配件" allLabel="全部类型"[\s\S]*?value=\{filters\.productType\}[\s\S]*?options=\{options\.productTypes\}/);
  assert.match(dashboard, /const clearFilters = \(\) => setFilters\([\s\S]*?productType: \[\]/);
});

test('运营看板使用页面权限保护的全量只读接口，不套用生产跟进采购负责人过滤', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server', 'app.js'), 'utf8');
  const page = client.slice(client.indexOf('function OperationBoardPage('), client.indexOf('function Dashboard('));
  const route = server.slice(
    server.indexOf("app.get('/api/operation-board/demands'"),
    server.indexOf("app.get('/api/table-relationships'")
  );

  assert.match(page, /request\('\/api\/operation-board\/demands', \{ token \}\)/);
  assert.doesNotMatch(page, /request\('\/api\/demands\?orderLevel=1'/);
  assert.match(route, /requireAuth, requirePage\('operationBoard'\)/);
  assert.match(route, /demandRows\(false, null, \{ includeOperationOrders: true, currentKingdeeOnly: true \}\)/);
});

test('运营看板删除是否多家供应、数据来源和是否有效订单筛选器', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const dashboard = client.slice(client.indexOf('function Dashboard('), client.indexOf('function AppliedTimeNote('));

  assert.doesNotMatch(dashboard, /label="是否多家供应"/);
  assert.doesNotMatch(dashboard, /label="数据来源"/);
  assert.doesNotMatch(dashboard, /label="是否有效订单"/);
  assert.doesNotMatch(dashboard, /filters\.(supplierCount|dataSource|effectiveOrderCondition)/);
  assert.doesNotMatch(dashboard, /(supplierCounts|dataSources|effectiveOrderConditions):/);
});

test('运营看板事业部统一只保留星号前内容', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const grouping = fs.readFileSync(path.join(root, 'src', 'operation-board-grouping.js'), 'utf8');
  const dashboard = client.slice(client.indexOf('function Dashboard('), client.indexOf('function AppliedTimeNote('));

  assert.match(dashboard, /\.map\(\(row\) => \(\{ \.\.\.row, businessUnit: purchaseTrackingBusinessUnit\(row\.businessUnit\) \}\)\)/);
  assert.match(grouping, /import \{ purchaseTrackingBusinessUnit \} from '\.\/business-unit\.js'/);
  assert.match(grouping, /const businessUnit = purchaseTrackingBusinessUnit\(row\.businessUnit\)/);
  assert.doesNotMatch(grouping, /function normalizedBusinessUnit/);
});

test('同订单同物料存在有效明细即判有效，手工行使用手工导入来源文件', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const server = fs.readFileSync(path.join(root, 'server', 'app.js'), 'utf8');

  assert.equal((server.match(/rows\.some\(isEffectivePurchaseOrder\)/g) || []).length, 2);
  assert.doesNotMatch(server, /rows\.every\(isEffectivePurchaseOrder\)/);
  assert.match(server, /const manualSourceFile = normalize\(manualBatch\?\.file_name\)/);
  assert.match(server, /sourceFile: orderDetails\?\.sourceFile \|\| manualSourceFile/);
});

test('运营看板后端排除手工行并统一标记为金蝶系统数据', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const server = fs.readFileSync(path.join(root, 'server', 'app.js'), 'utf8');
  const demandRows = server.slice(server.indexOf('function demandRows('), server.indexOf('function uniqueOrderNos('));

  assert.match(demandRows, /options\.currentKingdeeOnly/);
  assert.match(demandRows, /filter\(\(row\) => row\.operationOrderLevel\)/);
  assert.match(demandRows, /dataSource: '金蝶系统'/);
  assert.match(demandRows, /dataStatus: '采购订单数据'/);
});

test('运营看板和生产跟进均排除关闭状态不是未关闭的订单', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const server = fs.readFileSync(path.join(root, 'server', 'app.js'), 'utf8');
  const loadContext = server.slice(server.indexOf('function demandLoadContext('), server.indexOf('function currentKingdeeNonZeroOrderGroups('));
  const demandRows = server.slice(server.indexOf('function demandRows('), server.indexOf('function uniqueOrderNos('));

  assert.match(loadContext, /if \(normalize\(row\.close_status\) && normalize\(row\.close_status\) !== TRACKING_CLOSE_STATUS\) return;/);
  assert.match(demandRows, /const context = demandLoadContext\(demands, \{ includeInventory: options\.includeInventory !== false \}\);/);
  assert.doesNotMatch(server, /includeClosedOrders/);
});

test('运营看板提供采购订单号和物料编码双方案并默认按订单展示', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
  const dashboard = client.slice(client.indexOf('function Dashboard('), client.indexOf('function AppliedTimeNote('));

  assert.match(dashboard, /const \[operationViewMode, setOperationViewMode\] = useState\('orderNo'\)/);
  assert.match(dashboard, />方案一：采购订单号<\/button>/);
  assert.match(dashboard, />方案二：按物料编码<\/button>/);
  assert.match(dashboard, /aria-label="运营看板展示方案"/);
  assert.match(dashboard, /setOperationViewMode\('orderNo'\)/);
  assert.match(dashboard, /setOperationViewMode\('materialCode'\)/);
  assert.match(dashboard, /\[filters, operationViewMode\]/);
  assert.match(styles, /\.operation-board-scheme-bar\s*\{/);
});

test('运营看板先筛选订单明细再按物料和事业部汇总，页面和导出统一使用方案数据', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const dashboard = client.slice(client.indexOf('function Dashboard('), client.indexOf('function AppliedTimeNote('));

  assert.match(dashboard, /const filteredOrderRows = useMemo\([\s\S]*?activeRows\.filter\(\(row\) => matchesDashboardFilters\(row\)\)/);
  assert.match(dashboard, /groupOperationBoardRowsByMaterial\(filteredOrderRows\)/);
  assert.match(dashboard, /groupOperationBoardRowsByMaterial\(activeRows\)/);
  assert.match(dashboard, /当前显示 \{filteredRows\.length\} \/ \{schemeActiveRows\.length\} 条/);
  assert.match(dashboard, /\.\.\.filteredRows\.map/);
  assert.match(dashboard, /rows=\{filteredRows\}/);
  assert.match(dashboard, /rows=\{pageRows\}/);
});

test('运营看板方案二隐藏下单月份和采购订单号列但导出继续保留', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const dashboard = client.slice(client.indexOf('function Dashboard('), client.indexOf('function AppliedTimeNote('));

  assert.match(dashboard, /operationViewMode === 'materialCode' \? \[\] : \['下单月份', '采购订单号'\]/);
  assert.match(dashboard, /operationViewMode === 'materialCode' \? \[\] : \[row\.month, row\.orderNo\]/);
  assert.match(dashboard, /\? \['下单月份', '采购订单号', '来源文件'/);
  assert.match(dashboard, /row\.month,\s+row\.orderNo,\s+row\.sourceFile/);
});

test('运营看板方案二供应商和事业部图按订单明细分别聚合而不使用组合名称', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const dashboard = client.slice(client.indexOf('function Dashboard('), client.indexOf('function AppliedTimeNote('));

  assert.match(dashboard, /const filteredOrderRows = useMemo\([\s\S]*?activeRows\.filter\(\(row\) => matchesDashboardFilters\(row\)\)/);
  assert.match(dashboard, /groupOperationBoardRowsByMaterial\(filteredOrderRows\)/);
  assert.match(dashboard, /const operationDimensionChartRows = usesOperationBoardLayout && operationViewMode === 'materialCode'[\s\S]*?\? filteredOrderRows[\s\S]*?: filteredRows/);
  assert.equal((dashboard.match(/rows=\{operationDimensionChartRows\}/g) || []).length, 2);
  assert.match(dashboard, /rows=\{operationDimensionChartRows\} groupBy=\{\(row\) => orderSupplierName\(row\)\}/);
  assert.doesNotMatch(dashboard, /groupBy=\{\(row\) => normalize\(row\.supplier\)/);
  assert.match(dashboard, /rows=\{operationDimensionChartRows\} groupBy=\{\(row\) => purchaseTrackingBusinessUnit\(row\.businessUnit\)\}/);
  assert.equal((dashboard.match(/rows=\{filteredRows\} groupBy=/g) || []).length, 2);
});
