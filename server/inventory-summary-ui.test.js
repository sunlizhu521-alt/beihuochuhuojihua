import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('事业部订单库存明细默认隐藏来源仓库并可同步展示和导出', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
  const loadingProgress = fs.readFileSync(path.join(root, 'src', 'loading-progress.js'), 'utf8');
  const dashboard = client.slice(
    client.indexOf('function InventorySummary('),
    client.indexOf('function InventoryPurchaseDistribution(')
  );

  assert.match(dashboard, /const \[showSourceWarehouses, setShowSourceWarehouses\] = useState\(false\)/);
  assert.match(dashboard, /showSourceWarehouses \? \[\['来源仓库',[\s\S]*?\]\] : \[\]/);
  assert.doesNotMatch(dashboard, /\['来源表'/);
  assert.match(dashboard, /showSourceWarehouses \? \[inventorySourceWarehouses\(row, '\\n'\)\] : \[\]/);
  assert.match(dashboard, /showSourceWarehouses \? '隐藏来源仓库' : '显示来源仓库'/);
  assert.match(dashboard, /showSourceBreakdown \? \[[\s\S]*?\['已生产未发货',[\s\S]*?\['生产中产品',[\s\S]*?\] : \[\]\),[\s\S]*?\['未交付数量'/);
  assert.match(dashboard, /const \[salesMonthRange, setSalesMonthRange\] = useState\('3'\)/);
  assert.match(dashboard, /allMonthColumns\.slice\(-Number\(salesMonthRange\)\)/);
  assert.match(dashboard, /最近3个月/);
  assert.match(dashboard, /最近6个月/);
  assert.match(dashboard, /最近12个月/);
  assert.match(dashboard, /全部月份/);
  assert.doesNotMatch(dashboard, /\['匹配列（事业部\+物料编码）'/);
  assert.match(dashboard, /InventorySummaryVerticalGroupedBars title="销售产品线库存、在途与未交付"/);
  assert.match(dashboard, /<div className="inventory-composition-row">[\s\S]*?在库构成[\s\S]*?在途构成[\s\S]*?<\/div>/);
  assert.match(dashboard, /<MultiSelectFilter label="站点"[\s\S]*?value=\{filters\.sites\}/);
  assert.match(dashboard, /<MultiSelectFilter label="一级仓库分类"[\s\S]*?value=\{filters\.level1WarehouseCategories\}[\s\S]*?<MultiSelectFilter label="二级仓库分类"/);
  assert.match(dashboard, /<MultiSelectFilter label="二级仓库分类"[\s\S]*?value=\{filters\.level2WarehouseCategories\}/);
  assert.doesNotMatch(dashboard, /<MultiSelectFilter label="交货状态"/);
  assert.doesNotMatch(dashboard, /<MultiSelectFilter label="销量等级"/);
  assert.doesNotMatch(dashboard, /<MultiSelectFilter label="销售额等级"/);
  assert.match(dashboard, /inventorySourceDetailMatches/);
  assert.match(client, /data-series-label=\{item\.label\}/);
  assert.match(dashboard, /inventory-detail-table\$\{showSourceWarehouses \? ' show-source-warehouses' : ''\}/);
  assert.match(client, /inventory-source-warehouse-cell/);
  assert.match(styles, /--inventory-source-warehouse-width:\s*clamp\(/);
  assert.match(styles, /\.inventory-detail-table\.show-source-warehouses th:nth-child\(1\)/);
  assert.match(styles, /\.inventory-source-warehouse-cell span[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(client, /installGlobalFetchProgress\(\)/);
  assert.match(client, /<GlobalLoadingProgress state=\{globalLoading\}/);
  assert.match(loadingProgress, /Math\.min\(90, progress \+ increment\)/);
  assert.match(loadingProgress, /progress = 100/);
  assert.match(styles, /\.global-loading-progress-track/);
  assert.match(styles, /\.inventory-business-group:nth-child\(even\)/);
  assert.match(styles, /\.inventory-business-group:not\(:last-child\)::after/);
  assert.match(styles, /content:\s*attr\(data-series-label\)/);
  assert.match(styles, /\.inventory-composition-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(920px, 5fr\) minmax\(560px, 3fr\)/);
  assert.match(styles, /\.inventory-composition-row\s*\{[\s\S]*?overflow-x:\s*auto/);
});

test('销售与库存看板展示仅数量的来源校准和遗漏重叠提醒', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
  const reconciliation = client.slice(
    client.indexOf('function InventoryQuantityReconciliation('),
    client.indexOf('function InventorySummary(')
  );

  assert.match(reconciliation, /库存数量校准/);
  assert.match(reconciliation, /遗漏/);
  assert.match(reconciliation, /重叠/);
  assert.match(reconciliation, /来源计算量/);
  assert.match(reconciliation, /看板展示量/);
  assert.match(reconciliation, /仅校验数量/);
  assert.doesNotMatch(reconciliation, /货值|金额|元/);
  assert.match(client, /function InventoryManualReconciliation/);
  assert.match(client, /const \[category, setCategory\] = useState\('成品'\)/);
  assert.match(client, /<h2>与手工表库存核对<\/h2>/);
  assert.match(client, /手工库存核对加载失败/);
  assert.match(client, /data\?\.manualReconciliation/);
  assert.match(client, /\/api\/inventory-summary\/manual-reconciliation\?category=/);
  assert.match(client, /\/api\/inventory-summary\/manual-reconciliation\/note/);
  assert.match(client, /const \[pageSize, setPageSize\] = useState\(50\)/);
  assert.match(client, /\[20, 50, 100, 200\]/);
  assert.match(client, /<th>备注<\/th>/);
  assert.match(client, /备注: noteDrafts/);
  assert.match(client, /<InventoryManualReconciliation[\s\S]*?token=\{token\}/);
  assert.match(client, /系统在库量/);
  assert.match(client, /手工在途量/);
  assert.match(client, /是否有差异/);
  assert.match(client, /来源差异明细/);
  assert.match(client, /writeStyledExcelFile/);
  assert.match(client, /库存计算口径<\/button>[\s\S]*?与手工表库存核对<\/button>/);
  assert.match(client, /showManualReconciliation[\s\S]*?<InventoryManualReconciliation/);
  assert.match(styles, /\.inventory-quantity-reconciliation\.warning/);
  assert.match(styles, /\.inventory-reconciliation-table/);
  assert.match(styles, /\.inventory-dashboard-entry-actions/);
  assert.match(styles, /\.inventory-reconciliation-entry/);
  assert.match(styles, /\.inventory-manual-filters\s*\{[\s\S]*?display:\s*flex;[\s\S]*?gap:\s*6px;/);
  assert.match(styles, /\.inventory-manual-note-editor/);
  assert.match(styles, /\.inventory-manual-page-size/);
});

test('库存数据提供独立的底表文件和手工表库', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server', 'app.js'), 'utf8');

  assert.match(client, /inventorySummaryLibrary: '底表文件'/);
  assert.match(client, /inventoryManualLibrary: '手工表库'/);
  assert.match(client, /const INVENTORY_MANUAL_SLOT_ORDER = \[1, 2, 3, 4, 5, 6, 7, 14, 17, 8, 9, 10, 11, 12, 13, 15, 16, 18, 19, 20\]/);
  assert.match(client, /const INVENTORY_MANUAL_LIBRARY_SLOTS = INVENTORY_MANUAL_SLOT_ORDER\.map/);
  assert.match(client, /replace\('inventorySummaryFile', 'inventoryManualFile'\)/);
  assert.match(client, /slot\.id === 'inventorySummaryFile17'[\s\S]*?\? 'WFS在途手工'/);
  assert.match(client, /slot\.id === 'inventorySummaryFile14'[\s\S]*?\? '京东在途手工'/);
  assert.match(client, /slot\.id === 'inventorySummaryFile8'[\s\S]*?\? '不可售手工'/);
  assert.match(server, /DIMENSION_SLOTS\.inventoryManualFile8 = '不可售手工'/);
  assert.match(server, /for \(let slotNumber = 10; slotNumber <= 20; slotNumber \+= 1\)[\s\S]*?DIMENSION_SLOTS\[`inventoryManualFile\$\{slotNumber\}`\] = '备用'/);
  assert.match(server, /DIMENSION_SLOTS\.inventoryManualFile14 = '京东在途手工'/);
  assert.match(server, /DIMENSION_SLOTS\.inventoryManualFile17 = 'WFS在途手工'/);
  assert.match(client, /manualFieldSelection: true/);
  assert.match(client, /\['materialCode', '物料编码'\][\s\S]*?\['inventoryQty', '在库量'\][\s\S]*?\['transitQty', '在途量'\]/);
  assert.match(client, /requiredFields: slot\.id === 'inventorySummaryFile8'[\s\S]*?\['businessUnit', 'materialCode', 'inventoryQty', 'transitQty'\][\s\S]*?\['businessUnit', 'materialCode', 'quantity'\]/);
  assert.match(client, /请选择必选字段：\$\{missingLabels\}/);
  assert.match(client, /请手动选择标记为必选的字段；其他未选择字段按空值保存/);
  assert.match(client, /validMappingForColumns\(mapping = \{\}, columns = \[\], fields = \[\], inferMissing = true\)/);
  assert.match(client, /title="手工表库" slots=\{INVENTORY_MANUAL_LIBRARY_SLOTS\} gridColumns=\{4\}/);
  assert.match(server, /function inventoryLibraryBaseSlotId/);
  assert.match(server, /parseInventoryManualWorkbook\(inventorySummaryFile, mapping, \{ sheetName, slotId \}\)/);
  assert.match(server, /return res\.json\(await streamingWorkbookInspect\(req\.file, sheetName \|\| null\)\)/);
  assert.match(server, /serializeInventoryUpload, async \(req, res\)/);
});

test('所有文件槽位重新选择文件时强制解析并保留仍有效的字段映射', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const library = client.slice(
    client.indexOf('function DimensionLibrary('),
    client.indexOf('function TracePage(')
  );

  assert.match(library, /onClick=\{\(event\) => \{ event\.currentTarget\.value = ''; \}\}/);
  assert.match(library, /mappingPresetsRef\.current\[slot\.id\]/);
  assert.match(library, /hasMappedInventoryFields\(savedMapping, slot\.fields \|\| \[\]\)/);
  assert.match(library, /\/api\/mappings\/\$\{INVENTORY_MAPPING_PRESET_KIND\}/);
  assert.match(library, /persistInventoryMapping\(slot, nextMapping\)/);
  assert.match(library, /!slot\.manualFieldSelection && !hasSavedMapping/);
  assert.doesNotMatch(library, /slot\.manualFieldSelection \? \{\} : \(prevState\.savedMapping/);
  assert.match(library, /validMappingForColumns\(mapping, state\.columns, slot\.fields, false\)/);
  assert.match(client, /value && validColumns\.has\(value\)[\s\S]*?: '';/);
});

test('file library slots stay responsive without clipping', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

  assert.match(styles, /\.library-slot\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/);
  assert.match(styles, /\.library-slot \.mapping-grid\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@container \(max-width:\s*420px\)[\s\S]*?\.library-slot \.mapping-grid[\s\S]*?minmax\(0, 1fr\)/);
  assert.match(styles, /\.drop-zone strong\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(styles, /\.slot-info span\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(styles, /@media \(max-width:\s*1500px\)[\s\S]*?\.library-grid-four[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width:\s*1180px\)[\s\S]*?\.library-grid-four[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.sheet-selector select\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/);
});
