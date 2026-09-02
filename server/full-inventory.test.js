import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import xlsx from 'xlsx';
import {
  buildFullInventorySummary,
  inspectFullInventoryWorkbook,
  inspectOrderFulfillmentWorkbook,
  parseFullInventoryWorkbook,
  parseOrderFulfillmentWorkbook
} from './full-inventory.js';

function workbookFile() {
  const workbook = xlsx.utils.book_new();
  const finished = xlsx.utils.aoa_to_sheet([
    ['全量库存', '', '', '', '', ''],
    ['事业部', '仓库', '物料编码', 'SKU', '在库', '在途'],
    ['国内事业部', '国内成品仓', '1001.0', 'SKU-1', '10', '2'],
    ['', '', '1002', 'SKU-2', '5', '1']
  ]);
  finished['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } },
    { s: { r: 2, c: 1 }, e: { r: 3, c: 1 } }
  ];
  const returnAccessory = xlsx.utils.aoa_to_sheet([
    ['全量库存', '', '', '', '', ''],
    ['事业部', '仓库名称', '物料编码', 'SKU', '在库', '在途'],
    ['海外事业一部', '美国仓', '2001', 'SKU-3', 3, 4]
  ]);
  xlsx.utils.book_append_sheet(workbook, finished, '成品');
  xlsx.utils.book_append_sheet(workbook, returnAccessory, '退货和配件');
  return { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) };
}

function orderFulfillmentWorkbookFile() {
  const workbook = xlsx.utils.book_new();
  const columns = [
    '采购组', '采购下单人', '下单月份', 'OA备货流程号', '事业部', '运营', '采购订单号', '供应商简称',
    '产品线', '系列', '物料编码', 'SKU', '物料名称', '借调订单', '借调备注', '未交付数量',
    '已下单未备料未生产', '已备料未生产', '生产中产品', '完工未发产品', '已发货数量', '合同约定交期',
    '生产中交付时间', '未生产预计交付时间', '是否正常履约', '未履约原因', '原因详情', '备注'
  ];
  const sheet = xlsx.utils.aoa_to_sheet([
    ['订单履约明细跟进表', ...columns.slice(1).map(() => '')],
    columns,
    [
      '国内采购组', '张三', '2026/08', 'OA-001', '国内事业部', '李四', 'CGDD012345', '示例供应商',
      '护理床', 'P系列', '1001010044', 'P21', 'P21护理床', 'JD-001', '跨仓借调', 200, 0, 142,
      0, 58, 0, '2026/08/31', '2026/08/25', '2026/09/05', '否', '交期延迟', '供应商延期', '本周跟进'
    ],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
  ]);
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: columns.length - 1 } }];
  xlsx.utils.book_append_sheet(workbook, sheet, '订单履约明细');
  return { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) };
}

test('全量库存底表固定解析两个工作表和第2行表头', () => {
  const parsed = parseFullInventoryWorkbook(workbookFile());
  assert.deepEqual(parsed.selectedSheetNames, ['成品', '退货和配件']);
  assert.deepEqual(parsed.sheets.map((sheet) => sheet.headerRow), [2, 2]);
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(parsed.rows[0], {
    businessUnit: '国内事业部',
    warehouse: '国内成品仓',
    materialCode: '1001',
    sku: 'SKU-1',
    inventoryQty: 10,
    transitQty: 2,
    __sourceSheet: '成品'
  });
  assert.equal(parsed.rows[1].businessUnit, '国内事业部');
  assert.equal(parsed.rows[1].warehouse, '国内成品仓');
  assert.equal(parsed.rows[1].materialCode, '1002');
  assert.equal(parsed.rows[2].warehouse, '美国仓');
  assert.equal(parsed.rows[2].__sourceSheet, '退货和配件');
});

test('全量库存底表缺少指定工作表时拒绝应用', () => {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([[''], ['事业部']]), '成品');
  assert.throws(
    () => parseFullInventoryWorkbook({ buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) }),
    /缺少工作表：退货和配件/
  );
});

test('全量库存预览返回两个工作表和固定六列', () => {
  const inspected = inspectFullInventoryWorkbook(workbookFile());
  assert.equal(inspected.recognizedSheets, 2);
  assert.deepEqual(inspected.columns, ['事业部', '仓库', '物料编码', 'SKU', '在库', '在途']);
  assert.equal(inspected.rowCount, 3);
  assert.equal(inspected.totalRowCount, 3);
  assert.deepEqual(inspected.sheetPreviews.map(({ sheetName, rowCount }) => ({ sheetName, rowCount })), [
    { sheetName: '成品', rowCount: 2 },
    { sheetName: '退货和配件', rowCount: 1 }
  ]);
});

test('订单履约表按第2行28列表头解析并移除原始行', () => {
  const parsed = parseOrderFulfillmentWorkbook(orderFulfillmentWorkbookFile());
  assert.deepEqual(parsed.selectedSheetNames, ['订单履约明细']);
  assert.equal(parsed.sheets[0].headerRow, 2);
  assert.equal(parsed.sheets[0].columns.length, 28);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].orderNo, 'CGDD012345');
  assert.equal(parsed.rows[0].materialCode, '1001010044');
  assert.equal(parsed.rows[0].borrowOrder, 'JD-001');
  assert.equal(parsed.rows[0].borrowRemark, '跨仓借调');
  assert.equal(parsed.rows[0].month, '2026-08');
  assert.equal(parsed.rows[0].manualRemainingQty, 200);
  assert.equal(parsed.rows[0].preparedNotStartedQty, 142);
  assert.equal(parsed.rows[0].finishedQty, 58);
  assert.equal(parsed.rows[0].fulfillmentStatus, '否');
  assert.equal(parsed.rows[0].unfulfilledReason, '交期延迟');
  assert.equal(parsed.rows[0].sourceContractDeliveryDate, '2026-08-31');
  assert.equal(Object.hasOwn(parsed.rows[0], 'raw'), false);
});

test('订单履约表预览返回结构化字段和首个工作表', () => {
  const inspected = inspectOrderFulfillmentWorkbook(orderFulfillmentWorkbookFile());
  assert.equal(inspected.recognizedSheets, 1);
  assert.equal(inspected.rowCount, 1);
  assert.equal(inspected.totalRowCount, 1);
  assert.equal(inspected.sheetNames[0], '订单履约明细');
  assert.ok(inspected.columns.includes('采购订单号'));
  assert.ok(inspected.columns.includes('未履约原因'));
});

test('全量库存汇总按工作表及事业部+物料编码聚合', () => {
  const result = buildFullInventorySummary({
    inventoryRows: [
      { __sourceSheet: '成品', businessUnit: '国内事业部', materialCode: '1001.0', sku: 'SKU-1', inventoryQty: '10', transitQty: '2' },
      { __sourceSheet: '成品', businessUnit: '国内事业部', materialCode: '1001', sku: '', inventoryQty: 5, transitQty: 1 },
      { __sourceSheet: '退货和配件', businessUnit: '海外事业一部', materialCode: '2001', sku: 'SKU-2', inventoryQty: 3, transitQty: 4 }
    ],
    productRows: [
      { materialCode: '1001.0', productLine: '护理床', productSeries: 'P系列' }
    ],
    salesRows: [
      { date: '2026-02-05', businessUnit: '国内事业部', materialCode: '1001', salesQty: 4 },
      { date: '2026/01/20', businessUnit: '国内事业部', materialCode: '1001.0', salesQty: 3 },
      { date: '2026年03月', businessUnit: '海外事业一部', materialCode: '2001', salesQty: 6 }
    ],
    undeliveredRows: [
      { business_unit: '国内事业部', material_code: '1001.0', undelivered_qty: 8 }
    ],
    updatedAt: '2026-08-19 08:00:00'
  });

  assert.deepEqual(result.months, ['2026-01', '2026-02', '2026-03']);
  assert.equal(result.updatedAt, '2026-08-19 08:00:00');
  assert.deepEqual(result.groups.map(({ key, label }) => ({ key, label })), [
    { key: 'finished', label: '成品' },
    { key: 'returnAccessory', label: '退货和配件' },
    { key: 'undelivered', label: '未交付' }
  ]);
  assert.deepEqual(result.groups[0].rows[0], {
    businessUnit: '国内事业部',
    warehouse: '',
    materialCode: '1001',
    sku: 'SKU-1',
    productLine: '护理床',
    productSeries: 'P系列',
    inventoryQty: 15,
    transitQty: 3,
    undeliveredQty: 8,
    salesByMonth: { '2026-01': 3, '2026-02': 4 }
  });
  assert.equal(result.groups[1].rows[0].productLine, '');
  assert.equal(result.groups[1].rows[0].undeliveredQty, 0);
  assert.deepEqual(result.groups[1].rows[0].salesByMonth, { '2026-03': 6 });
  assert.deepEqual(result.groups[2].rows[0], {
    businessUnit: '国内事业部',
    materialCode: '1001',
    sku: '',
    productLine: '护理床',
    productSeries: 'P系列',
    inventoryQty: 0,
    transitQty: 0,
    undeliveredQty: 8,
    salesByMonth: { '2026-01': 3, '2026-02': 4 }
  });
});

test('全量库存汇总按仓库拆分相同事业部和物料编码', () => {
  const result = buildFullInventorySummary({
    inventoryRows: [
      { __sourceSheet: '成品', businessUnit: '国内事业部', warehouse: '仓库A', materialCode: '1001', inventoryQty: 1, transitQty: 2 },
      { __sourceSheet: '成品', businessUnit: '国内事业部', warehouse: '仓库B', materialCode: '1001', inventoryQty: 3, transitQty: 4 },
      { __sourceSheet: '成品', businessUnit: '国内事业部', warehouse: '仓库A', materialCode: '1001', inventoryQty: 5, transitQty: 6 }
    ]
  });

  assert.deepEqual(result.groups[0].rows.map(({ warehouse, inventoryQty, transitQty }) => ({
    warehouse,
    inventoryQty,
    transitQty
  })), [
    { warehouse: '仓库A', inventoryQty: 6, transitQty: 8 },
    { warehouse: '仓库B', inventoryQty: 3, transitQty: 4 }
  ]);
});

test('服务端注册全量库存页面、槽位、权限和汇总接口', () => {
  const source = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  assert.match(source, /fullInventorySummary:\s*'全量库存汇总'/);
  assert.match(source, /fullInventoryLibrary:\s*'全量库存底表'/);
  assert.match(source, /fullInventoryFile1:\s*'全量库存底表'/);
  assert.match(source, /fullInventoryFile2:\s*'订单履约表'/);
  assert.match(source, /slotId\.startsWith\('fullInventoryFile'\)/);
  assert.match(source, /app\.get\('\/api\/full-inventory-summary', requireAuth, requirePage\('fullInventorySummary'\)/);
  assert.match(source, /slotId === 'fullInventoryFile1'[\s\S]*inspectFullInventoryWorkbook\(file\)/);
  assert.match(source, /slotId === 'fullInventoryFile2'[\s\S]*inspectOrderFulfillmentWorkbook\(file\)/);
  assert.match(source, /slot_id = 'fullInventoryFile2' AND applied = 1/);
  assert.match(source, /summary\.groups\.find\(\(group\) => group\.key === 'undelivered'\)/);
  const permissionMentions = source.match(/'fullInventoryLibrary'/g) || [];
  assert.ok(permissionMentions.length >= 6, '页面全集、审计映射和4个文件接口都应注册权限');
});

test('前端注册全量库存分组、汇总页和免映射底表页', () => {
  const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const pageSource = fs.readFileSync(new URL('../src/FullInventorySummaryPage.jsx', import.meta.url), 'utf8');
  assert.match(appSource, /title: '全量库存', pages: \['fullInventorySummary', 'fullInventoryLibrary'\]/);
  assert.match(appSource, /fullInventoryFile1', title: '全量库存底表', fields: \[\], fullInventory: true/);
  assert.match(appSource, /fullInventoryFile2', title: '订单履约表', fields: \[\], fullInventory: true/);
  assert.match(appSource, /slot\.firstMile \|\| slot\.fullInventory/g);
  assert.match(appSource, /!slot\.firstMile && !slot\.fullInventory && !slot\.productProjectWorkbook/);
  assert.match(appSource, /<FullInventorySummaryPage token=\{token\} active=\{activeTab === 'fullInventorySummary'\}/);
  assert.match(pageSource, /GET|api\/full-inventory-summary/);
  const inventoryColumnsSource = pageSource.match(/const INVENTORY_COLUMNS = \[([\s\S]*?)\n\];/)?.[1] || '';
  assert.match(inventoryColumnsSource, /inventoryQty/);
  assert.match(inventoryColumnsSource, /transitQty/);
  assert.match(inventoryColumnsSource, /warehouse/);
  assert.doesNotMatch(inventoryColumnsSource, /undeliveredQty|_sales/);
  assert.doesNotMatch(pageSource, /SALES_MONTH_OPTIONS|salesTotalForMonths|销量月份|销量口径/);
  assert.match(pageSource, /const FULFILLMENT_COLUMNS = \[/);
  assert.match(pageSource, /currentGroup\.key === 'undelivered'/);
  assert.match(pageSource, /colSpan=\{columns\.length\}/);
  assert.match(pageSource, /writeStyledExcelFile/);
});
