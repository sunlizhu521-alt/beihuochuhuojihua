import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import initSqlJs from 'sql.js';
import xlsx from 'xlsx';
import {
  buildInventoryDimensionDiagnostics,
  buildInventoryQuantityReconciliation,
  buildInventorySummaryModel,
  parseInventoryManualWorkbook,
  parseInventorySummaryWorkbook
} from './inventory-summary.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = '2026-07-20 15:00:00';

function aggregateDemandRows(rows, demandKey) {
  const matchingRows = rows.filter((row) => row.demandKey === demandKey);
  if (!matchingRows.length) return null;
  const aggregate = { ...matchingRows[0] };
  [
    'remainingInboundQty', 'operationStockQty', 'totalInboundQty', 'trackingOrderQty',
    'trackingInboundQty', 'currentOrderQty', 'totalPurchaseQty', 'unpreparedQty',
    'preparedNotStartedQty', 'inProductionQty', 'finishedQty', 'shippedQty',
    'progressTotal', 'gap', 'stockQty', 'demandAfterStock', 'shortageAfterStock',
    'normalFulfillmentQty', 'abnormalFulfillmentQty'
  ].forEach((field) => {
    aggregate[field] = matchingRows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
  });
  return aggregate;
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForServer(url, child, logs) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited early.\n${logs.join('')}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The child process may still be initializing sql.js.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready.\n${logs.join('')}`);
}

test('手工库存表按物料编码保存标准数量或不可售在库在途数量', () => {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([
    ['自定义事业部列', '自定义物料列', '自定义数量列', '自定义在途列'],
    ['海外事业一部', 1002010248, 25, 6]
  ]), '手工表');
  const file = { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) };

  const partial = parseInventoryManualWorkbook(file, {
    businessUnit: '自定义事业部列',
    materialCode: '自定义物料列',
    quantity: '自定义数量列'
  });
  assert.equal(partial.rows.length, 1);
  assert.deepEqual(partial.rows[0], {
    businessUnit: '海外事业一部',
    materialCode: '1002010248',
    quantity: 25
  });
  assert.throws(
    () => parseInventoryManualWorkbook(file, {}),
    /请选择必选字段：事业部、物料编码、数量/
  );
  assert.equal(Object.hasOwn(partial.rows[0], 'sku'), false);
  assert.equal(Object.hasOwn(partial.rows[0], 'endingInventoryQty'), false);

  const unsellable = parseInventoryManualWorkbook(file, {
    businessUnit: '自定义事业部列',
    materialCode: '自定义物料列',
    inventoryQty: '自定义数量列',
    transitQty: '自定义在途列'
  }, { slotId: 'inventoryManualFile8' });
  assert.deepEqual(unsellable.rows[0], {
    businessUnit: '海外事业一部',
    materialCode: '1002010248',
    inventoryQty: 25,
    transitQty: 6
  });
  assert.equal(unsellable.mapping.__inventoryManual.schemaType, 'unsellable');
});

test('inventory summary model uses inventory library facts, layered totals and stable ABC classes', () => {
  const rowsBySlot = new Map([
    ['productCategory', [
      { materialCode: 'M1', sku: 'SKU-1', materialName: 'Material One', productLine: 'Line A', productSeries: 'Series A', model: 'Model One', pretaxPrice: '10' },
      { materialCode: 'M2', sku: 'SKU-2', materialName: 'Material Two', productLine: 'Line B', productSeries: 'Series B', pretaxPrice: '20' },
      { materialCode: 'M3', sku: 'SKU-3', materialName: 'Material Three', productLine: 'Line A', productSeries: 'Series C', pretaxPrice: '15' },
      { materialCode: 'M4', sku: 'SKU-4', materialName: 'Material Four', productLine: 'Line A', productSeries: 'Series C', pretaxPrice: '15' }
    ]],
    ['spare1', [
      { subject: '主体一', warehouseName: 'FBA金蝶仓', marketplace: '美国', warehouseLocation: '海外在库', level2WarehouseCategory: '平台仓' },
      { subject: '主体一', warehouseName: 'FBA在途金蝶仓', marketplace: '美国', warehouseLocation: '海外在途', level2WarehouseCategory: '平台在途' },
      { subject: '主体一', warehouseName: 'FBM仓', marketplace: '美国', warehouseLocation: '海外在库', level2WarehouseCategory: '海外仓' },
      { subject: '主体一', warehouseName: 'WFS仓', marketplace: '美国', warehouseLocation: '海外在库', level2WarehouseCategory: '平台仓' },
      { subject: '主体一', warehouseName: '102-US-海外二部-海上在途', marketplace: '美国', warehouseLocation: '海外在途', level2WarehouseCategory: '海外在途' },
      { subject: '国内主体', warehouseName: '国内仓', marketplace: '中国', warehouseLocation: '国内在库', level2WarehouseCategory: '国内仓' }
    ]],
    ['warehouseMaterialMap', [
      { subject: '主体一', warehouseName: 'FBA金蝶仓', materialCode: 'M1', businessUnit: '跨境事业部' },
      { subject: '主体一', warehouseName: 'FBM仓', materialCode: 'M1', businessUnit: '跨境事业部' },
      { subject: '主体一', warehouseName: 'WFS仓', materialCode: 'M1', businessUnit: '跨境事业部' },
      { subject: '主体一', warehouseName: 'FBA在途金蝶仓', materialCode: 'M1', businessUnit: '跨境事业部' },
      { subject: '主体一', warehouseName: '102-US-海外二部-海上在途', materialCode: 'M1', businessUnit: '跨境事业部' },
      { subject: '国内主体', warehouseName: '国内仓', materialCode: 'M2', businessUnit: '国内事业部' }
    ]],
    ['inventorySummaryFile1', [
      { sku: 'SKU-1', warehouseName: 'FBA源仓', inventoryAttribute: '全部', endingInventoryQty: '1,000' },
      { sku: 'SKU-1', warehouseName: 'FBA源仓', inventoryAttribute: '可售', endingInventoryQty: '9,999' }
    ]],
    ['inventorySummaryFile2', [{ identifier: 'M1', warehouseName: 'FBM仓', actualTotalQty: '200' }]],
    ['inventorySummaryFile3', [{ sku: 'SKU-1', warehouseName: 'WFS源仓', totalInventoryQty: '300' }]],
    ['inventorySummaryFile4', [
      { storeName: '店铺一', sku: 'SKU-1', shipmentStatus: 'SHIPPED', dispatchQty: '600', shippedQty: '500', signedQty: '100' },
      { storeName: '店铺一', sku: 'SKU-1', shipmentStatus: 'SHIPPED', dispatchQty: '0', shippedQty: '900', signedQty: '0' },
      { storeName: '店铺一', sku: 'SKU-1', shipmentStatus: 'CANCELLED', dispatchQty: '100', shippedQty: '100', signedQty: '0' }
    ]],
    ['inventorySummaryFile5', [{
      sku: 'SKU-1',
      warehouseName: '102-US-海外二部-海上在途',
      documentStatus: '待收货',
      stockupQty: '200',
      receivedQty: '50'
    }]],
    ['inventorySummaryFile17', [{ sku: 'SKU-1', warehouseName: 'WFS源仓', wfsTransitQty: '25' }]],
    ['inventorySummaryFile6', [
      { subject: '国内主体', warehouseName: '国内仓', materialCode: 'M2', domesticStockQty: '50' },
      { subject: '主体一', warehouseName: 'FBM仓', materialCode: 'M1', domesticStockQty: '700' }
    ]],
    ['inventorySummaryFile7', [{ jdId: 'JD-1', jdStockQty: '30' }]],
    ['inventorySummaryFile8', [
      { date: '2026-01-15', businessUnit: '跨境事业部', materialCode: 'M1', salesQty: '80', salesAmount: '8,000' },
      { date: '2026/02/15', businessUnit: '跨境事业部', materialCode: 'M1', salesQty: '20', salesAmount: '2,000' },
      { date: '2026-02-16', businessUnit: '跨境事业部', materialCode: 'M3', salesQty: '10', salesAmount: '1,000' },
      { date: '2026-02-17', businessUnit: '跨境事业部', materialCode: 'M4', salesQty: '10', salesAmount: '1,000' }
    ]],
    ['inventorySummaryFile9', [
      { subject: '主体一', lingxingWarehouseName: 'FBA源仓', kingdeeWarehouseName: 'FBA金蝶仓' },
      { subject: '主体一', lingxingWarehouseName: 'WFS源仓', kingdeeWarehouseName: 'WFS仓' }
    ]],
    ['inventorySummaryFile10', [
      { lingxingSku: 'SKU-1', identifier: 'M1' },
      { lingxingSku: 'SKU-3', identifier: 'M3' },
      { lingxingSku: 'SKU-4', identifier: 'M4' }
    ]],
    ['inventorySummaryFile11', [{ jdId: 'JD-1', materialCode: 'M2' }]],
    ['inventorySummaryFile12', [
      {
        month: '2026年2月', businessUnit: '跨境事业部', materialCode: 'M1', remainingQty: '50',
        finishedQty: '10', unpreparedQty: '15', preparedNotStartedQty: '5', inProductionQty: '20',
        deliveryStatus: '是', supplierShortName: '供应商甲&供应商乙&供应商甲', unfulfilledReason: '', reasonDetail: '材料延迟', remark: ''
      },
      {
        month: '2026-02', businessUnit: '国内事业部', materialCode: 'M2', remainingQty: '20',
        finishedQty: '2', unpreparedQty: '3', preparedNotStartedQty: '4', inProductionQty: '11',
        deliveryStatus: '否', unfulfilledReason: '供应商延期', reasonDetail: '', remark: '重点跟进'
      }
    ]],
    ['inventorySummaryFile13', [{ subject: '主体一', storeName: '店铺一', kingdeeWarehouseName: 'FBA在途金蝶仓' }]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: '2026-07-30 12:00:00' })
  });
  assert.deepEqual(result.在库量, { 国内: 80, 跨境: 1500, 合计: 1580 });
  assert.equal(result.在途量, 575);
  assert.equal(result.在制量, 70);
  assert.equal(result.totals.inventoryValue, 16600);
  assert.equal(result.totals.transitValue, 5750);
  assert.equal(result.totals.unfulfilledValue, 900);
  assert.equal(result.totals.scaleQty, 2225);
  assert.deepEqual(result.months, ['2026-01', '2026-02']);
  const crossBorderM1 = result.rows.find((row) => row.matchKey === '跨境事业部+M1');
  assert.deepEqual({
    fba: crossBorderM1?.fbaInventoryQty,
    fbm: crossBorderM1?.fbmInventoryQty,
    wfs: crossBorderM1?.wfsInventoryQty,
    fbaTransit: crossBorderM1?.fbaTransitQty,
    fbmTransit: crossBorderM1?.fbmTransitQty,
    wfsTransit: crossBorderM1?.wfsTransitQty,
    salesQty: crossBorderM1?.salesQty,
    salesAmount: crossBorderM1?.salesAmount,
    january: crossBorderM1?.salesByMonth['2026-01'],
    february: crossBorderM1?.salesByMonth['2026-02'],
    quantityAbc: crossBorderM1?.quantityAbc,
    amountAbc: crossBorderM1?.amountAbc,
    model: crossBorderM1?.model,
    deliveryStatus: crossBorderM1?.deliveryStatus,
    supplierShortName: crossBorderM1?.unfulfilledSupplierShortName
  }, {
    fba: 1000,
    fbm: 200,
    wfs: 300,
    fbaTransit: 400,
    fbmTransit: 150,
    wfsTransit: 25,
    salesQty: 100,
    salesAmount: 10000,
    january: 80,
    february: 20,
    quantityAbc: 'B',
    amountAbc: 'B',
    model: 'Model One',
    deliveryStatus: '是',
    supplierShortName: '供应商甲&供应商乙'
  });
  assert.equal(
    result.rows.filter((row) => ['M3', 'M4'].includes(row.materialCode)).every((row) => row.quantityAbc === 'C'),
    true
  );
  assert.deepEqual(crossBorderM1?.unfulfilledReasons, [{ name: '未填写', qty: 50, value: 500 }]);
  assert.deepEqual(result.quantityReconciliation.summary, {
    sourceCount: 10,
    checkedQuantity: 2225,
    missingQuantity: 0,
    overlapQuantity: 0,
    issueSourceCount: 0,
    unappliedSourceCount: 0
  });
  assert.deepEqual(
    result.quantityReconciliation.groups.map((row) => ({
      group: row.group,
      expectedQuantity: row.expectedQuantity,
      dashboardQuantity: row.dashboardQuantity,
      status: row.status
    })),
    [
      { group: '在库', expectedQuantity: 1580, dashboardQuantity: 1580, status: '校准通过' },
      { group: '在途', expectedQuantity: 575, dashboardQuantity: 575, status: '校准通过' },
      { group: '未交付', expectedQuantity: 70, dashboardQuantity: 70, status: '校准通过' }
    ]
  );
  assert.equal(result.quantityReconciliation.sources.every((row) => row.status === '校准通过'), true);
  assert.deepEqual(
    crossBorderM1?.inventorySourceDetails.map((item) => ({
      sourceTable: item.sourceTable,
      sourceWarehouseName: item.sourceWarehouseName,
      receivingWarehouseName: item.receivingWarehouseName,
      mappedWarehouseName: item.mappedWarehouseName,
      storeName: item.storeName
    })),
    [
      { sourceTable: 'FBA库存报表', sourceWarehouseName: 'FBA源仓', receivingWarehouseName: '', mappedWarehouseName: 'FBA金蝶仓', storeName: '' },
      { sourceTable: 'FBA在途报表', sourceWarehouseName: '', receivingWarehouseName: '', mappedWarehouseName: 'FBA在途金蝶仓', storeName: '店铺一' },
      { sourceTable: 'FBM库存报表', sourceWarehouseName: 'FBM仓', receivingWarehouseName: '', mappedWarehouseName: 'FBM仓', storeName: '' },
      { sourceTable: 'FBM在途报表', sourceWarehouseName: '102-US-海外二部-海上在途', receivingWarehouseName: '', mappedWarehouseName: '102-US-海外二部-海上在途', storeName: '' },
      { sourceTable: 'WFS库存报表', sourceWarehouseName: 'WFS源仓', receivingWarehouseName: '', mappedWarehouseName: 'WFS仓', storeName: '' },
      { sourceTable: 'WFS在途报表', sourceWarehouseName: 'WFS源仓', receivingWarehouseName: '', mappedWarehouseName: 'WFS仓', storeName: '' }
    ]
  );
  assert.equal(crossBorderM1?.inventorySourceDetails.every((item) => item.site === '美国'), true);
  assert.deepEqual(
    [...new Set(crossBorderM1?.inventorySourceDetails.map((item) => item.warehouseLocation))].sort(),
    ['海外在库', '海外在途']
  );
  assert.deepEqual(
    [...new Set(crossBorderM1?.inventorySourceDetails.map((item) => item.level2WarehouseCategory))].sort(),
    ['平台仓', '平台在途', '海外仓', '海外在途']
  );
  assert.equal(
    crossBorderM1?.inventorySourceDetails.reduce((sum, item) => sum + Number(item.fbaInventoryQty || 0), 0),
    crossBorderM1?.fbaInventoryQty
  );
});

test('FBM transit uses the receiving warehouse to assign business unit', () => {
  const rowsBySlot = new Map([
    ['productCategory', [{
      materialCode: '1002030089',
      sku: 'V55-10AH-E',
      materialName: 'V55',
      productLine: '电动轮椅',
      productSeries: 'V55',
      pretaxPrice: '10'
    }]],
    ['inventorySummaryFile10', [{ lingxingSku: 'V55-10AH-E', identifier: '1002030089' }]],
    ['spare1', [
      { subject: '海上在途主体', warehouseName: '101-G海外一部供应商仓跨境医疗器械' },
      { subject: '杭州国源养老科技有限公司', warehouseName: '101-G-海外一部-德国东荣仓-国源欧洲' }
    ]],
    ['warehouseMaterialMap', [
      {
        subject: '海上在途主体',
        warehouseName: '101-G海外一部供应商仓跨境医疗器械',
        materialCode: '1002030089',
        businessUnit: '错误事业部'
      },
      {
        subject: '杭州国源养老科技有限公司',
        warehouseName: '101-G-海外一部-德国东荣仓-国源欧洲',
        materialCode: '1002030089',
        businessUnit: '海外事业一部'
      }
    ]],
    ['inventorySummaryFile5', [{
      sku: 'V55-10AH-E',
      warehouseName: '101-G海外一部供应商仓跨境医疗器械',
      receivingWarehouseName: '101-G-海外一部-德国东荣仓-国源欧洲',
      documentStatus: '待收货',
      stockupQty: '20',
      receivedQty: '0'
    }]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });

  const row = result.rows.find((item) => item.materialCode === '1002030089');
  assert.equal(row?.businessUnit, '海外事业一部');
  assert.equal(row?.fbmTransitQty, 20);
  assert.equal(row?.inventorySourceDetails[0]?.receivingWarehouseName, '101-G-海外一部-德国东荣仓-国源欧洲');
  assert.equal(row?.inventorySourceDetails[0]?.mappedWarehouseName, '101-G-海外一部-德国东荣仓-国源欧洲');
  assert.equal(result.rows.some((item) => item.businessUnit === '错误事业部'), false);
});

test('manual inventory reconciliation compares business unit and material by category and source', () => {
  const rowsBySlot = new Map([
    ['productCategory', [
      { materialCode: 'M1', sku: 'SKU-1', materialName: '成品一', productLine: '产品线A', productSeries: '系列A', productType: '全新品', pretaxPrice: '10' },
      { materialCode: 'M2', sku: 'SKU-2', materialName: '配件一', productLine: '其他/配件', productSeries: '系列B', productType: '其他/配件', pretaxPrice: '5' },
      { materialCode: 'M3', sku: 'SKU-3', materialName: '不可售成品', productLine: '产品线A', productSeries: '系列A', productType: '全新品', pretaxPrice: '8' }
    ]],
    ['spare1', [
      { subject: '主体一', warehouseName: 'FBM仓' },
      { subject: '主体一', warehouseName: 'FBM仓二' },
      { subject: '主体一', warehouseName: 'FBM仓三' },
      { subject: '主体一', warehouseName: '555-G/退货仓' },
      { subject: '主体一', warehouseName: '102-US-海外二部-海上在途' }
    ]],
    ['warehouseMaterialMap', [
      { subject: '主体一', warehouseName: 'FBA金蝶仓', materialCode: 'M1', businessUnit: '事业部A' },
      { subject: '主体一', warehouseName: 'FBM仓', materialCode: 'M2', businessUnit: '事业部A' },
      { subject: '主体一', warehouseName: 'FBM仓二', materialCode: 'M2', businessUnit: '事业部A' },
      { subject: '主体一', warehouseName: 'FBM仓三', materialCode: 'M2', businessUnit: '事业部A' },
      { subject: '主体一', warehouseName: '555-G/退货仓', materialCode: 'M3', businessUnit: '事业部A' },
      { subject: '主体一', warehouseName: '102-US-海外二部-海上在途', materialCode: 'M1', businessUnit: '事业部A' }
    ]],
    ['inventorySummaryFile1', [{ sku: 'SKU-1', warehouseName: 'FBA源仓', inventoryAttribute: '全部', endingInventoryQty: '10.04' }]],
    ['inventorySummaryFile2', [
      { identifier: 'M2', warehouseName: 'FBM仓', actualTotalQty: '5' },
      { identifier: 'M2', warehouseName: 'FBM仓二', actualTotalQty: '6' },
      { identifier: 'M3', warehouseName: '555-G/退货仓', actualTotalQty: '3' }
    ]],
    ['inventorySummaryFile5', [{ sku: 'SKU-1', warehouseName: '102-US-海外二部-海上在途', documentStatus: '待收货', stockupQty: '4', receivedQty: '0' }]],
    ['inventorySummaryFile9', [{ subject: '主体一', lingxingWarehouseName: 'FBA源仓', kingdeeWarehouseName: 'FBA金蝶仓' }]],
    ['inventorySummaryFile10', [{ lingxingSku: 'SKU-1', identifier: 'M1' }]],
    ['inventoryManualFile1', [{ businessUnit: '事业部A', warehouseName: 'FBA金蝶仓', subject: '', materialCode: 'M1', quantity: '10.0' }]],
    ['inventoryManualFile2', [
      { businessUnit: '事业部A', warehouseName: 'FBM仓', subject: '主体一', materialCode: 'M2', quantity: '4' },
      { businessUnit: '事业部A', warehouseName: 'FBM仓三', subject: '主体一', materialCode: 'M2', quantity: '2' }
    ]],
    ['inventoryManualFile5', [{ businessUnit: '事业部A', warehouseName: '102-US-海外二部-海上在途', subject: '主体一', materialCode: 'M1', quantity: '2' }]],
    ['inventoryManualFile8', [{ businessUnit: '事业部A', warehouseName: '555-G/退货仓', subject: '主体一', materialCode: 'M3', inventoryQty: '3', transitQty: '0' }]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: '2026-08-04 12:00:00' })
  });
  const m1 = result.manualReconciliation.rows.find((row) => row.materialCode === 'M1');
  const m2 = result.manualReconciliation.rows.find((row) => row.materialCode === 'M2');
  const m3 = result.manualReconciliation.rows.find((row) => row.materialCode === 'M3');
  assert.equal(m1.categories['成品'].inventory.status, '无差异');
  const m1FbaSources = m1.categories['成品'].sources.filter((row) => row.sourceType === 'FBA库存');
  assert.equal(m1FbaSources.length, 1);
  assert.deepEqual({
    systemQty: m1FbaSources[0].systemQty,
    manualQty: m1FbaSources[0].manualQty,
    status: m1FbaSources[0].status,
    systemSubject: m1FbaSources[0].systemSubject,
    manualSubject: m1FbaSources[0].manualSubject
  }, { systemQty: 10, manualQty: 10, status: '无差异', systemSubject: '主体一', manualSubject: '' });
  assert.equal(m1.categories['成品'].transit.differenceQty, 2);
  assert.equal(m1.categories['成品'].status, '有差异');
  assert.equal(m2.categories['配件'].inventory.differenceQty, 5);
  const m2FbmSources = m2.categories['配件'].sources.filter((row) => row.sourceType === 'FBM库存');
  assert.deepEqual(m2FbmSources.map((row) => ({
    systemWarehouse: row.systemWarehouse,
    manualWarehouse: row.manualWarehouse,
    systemQty: row.systemQty,
    manualQty: row.manualQty,
    differenceQty: row.differenceQty,
    status: row.status,
    reason: row.reason
  })), [
    { systemWarehouse: 'FBM仓', manualWarehouse: 'FBM仓', systemQty: 5, manualQty: 4, differenceQty: 1, status: '有差异', reason: '仓库数量不一致' },
    { systemWarehouse: 'FBM仓二', manualWarehouse: '', systemQty: 6, manualQty: 0, differenceQty: 6, status: '有差异', reason: '手工表缺少该仓库物料' },
    { systemWarehouse: '', manualWarehouse: 'FBM仓三', systemQty: 0, manualQty: 2, differenceQty: -2, status: '有差异', reason: '系统底表未计入该仓库物料' }
  ]);
  assert.equal(m3.categories['不可售'].inventory.status, '无差异');
  assert.equal(result.manualReconciliation.summaryByCategory['全部'].systemInventoryQty, 24);
  assert.equal(result.manualReconciliation.summaryByCategory['全部'].manualInventoryQty, 19);
  assert.equal(result.manualReconciliation.unavailableFiles.length, 0);
});

test('manual inventory reconciliation uses the mapped system warehouse and treats equal warehouse totals as no difference', () => {
  const rowsBySlot = new Map([
    ['productCategory', [{ materialCode: 'M1', sku: 'SKU-1', materialName: '成品一', productLine: '产品线A', productSeries: '系列A', productType: '全新品', pretaxPrice: '10' }]],
    ['warehouseMaterialMap', [{ subject: '主体一', warehouseName: '欧洲共享仓', materialCode: 'M1', businessUnit: '事业部A' }]],
    ['inventorySummaryFile1', [
      { sku: 'SKU-1', warehouseName: '德国源仓', inventoryAttribute: '全部', endingInventoryQty: '269' },
      { sku: 'SKU-1', warehouseName: '法国源仓', inventoryAttribute: '全部', endingInventoryQty: '58' }
    ]],
    ['inventorySummaryFile9', [
      { subject: '主体一', lingxingWarehouseName: '德国源仓', kingdeeWarehouseName: '欧洲共享仓' },
      { subject: '主体一', lingxingWarehouseName: '法国源仓', kingdeeWarehouseName: '欧洲共享仓' }
    ]],
    ['inventorySummaryFile10', [{ lingxingSku: 'SKU-1', identifier: 'M1' }]],
    ['inventoryManualFile1', [
      { businessUnit: '事业部A', warehouseName: '欧洲共享仓', subject: '主体一', materialCode: 'M1', quantity: '327' }
    ]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: '2026-08-05 12:00:00' })
  });
  const comparison = result.manualReconciliation.rows.find((row) => row.materialCode === 'M1')?.categories['成品'];
  const fbaRows = comparison.sources.filter((row) => row.sourceType === 'FBA库存');
  assert.deepEqual({
    inventoryStatus: comparison.inventory.status,
    overallStatus: comparison.status,
    reason: comparison.reason,
    systemQty: comparison.inventory.systemQty,
    manualQty: comparison.inventory.manualQty,
    differenceQty: comparison.inventory.differenceQty,
    sourceDifferenceTotal: fbaRows.reduce((sum, row) => sum + row.differenceQty, 0)
  }, {
    inventoryStatus: '无差异',
    overallStatus: '无差异',
    reason: '无差异',
    systemQty: 327,
    manualQty: 327,
    differenceQty: 0,
    sourceDifferenceTotal: 0
  });
  assert.equal(fbaRows.length, 1);
  assert.equal(fbaRows[0].systemWarehouse, '德国源仓 & 法国源仓');
  assert.equal(fbaRows[0].systemMappedWarehouse, '欧洲共享仓');
  assert.equal(fbaRows[0].manualWarehouse, '欧洲共享仓');
  assert.equal(fbaRows[0].status, '无差异');
  assert.equal(fbaRows[0].reason, '无差异');
});

test('manual inventory reconciliation ignores warehouse differences when business material metric totals match', () => {
  const rowsBySlot = new Map([
    ['productCategory', [{ materialCode: 'M1', sku: 'SKU-1', materialName: '成品一', productLine: '产品线A', productSeries: '系列A', productType: '全新品', pretaxPrice: '10' }]],
    ['warehouseMaterialMap', [{ subject: '主体一', warehouseName: '系统金蝶仓', materialCode: 'M1', businessUnit: '事业部A' }]],
    ['inventorySummaryFile1', [{ sku: 'SKU-1', warehouseName: '系统源仓', inventoryAttribute: '全部', endingInventoryQty: '10' }]],
    ['inventorySummaryFile9', [{ subject: '主体一', lingxingWarehouseName: '系统源仓', kingdeeWarehouseName: '系统金蝶仓' }]],
    ['inventorySummaryFile10', [{ lingxingSku: 'SKU-1', identifier: 'M1' }]],
    ['inventoryManualFile1', [{ businessUnit: '事业部A', warehouseName: '手工仓', subject: '主体一', materialCode: 'M1', quantity: '10' }]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: '2026-08-05 12:00:00' })
  });
  const comparison = result.manualReconciliation.rows.find((row) => row.materialCode === 'M1')?.categories['成品'];
  const fbaRows = comparison.sources.filter((row) => row.sourceType === 'FBA库存');
  assert.equal(comparison.inventory.systemQty, 10);
  assert.equal(comparison.inventory.manualQty, 10);
  assert.equal(comparison.inventory.differenceQty, 0);
  assert.equal(comparison.inventory.status, '无差异');
  assert.equal(comparison.status, '无差异');
  assert.equal(comparison.reason, '无差异');
  assert.equal(fbaRows.length, 2);
  assert.ok(fbaRows.every((row) => row.status === '无差异'));
  assert.ok(fbaRows.every((row) => row.reason === '无差异'));
  assert.equal(result.manualReconciliation.summaryByCategory['成品'].issueCount, 0);
  assert.equal(result.manualReconciliation.summaryByCategory['成品'].matchedCount, 1);
});

test('manual inventory reconciliation marks an unapplied side as unavailable instead of zero difference', () => {
  const rowsBySlot = new Map([
    ['productCategory', [{ materialCode: 'M1', sku: 'SKU-1', materialName: '成品一', productLine: '产品线A', productSeries: '系列A', pretaxPrice: '10' }]],
    ['warehouseMaterialMap', [{ subject: '主体一', warehouseName: 'FBA金蝶仓', materialCode: 'M1', businessUnit: '事业部A' }]],
    ['inventorySummaryFile1', [{ sku: 'SKU-1', warehouseName: 'FBA源仓', inventoryAttribute: '全部', endingInventoryQty: '10' }]],
    ['inventorySummaryFile9', [{ subject: '主体一', lingxingWarehouseName: 'FBA源仓', kingdeeWarehouseName: 'FBA金蝶仓' }]],
    ['inventorySummaryFile10', [{ lingxingSku: 'SKU-1', identifier: 'M1' }]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({
      rows: rowsBySlot.get(slotId) || [],
      updatedAt: slotId === 'inventoryManualFile1' ? '' : '2026-08-04 12:00:00'
    })
  });
  const m1 = result.manualReconciliation.rows.find((row) => row.materialCode === 'M1');
  assert.equal(m1.categories['成品'].inventory.status, '无法核对：手工表未应用');
  assert.equal(m1.categories['成品'].status, '无法核对');
  assert.ok(result.manualReconciliation.unavailableFiles.some((row) => row.slotId === 'inventoryManualFile1'));
});

test('manual inventory reconciliation indexes production-scale facts and supports one-category responses', () => {
  const rowCount = 2500;
  const products = Array.from({ length: rowCount }, (_, index) => ({
    materialCode: `M${index}`,
    sku: `SKU-${index}`,
    materialName: `物料${index}`,
    productLine: '产品线A',
    productSeries: '系列A',
    productType: '全新品'
  }));
  const rowsBySlot = new Map([
    ['productCategory', products],
    ['warehouseMaterialMap', products.map((row) => ({ subject: '主体一', warehouseName: 'FBA金蝶仓', materialCode: row.materialCode, businessUnit: '事业部A' }))],
    ['inventorySummaryFile1', products.map((row) => ({ sku: row.sku, warehouseName: 'FBA源仓', inventoryAttribute: '全部', endingInventoryQty: '1' }))],
    ['inventorySummaryFile9', [{ subject: '主体一', lingxingWarehouseName: 'FBA源仓', kingdeeWarehouseName: 'FBA金蝶仓' }]],
    ['inventorySummaryFile10', products.map((row) => ({ lingxingSku: row.sku, identifier: row.materialCode }))],
    ['inventoryManualFile1', products.map((row) => ({ businessUnit: '事业部A', warehouseName: 'FBA金蝶仓', subject: '主体一', materialCode: row.materialCode, quantity: '1' }))]
  ]);
  const startedAt = performance.now();
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now }),
    manualReconciliationCategories: ['成品']
  });
  const elapsedMs = performance.now() - startedAt;
  assert.equal(result.manualReconciliation.rows.length, rowCount);
  assert.deepEqual(Object.keys(result.manualReconciliation.summaryByCategory), ['成品']);
  assert.equal(result.manualReconciliation.summaryByCategory['成品'].systemInventoryQty, rowCount);
  assert.equal(result.manualReconciliation.summaryByCategory['成品'].manualInventoryQty, rowCount);
  assert.ok(elapsedMs < 6000, `indexed reconciliation took ${Math.round(elapsedMs)}ms`);
});

test('quantity reconciliation reports missing and overlapping quantities independently', () => {
  const source = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [
    `inventorySummaryFile${index + 1}`,
    { updatedAt: now }
  ]));
  const result = buildInventoryQuantityReconciliation({
    source,
    facts: [
      { sourceType: 'FBA库存', expectedQuantity: 100, countedQuantity: 70, countedTimes: 1 },
      { sourceType: 'FBM库存', expectedQuantity: 50, countedQuantity: 100, countedTimes: 2 }
    ],
    totals: {
      fbaInventoryQty: 70,
      fbmInventoryQty: 100,
      inventoryQty: 170,
      transitQty: 0,
      unfulfilledQty: 0
    }
  });
  assert.equal(result.status, 'warning');
  assert.equal(result.summary.missingQuantity, 30);
  assert.equal(result.summary.overlapQuantity, 50);
  assert.equal(result.sources.find((row) => row.sourceType === 'FBA库存')?.status, '数量遗漏');
  assert.equal(result.sources.find((row) => row.sourceType === 'FBM库存')?.status, '数量重叠');
  assert.deepEqual(
    result.groups.find((row) => row.group === '在库'),
    {
      group: '在库',
      expectedQuantity: 150,
      dashboardQuantity: 170,
      differenceQuantity: 20,
      missingQuantity: 0,
      overlapQuantity: 20,
      status: '数量重叠'
    }
  );
});

test('inventory summary separates unsellable warehouse stock without losing normal stock', () => {
  const rowsBySlot = new Map([
    ['productCategory', [
      {
        materialCode: 'M1', sku: 'SKU-1', materialName: 'Finished Product', productLine: 'Line A',
        productSeries: 'Series A', productType: '全新品', pretaxPrice: '10'
      },
      {
        materialCode: 'M2', sku: 'RE-SKU-2', materialName: 'Spare Part', productLine: '其他/配件',
        productSeries: 'Series B', productType: '其他/配件', pretaxPrice: '20'
      },
      {
        materialCode: 'M3', sku: 'K1-SKU-3', materialName: 'Finished Return', productLine: 'Line A',
        productSeries: 'Series C', productType: '全新品', pretaxPrice: '30'
      },
      {
        materialCode: '1007010626', sku: 'Z11-A-RE-2.2', materialName: 'Return Warehouse Product', productLine: 'Line A',
        productSeries: 'Series Z11', productType: '全新品', pretaxPrice: '10'
      }
    ]],
    ['spare1', [
      '555-G/退货仓/瑞朗德仓/医疗器械/国内&跨境',
      '555-O/退货仓/瑞朗德仓/医疗器械/国内&跨境',
      '555-X/原始退货仓',
      '777-M/售后配件仓/瑞朗德仓/医疗器械/国内&跨境',
      '777-R/售后配件仓/瑞朗德仓/医疗器械/国内',
      '333-M/不可售仓/杭州',
      '（杭州）电子成品仓',
      '888-G-采购成品仓虚拟仓-跨境医疗器械',
      '888-US-采购成品仓虚拟仓-跨境医疗器械',
      '采购配件仓',
      '塑件车间仓库',
      '综合线组装仓库',
      '001-M/国内事业部/瑞朗德仓/京东商家云仓',
      '001-M/待（退货）仓/瑞朗德仓/国内医疗器械',
      '浙江仓（退货）',
      '101-US-海外一部-美国自营仓（退货）',
      '海外023临时仓',
      '106-G-国内事业部-海上在途',
      '正常仓'
    ].map((warehouseName) => ({ subject: '主体一', warehouseName, marketplace: '中国' }))],
    ['warehouseMaterialMap', [
      ...[
        '555-M/退货仓/瑞朗德仓/医疗器械/国内&跨境',
        '555-G/退货仓/瑞朗德仓/医疗器械/国内&跨境',
        '555-O/退货仓/瑞朗德仓/医疗器械/国内&跨境',
        '777-M/售后配件仓/瑞朗德仓/医疗器械/国内&跨境',
        '777-R/售后配件仓/瑞朗德仓/医疗器械/国内',
        '333-M/不可售仓/杭州',
        '（杭州）电子成品仓',
        '888-G-采购成品仓虚拟仓-跨境医疗器械',
        '888-US-采购成品仓虚拟仓-跨境医疗器械',
        '采购配件仓',
        '塑件车间仓库',
        '综合线组装仓库',
        '001-M/国内事业部/瑞朗德仓/京东商家云仓',
        '001-M/待（退货）仓/瑞朗德仓/国内医疗器械',
        '浙江仓（退货）',
        '海外023临时仓',
        '106-G-国内事业部-海上在途',
        '正常仓'
      ].map((warehouseName) => ({
        subject: '主体一', warehouseName, materialCode: 'M1', businessUnit: '国内事业部'
      })),
      {
        subject: '主体一', warehouseName: '555-G/退货仓/瑞朗德仓/医疗器械/国内&跨境',
        materialCode: 'M2', businessUnit: '国内事业部'
      },
      {
        subject: '主体一', warehouseName: '777-M/售后配件仓/瑞朗德仓/医疗器械/国内&跨境',
        materialCode: 'M2', businessUnit: '国内事业部'
      },
      {
        subject: '主体一', warehouseName: '浙江仓（退货）',
        materialCode: 'M2', businessUnit: '国内事业部'
      },
      {
        subject: '主体一', warehouseName: '浙江仓（退货）',
        materialCode: 'M3', businessUnit: '国内事业部'
      },
      {
        subject: '主体一', warehouseName: '101-US-海外一部-美国自营仓（退货）',
        materialCode: '1007010626', businessUnit: '海外事业一部'
      },
      {
        subject: '主体一', warehouseName: '海外023临时仓',
        materialCode: 'M2', businessUnit: '国内事业部'
      },
      {
        subject: '主体一', warehouseName: '001-M/国内事业部/瑞朗德仓/京东商家云仓',
        materialCode: 'M2', businessUnit: '国内事业部'
      }
    ]],
    ['inventorySummaryFile1', [
      { sku: 'SKU-1', warehouseName: 'FBA-555', inventoryAttribute: '全部', endingInventoryQty: '10' },
      { sku: 'SKU-2', warehouseName: 'FBA-555-PART', inventoryAttribute: '全部', endingInventoryQty: '5' },
      { sku: 'SKU-2', warehouseName: 'FBA-NORMAL-TO-023', inventoryAttribute: '全部', endingInventoryQty: '16' }
    ]],
    ['inventorySummaryFile2', [
      { identifier: 'M1', warehouseName: '777-M/售后配件仓/瑞朗德仓/医疗器械/国内&跨境', actualTotalQty: '20' },
      { identifier: 'M1', warehouseName: '浙江仓（退货）', actualTotalQty: '7' },
      { identifier: 'M2', warehouseName: '777-M/售后配件仓/瑞朗德仓/医疗器械/国内&跨境', actualTotalQty: '6' },
      { identifier: 'M2', warehouseName: '浙江仓（退货）', actualTotalQty: '12' },
      { identifier: 'M2', warehouseName: '海外023临时仓', actualTotalQty: '15' },
      { identifier: 'M1', warehouseName: '333-M/不可售仓/杭州', actualTotalQty: '9' },
      { identifier: 'M1', warehouseName: '（杭州）电子成品仓', actualTotalQty: '11' },
      { identifier: 'M1', warehouseName: '888-G-采购成品仓虚拟仓-跨境医疗器械', actualTotalQty: '3' },
      { identifier: 'M1', warehouseName: '888-US-采购成品仓虚拟仓-跨境医疗器械', actualTotalQty: '2' },
      { identifier: 'M1', warehouseName: '采购配件仓', actualTotalQty: '4' },
      { identifier: 'M1', warehouseName: '塑件车间仓库', actualTotalQty: '5' },
      { identifier: 'M1', warehouseName: '综合线组装仓库', actualTotalQty: '6' },
      { identifier: 'M3', warehouseName: '浙江仓（退货）', actualTotalQty: '13' },
      { identifier: '1007010626', warehouseName: '101-US-海外一部-美国自营仓（退货）', actualTotalQty: '6' }
    ]],
    ['inventorySummaryFile3', [
      { sku: 'SKU-1', warehouseName: 'WFS-RETURN', totalInventoryQty: '30' },
      { sku: 'SKU-2', warehouseName: 'WFS-PART', totalInventoryQty: '7' }
    ]],
    ['inventorySummaryFile6', [
      { subject: '主体一', warehouseName: '555-G/退货仓/瑞朗德仓/医疗器械/国内&跨境', materialCode: 'M1', domesticStockQty: '1' },
      { subject: '主体一', warehouseName: '555-O/退货仓/瑞朗德仓/医疗器械/国内&跨境', materialCode: 'M1', domesticStockQty: '2' },
      { subject: '主体一', warehouseName: '777-R/售后配件仓/瑞朗德仓/医疗器械/国内', materialCode: 'M1', domesticStockQty: '3' },
      { subject: '主体一', warehouseName: '001-M/待（退货）仓/瑞朗德仓/国内医疗器械', materialCode: 'M1', domesticStockQty: '4' },
      { subject: '未维护主体', warehouseName: '555-X/原始退货仓', materialCode: 'M1', domesticStockQty: '5' },
      { subject: '主体一', warehouseName: '正常仓', materialCode: 'M1', domesticStockQty: '40' },
      { subject: '主体一', warehouseName: '777-M/售后配件仓/瑞朗德仓/医疗器械/国内&跨境', materialCode: 'M2', domesticStockQty: '8' },
      { subject: '主体一', warehouseName: '001-M/国内事业部/瑞朗德仓/京东商家云仓', materialCode: 'M2', domesticStockQty: '14' }
    ]],
    ['inventorySummaryFile5', [{
      sku: 'SKU-1', warehouseName: '106-G-国内事业部-海上在途', receivingWarehouseName: '777-M/售后配件仓',
      documentStatus: '待收货', stockupQty: '10', receivedQty: '2'
    }]],
    ['inventorySummaryFile7', [{ jdId: 'JD-1', jdStockQty: '50' }]],
    ['inventorySummaryFile9', [
      { subject: '主体一', lingxingWarehouseName: 'FBA-555', kingdeeWarehouseName: '555-M/退货仓/瑞朗德仓/医疗器械/国内&跨境' },
      { subject: '主体一', lingxingWarehouseName: 'FBA-555-PART', kingdeeWarehouseName: '555-G/退货仓/瑞朗德仓/医疗器械/国内&跨境' },
      { subject: '主体一', lingxingWarehouseName: 'FBA-NORMAL-TO-023', kingdeeWarehouseName: '海外023临时仓' },
      { subject: '主体一', lingxingWarehouseName: 'WFS-RETURN', kingdeeWarehouseName: '001-M/待（退货）仓/瑞朗德仓/国内医疗器械' },
      { subject: '主体一', lingxingWarehouseName: 'WFS-PART', kingdeeWarehouseName: '777-M/售后配件仓/瑞朗德仓/医疗器械/国内&跨境' }
    ]],
    ['inventorySummaryFile10', [
      { lingxingSku: 'SKU-1', identifier: 'M1' },
      { lingxingSku: 'SKU-2', identifier: 'M2' }
    ]],
    ['inventorySummaryFile11', [{ jdId: 'JD-1', materialCode: 'M1' }]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  const finished = result.rows.find((row) => row.matchKey === '国内事业部+M1');
  const sparePart = result.rows.find((row) => row.matchKey === '国内事业部+M2');
  const k1Finished = result.rows.find((row) => row.matchKey === '国内事业部+M3');
  const embeddedReReturn = result.rows.find((row) => row.matchKey === '海外事业一部+1007010626');
  const unsellableSegments = finished?.inventorySegmentBreakdown.filter((row) => row.productType === '不可售') || [];
  const unsellableTotal = (field) => unsellableSegments.reduce((sum, row) => sum + Number(row[field] || 0), 0);
  const finishedSegments = finished?.inventorySegmentBreakdown.filter((row) => row.productType === '成品') || [];
  const segmentedQty = finished?.inventorySegmentBreakdown.reduce((sum, row) => (
    sum + Number(row.fbaInventoryQty || 0)
    + Number(row.fbmInventoryQty || 0)
    + Number(row.wfsInventoryQty || 0)
    + Number(row.domesticMainInventoryQty || 0)
    + Number(row.jdInventoryQty || 0)
  ), 0);

  assert.equal(finished?.productType, '全新品');
  assert.equal(finished?.baseProductType, '成品');
  assert.equal(finished?.inventoryQty, 207);
  assert.equal(segmentedQty, finished?.inventoryQty);
  assert.deepEqual({
    fba: unsellableTotal('fbaInventoryQty'),
    fbm: unsellableTotal('fbmInventoryQty'),
    wfs: unsellableTotal('wfsInventoryQty'),
    domestic: unsellableTotal('domesticMainInventoryQty'),
    fbmTransit: unsellableTotal('fbmTransitQty')
  }, { fba: 10, fbm: 67, wfs: 30, domestic: 10, fbmTransit: 8 });
  assert.equal(finishedSegments.reduce((sum, row) => sum + Number(row.domesticMainInventoryQty || 0), 0), 40);
  assert.equal(finishedSegments.reduce((sum, row) => sum + Number(row.jdInventoryQty || 0), 0), 50);
  assert.equal(sparePart?.baseProductType, '配件');
  const sparePartUnsellable = sparePart?.inventorySegmentBreakdown.filter((row) => row.productType === '不可售') || [];
  assert.deepEqual({
    fba: sparePartUnsellable.reduce((sum, row) => sum + Number(row.fbaInventoryQty || 0), 0),
    fbm: sparePartUnsellable.reduce((sum, row) => sum + Number(row.fbmInventoryQty || 0), 0),
    wfs: sparePartUnsellable.reduce((sum, row) => sum + Number(row.wfsInventoryQty || 0), 0),
    domestic: sparePartUnsellable.reduce((sum, row) => sum + Number(row.domesticMainInventoryQty || 0), 0)
  }, { fba: 21, fbm: 21, wfs: 7, domestic: 8 });
  assert.equal(sparePart?.inventoryQty, 83);
  assert.equal(
    sparePart?.inventorySegmentBreakdown
      .filter((row) => row.productType === '成品')
      .reduce((sum, row) => sum + Number(row.fbmInventoryQty || 0), 0),
    12
  );
  assert.equal(
    sparePart?.inventorySegmentBreakdown
      .filter((row) => row.productType === '成品')
      .reduce((sum, row) => sum + Number(row.domesticMainInventoryQty || 0), 0),
    14
  );
  assert.equal(sparePart?.inventorySegmentBreakdown.some((row) => row.productType === '配件'), false);
  assert.equal(k1Finished?.inventoryQty, 13);
  assert.equal(k1Finished?.inventorySegmentBreakdown[0]?.productType, '成品');
  assert.equal(k1Finished?.inventorySegmentBreakdown.some((row) => row.productType === '不可售'), false);
  assert.equal(embeddedReReturn?.sku, 'Z11-A-RE-2.2');
  assert.equal(embeddedReReturn?.inventoryQty, 6);
  assert.equal(embeddedReReturn?.inventorySegmentBreakdown[0]?.productType, '不可售');
  assert.equal(embeddedReReturn?.inventorySegmentBreakdown.some((row) => row.productType === '成品'), false);
});

test('销售区域异常按物料去重，无法区分和2B区域不报错', () => {
  const rowsBySlot = new Map([
    ['productCategory', [
      { materialCode: 'M-US', sku: 'SKU-US', salesRegion: '美国', pretaxPrice: 10 },
      { materialCode: 'M-B2B', sku: 'SKU-B2B', salesRegion: '沙特', pretaxPrice: 10 },
      { materialCode: 'M-IGNORED', sku: 'SKU-IGNORED', salesRegion: '无法区分', pretaxPrice: 10 },
      { materialCode: 'M-MISSING', sku: 'SKU-MISSING', salesRegion: '海外', pretaxPrice: 10 },
      { materialCode: 'M-EUROPE', sku: 'SKU-EUROPE', salesRegion: '欧美', pretaxPrice: 10 },
      { materialCode: 'M-ZERO', sku: 'SKU-ZERO', salesRegion: '', pretaxPrice: 10 }
    ]],
    ['inventorySummaryFile8', [
      { date: '2026-06', businessUnit: '海外事业一部', materialCode: 'M-ZERO', salesQty: 10, salesAmount: 100 }
    ]],
    ['inventorySummaryFile12', [
      { businessUnit: '海外事业一部', materialCode: 'M-US', remainingQty: 5, deliveryStatus: '是' },
      { businessUnit: '全球招商事业部', materialCode: 'M-B2B', remainingQty: 6, deliveryStatus: '是' },
      { businessUnit: '海外事业一部', materialCode: 'M-IGNORED', remainingQty: 4, deliveryStatus: '是' },
      { businessUnit: '海外事业二部', materialCode: 'M-MISSING', remainingQty: 7, deliveryStatus: '是' },
      { businessUnit: '全球招商事业部', materialCode: 'M-MISSING', remainingQty: 3, deliveryStatus: '是' },
      { businessUnit: '海外事业一部', materialCode: 'M-EUROPE', remainingQty: 8, deliveryStatus: '是' }
    ]]
  ]);
  const model = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  assert.equal(model.rows.find((row) => row.materialCode === 'M-US')?.salesRegion, '美国');
  assert.equal(model.rows.find((row) => row.materialCode === 'M-B2B')?.salesRegion, '沙特');
  const regionIssues = model.anomalies.filter((row) => row.sourceType === '供应计划分析');
  assert.equal(regionIssues.length, 3);
  assert.deepEqual(regionIssues.map((row) => ({ materialCode: row.materialCode, qty: row.qty, salesRegion: row.salesRegion })), [
    { materialCode: 'M-ZERO', qty: 0, salesRegion: '未填写' },
    { materialCode: 'M-MISSING', qty: 10, salesRegion: '海外' },
    { materialCode: 'M-EUROPE', qty: 8, salesRegion: '欧美' }
  ]);
  const diagnostics = buildInventoryDimensionDiagnostics(model);
  const issue = diagnostics.issues.find((row) => row.materialCode === 'M-MISSING');
  assert.equal(issue?.targetSlotId, 'productCategory');
  assert.equal(issue?.requiredFields.includes('销售区域'), true);
  assert.equal(issue?.salesRegion, '海外');
  assert.equal(issue?.businessUnit, '不适用');
  assert.equal(issue?.sourceKey, 'M-MISSING');
  const zeroImpactIssue = diagnostics.issues.find((row) => row.materialCode === 'M-ZERO');
  assert.equal(zeroImpactIssue?.salesRegion, '未填写');
  assert.equal(zeroImpactIssue?.qty, 0);
  assert.equal(diagnostics.issues.some((row) => row.materialCode === 'M-B2B'), false);
  assert.equal(diagnostics.issues.some((row) => row.materialCode === 'M-IGNORED'), false);
});

test('FBM inventory ignores zero quantities and excluded warehouse rows before mapping and aggregation', () => {
  const rowsBySlot = new Map([
    ['inventorySummaryFile2', [
      { identifier: 'M-ZERO-1', warehouseName: 'Unknown Warehouse', actualTotalQty: '0' },
      { identifier: 'M-ZERO-2', warehouseName: 'Unknown Warehouse', actualTotalQty: '0.0' },
      { identifier: 'M-ZERO-3', warehouseName: 'Unknown Warehouse', actualTotalQty: '-0' },
      { identifier: 'M-DEFAULT', warehouseName: ' 默认 仓库 ', actualTotalQty: '999' },
      { identifier: 'M-TRANSIT', warehouseName: 'US-FBA移除中转虚拟仓', actualTotalQty: '888' },
      { identifier: 'M-TEST', warehouseName: '虚拟仓库--仅用于测试', actualTotalQty: '777' }
    ]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.anomalies.length, 0);
  assert.equal(result.totals.fbmInventoryQty || 0, 0);
  assert.equal(result.totals.fbmInventoryValue || 0, 0);
});

test('FBM inventory keeps nonzero blank identifiers unmatched and routes them to the source report', () => {
  const rowsBySlot = new Map([
    ['spare1', [{ subject: '主体一', warehouseName: 'FBM仓' }]],
    ['warehouseMaterialMap', [{ subject: '主体一', warehouseName: 'FBM仓', materialCode: '', businessUnit: '海外事业二部' }]],
    ['inventorySummaryFile2', [{
      storeName: '店铺一',
      marketplace: '美国',
      identifier: '',
      warehouseName: 'FBM仓',
      actualTotalQty: '1,009'
    }]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  const unmatched = result.rows.find((row) => row.productLine === '未匹配');
  assert.equal(result.totals.fbmInventoryQty, 1009);
  assert.equal(unmatched?.fbmInventoryQty, 1009);
  assert.equal(unmatched?.issues.includes('识别码为空'), true);

  const diagnostics = buildInventoryDimensionDiagnostics(result);
  const sourceIssue = diagnostics.issues.find((row) => row.issueCode === '识别码为空');
  assert.deepEqual({
    targetSlotId: sourceIssue?.targetSlotId,
    targetTitle: sourceIssue?.targetTitle,
    maintainPage: sourceIssue?.maintainPage,
    issueStatus: sourceIssue?.issueStatus,
    missingKey: sourceIssue?.missingKey,
    requiredFields: sourceIssue?.requiredFields,
    qty: sourceIssue?.qty
  }, {
    targetSlotId: 'inventorySummaryFile2',
    targetTitle: 'FBM库存报表',
    maintainPage: 'inventorySummaryLibrary',
    issueStatus: '源字段缺失',
    missingKey: '店铺一 + 美国 + FBM仓',
    requiredFields: ['识别码'],
    qty: 1009
  });
  assert.equal(diagnostics.tasks.find((row) => row.targetSlotId === 'inventorySummaryFile2')?.affectedQty, 1009);
});

test('domestic inventory excludes JD central and outbound-goods warehouses before aggregation and diagnostics', () => {
  const rowsBySlot = new Map([
    ['productCategory', [
      { materialCode: 'M-KEEP', sku: 'SKU-KEEP', materialName: 'Kept material', productLine: 'Line A', productSeries: 'Series A', pretaxPrice: '10' }
    ]],
    ['warehouseMaterialMap', [
      { subject: 'Domestic Subject', warehouseName: 'Regular Warehouse', materialCode: 'M-KEEP', businessUnit: '国内事业部' }
    ]],
    ['spare1', [
      { subject: 'Domestic Subject', warehouseName: 'Regular Warehouse', marketplace: '中国' }
    ]],
    ['inventorySummaryFile6', [
      { subject: 'Domestic Subject', warehouseName: '999-M/国内事业部/京东总仓/国内医疗器械', materialCode: 'M-JD', domesticStockQty: '100' },
      { subject: 'Domestic Subject', warehouseName: '001-M/国内事业部/发出商品仓/天猫', materialCode: 'M-OUTBOUND', domesticStockQty: '200' },
      { subject: 'Domestic Subject', warehouseName: 'Regular Warehouse', materialCode: 'M-KEEP', domesticStockQty: '30' }
    ]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  assert.equal(result.在库量.国内, 30);
  assert.deepEqual(result.rows.map((row) => row.materialCode), ['M-KEEP']);
  assert.equal(result.anomalies.length, 0);
  assert.equal(buildInventoryDimensionDiagnostics(result).qualitySummary.issueRows, 0);

  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rowsBySlot.get('inventorySummaryFile6')), 'Inventory');
  const parsed = parseInventorySummaryWorkbook(
    { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
    'inventorySummaryFile6',
    {
      subject: 'subject',
      warehouseName: 'warehouseName',
      materialCode: 'materialCode',
      domesticStockQty: 'domesticStockQty'
    }
  );
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].materialCode, 'M-KEEP');
  assert.equal(parsed.mapping.__inventorySummary.filteredIgnoredWarehouseRows, 2);
});

test('domestic inventory includes every mapped business unit after filtering to the China site', () => {
  const warehouseRows = [
    { subject: '主体一', warehouseName: '中国仓', marketplace: '中国' },
    { subject: '主体一', warehouseName: '中国其他事业部仓', marketplace: '中国' },
    { subject: '主体一', warehouseName: '美国仓', marketplace: '美国' },
    { subject: '主体一', warehouseName: '空站点仓', marketplace: '' },
    { subject: '主体一', warehouseName: '冲突仓', marketplace: '中国' },
    { subject: '主体二', warehouseName: '冲突仓', marketplace: '美国' }
  ];
  const facts = [
    ['M-CN', '中国仓', 10],
    ['M-OTHER', '中国其他事业部仓', 60],
    ['M-US', '美国仓', 20],
    ['M-BLANK', '空站点仓', 30],
    ['M-MISSING', '维度缺失仓', 40],
    ['M-CONFLICT', '冲突仓', 50]
  ];
  const rowsBySlot = new Map([
    ['productCategory', facts.map(([materialCode]) => ({ materialCode, sku: `SKU-${materialCode}`, materialName: materialCode, productLine: 'Line A', productSeries: 'Series A', pretaxPrice: '10' }))],
    ['spare1', warehouseRows],
    ['warehouseMaterialMap', facts.map(([materialCode, warehouseName]) => ({
      subject: '主体一',
      warehouseName,
      materialCode,
      businessUnit: materialCode === 'M-OTHER' ? '海外事业一部' : '国内事业部'
    }))],
    ['inventorySummaryFile6', facts.map(([materialCode, warehouseName, domesticStockQty]) => ({ subject: '主体一', warehouseName, materialCode, domesticStockQty }))]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  assert.equal(result.在库量.国内, 70);
  assert.deepEqual(result.rows.map((row) => [row.businessUnit, row.materialCode]), [
    ['国内事业部', 'M-CN'],
    ['海外事业一部', 'M-OTHER']
  ]);
  assert.equal(result.anomalies.length, 0);
});

test('domestic sales warehouses are assigned to sales factory without dimension mappings', () => {
  const rowsBySlot = new Map([
    ['productCategory', [
      { materialCode: 'M-R', sku: 'SKU-R', materialName: 'Sales R', productLine: 'Line A', productSeries: 'Series A', pretaxPrice: '10' },
      { materialCode: 'M-M', sku: 'SKU-M', materialName: 'Sales M', productLine: 'Line A', productSeries: 'Series A', pretaxPrice: '20' },
      { materialCode: 'M-KEEP', sku: 'SKU-KEEP', materialName: 'Domestic', productLine: 'Line A', productSeries: 'Series A', pretaxPrice: '30' }
    ]],
    ['warehouseMaterialMap', [
      { subject: 'Domestic Subject', warehouseName: 'Regular Warehouse', materialCode: 'M-KEEP', businessUnit: '国内事业部' }
    ]],
    ['spare1', [
      { subject: '河北瑞朗德医疗器械科技集团有限公司', warehouseName: '028-R/瑞朗德销售部/瑞朗德仓/国内医疗器械', marketplace: '中国' },
      { subject: '浙江迈德斯特医疗器械科技有限公司', warehouseName: '028-M/瑞朗德销售部/瑞朗德仓/国内医疗器械', marketplace: '中国' },
      { subject: 'Domestic Subject', warehouseName: 'Regular Warehouse', marketplace: '中国' }
    ]],
    ['inventorySummaryFile6', [
      { subject: '河北瑞朗德医疗器械科技集团有限公司', warehouseName: '028-R/瑞朗德销售部/瑞朗德仓/国内医疗器械', materialCode: 'M-R', domesticStockQty: '190' },
      { subject: '浙江迈德斯特医疗器械科技有限公司', warehouseName: '028-M/瑞朗德销售部/瑞朗德仓/国内医疗器械', materialCode: 'M-M', domesticStockQty: '182' },
      { subject: 'Domestic Subject', warehouseName: 'Regular Warehouse', materialCode: 'M-KEEP', domesticStockQty: '30' }
    ]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  const salesFactoryRows = result.rows.filter((row) => row.businessUnit === '销售部-工厂');
  assert.equal(salesFactoryRows.reduce((sum, row) => sum + row.domesticMainInventoryQty, 0), 372);
  assert.deepEqual(salesFactoryRows.map((row) => row.materialCode).sort(), ['M-M', 'M-R']);
  assert.equal(result.rows.find((row) => row.materialCode === 'M-KEEP')?.businessUnit, '国内事业部');
  assert.equal(result.在库量.国内, 402);
  assert.equal(result.anomalies.length, 0);
});

test('all inventory sources ignore zero quantity rows before mapping, aggregation and diagnostics', () => {
  const rowsBySlot = new Map([
    ['inventorySummaryFile1', [
      { sku: 'SKU-FBA-ZERO', warehouseName: 'Unknown FBA', inventoryAttribute: '全部', endingInventoryQty: '0' }
    ]],
    ['inventorySummaryFile2', [
      { identifier: 'M-FBM-ZERO', warehouseName: 'Unknown FBM', actualTotalQty: '0' }
    ]],
    ['inventorySummaryFile3', [
      { sku: 'SKU-WFS-ZERO', warehouseName: 'Unknown WFS', totalInventoryQty: '0.0' }
    ]],
    ['inventorySummaryFile6', [
      { subject: 'Unknown Subject', warehouseName: 'Unknown Domestic', materialCode: 'M-DOMESTIC-ZERO', domesticStockQty: '-0' }
    ]],
    ['inventorySummaryFile7', [
      { jdId: 'JD-ZERO', jdStockQty: '0' }
    ]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.anomalies.length, 0);
  assert.equal(result.totals.inventoryQty || 0, 0);
  assert.equal(result.totals.inventoryValue || 0, 0);
  const diagnostics = buildInventoryDimensionDiagnostics(result);
  assert.deepEqual(diagnostics.issues, []);
  assert.deepEqual(diagnostics.tasks, []);
  assert.deepEqual(diagnostics.qualitySummary, {
    issueRows: 0,
    affectedFacts: 0,
    affectedQty: 0,
    affectedValue: 0,
    targetCount: 0
  });
});

test('FBA and FBM transit ignore zero in-transit quantities before dimension mapping and diagnostics', () => {
  const rowsBySlot = new Map([
    ['inventorySummaryFile4', [{
      storeName: 'Unknown Store',
      sku: 'SKU-FBA-TRANSIT-ZERO',
      shipmentStatus: 'IN_TRANSIT',
      dispatchQty: '10',
      shippedQty: '10',
      signedQty: '10'
    }]],
    ['inventorySummaryFile5', [{
      sku: 'SKU-FBM-TRANSIT-ZERO',
      warehouseName: '102-US-海外二部-海上在途',
      documentStatus: '待配货',
      stockupQty: '200',
      receivedQty: '200'
    }]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.anomalies.length, 0);
  assert.equal(result.totals.transitQty || 0, 0);
  assert.equal(result.totals.transitValue || 0, 0);
  const diagnostics = buildInventoryDimensionDiagnostics(result);
  assert.deepEqual(diagnostics.issues, []);
  assert.deepEqual(diagnostics.tasks, []);
});

test('invalid inventory quantities stop before dimension mapping and maintenance diagnostics', () => {
  const rowsBySlot = new Map([
    ['inventorySummaryFile1', [
      { sku: 'SKU-FBA-INVALID', warehouseName: 'Unknown FBA', inventoryAttribute: '全部', endingInventoryQty: '' }
    ]],
    ['inventorySummaryFile2', [
      { identifier: 'M-FBM-INVALID', warehouseName: 'Unknown FBM', actualTotalQty: '--' }
    ]],
    ['inventorySummaryFile3', [
      { sku: 'SKU-WFS-INVALID', warehouseName: 'Unknown WFS', totalInventoryQty: 'invalid' }
    ]],
    ['inventorySummaryFile6', [
      { subject: 'Unknown Subject', warehouseName: 'Unknown Domestic', materialCode: 'M-DOMESTIC-INVALID', domesticStockQty: '-' }
    ]],
    ['inventorySummaryFile7', [
      { jdId: 'JD-INVALID', jdStockQty: '' }
    ]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.anomalies.length, 5);
  assert.equal(result.anomalies.every((row) => row.issue.endsWith('不是有效数量')), true);
  const diagnostics = buildInventoryDimensionDiagnostics(result);
  assert.deepEqual(diagnostics.issues, []);
  assert.deepEqual(diagnostics.tasks, []);
  assert.equal(diagnostics.qualitySummary.issueRows, 0);
  assert.equal(diagnostics.qualitySummary.affectedQty, 0);
});

test('FBM workbook parser excludes zero quantities and excluded warehouse rows from saved data', () => {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet([
    { identifier: 'M-ZERO', warehouseName: 'Warehouse A', actualTotalQty: '0' },
    { identifier: 'M-DEFAULT', warehouseName: '默认仓库', actualTotalQty: '999' },
    { identifier: 'M-TRANSIT', warehouseName: ' US-FBA移除中转虚拟仓 ', actualTotalQty: '888' },
    { identifier: 'M-TEST', warehouseName: '虚拟仓库--仅用于测试', actualTotalQty: '777' },
    { identifier: 'M-STOCK', warehouseName: 'Warehouse A', actualTotalQty: '1,250' }
  ]);
  xlsx.utils.book_append_sheet(workbook, worksheet, 'FBM');
  const parsed = parseInventorySummaryWorkbook(
    { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
    'inventorySummaryFile2',
    {
      identifier: 'identifier',
      warehouseName: 'warehouseName',
      actualTotalQty: 'actualTotalQty'
    }
  );
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].identifier, 'M-STOCK');
  assert.equal(parsed.mapping.__inventorySummary.filteredZeroQtyRows, 1);
  assert.equal(parsed.mapping.__inventorySummary.parserVersion, 4);
  assert.equal(parsed.mapping.__inventorySummary.filteredIgnoredWarehouseRows, 3);
});

test('all inventory workbook parsers exclude zero quantity rows from saved data', () => {
  const cases = [
    {
      slotId: 'inventorySummaryFile1',
      mapping: {
        sku: 'sku',
        warehouseName: 'warehouseName',
        inventoryAttribute: 'inventoryAttribute',
        endingInventoryQty: '期末库存(含移仓)-数量'
      },
      zero: { sku: 'SKU-ZERO', warehouseName: 'Warehouse', inventoryAttribute: '全部', '期末库存(含移仓)-数量': '0' },
      stock: { sku: 'SKU-STOCK', warehouseName: 'Warehouse', inventoryAttribute: '全部', '期末库存(含移仓)-数量': '10' }
    },
    {
      slotId: 'inventorySummaryFile3',
      mapping: { sku: 'sku', warehouseName: 'warehouseName', totalInventoryQty: 'totalInventoryQty' },
      zero: { sku: 'SKU-ZERO', warehouseName: 'Warehouse', totalInventoryQty: '0' },
      stock: { sku: 'SKU-STOCK', warehouseName: 'Warehouse', totalInventoryQty: '20' }
    },
    {
      slotId: 'inventorySummaryFile6',
      mapping: {
        subject: 'subject',
        warehouseName: 'warehouseName',
        materialCode: 'materialCode',
        domesticStockQty: 'domesticStockQty'
      },
      zero: { subject: 'Subject', warehouseName: 'Warehouse', materialCode: 'M-ZERO', domesticStockQty: '0' },
      stock: { subject: 'Subject', warehouseName: 'Warehouse', materialCode: 'M-STOCK', domesticStockQty: '30' }
    },
    {
      slotId: 'inventorySummaryFile7',
      mapping: { jdId: 'jdId', jdStockQty: 'jdStockQty' },
      zero: { jdId: 'JD-ZERO', jdStockQty: '0' },
      stock: { jdId: 'JD-STOCK', jdStockQty: '40' }
    },
    {
      slotId: 'inventorySummaryFile17',
      mapping: { sku: 'sku', warehouseName: 'warehouseName', wfsTransitQty: 'wfsTransitQty' },
      zero: { sku: 'SKU-ZERO', warehouseName: 'WFS Warehouse', wfsTransitQty: '0' },
      stock: { sku: 'SKU-STOCK', warehouseName: 'WFS Warehouse', wfsTransitQty: '50' }
    }
  ];
  cases.forEach(({ slotId, mapping, zero, stock }) => {
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([zero, stock]), 'Inventory');
    const parsed = parseInventorySummaryWorkbook(
      { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
      slotId,
      mapping
    );
    assert.equal(parsed.rows.length, 1, slotId);
    assert.equal(parsed.mapping.__inventorySummary.filteredZeroQtyRows, 1, slotId);
  });
});

test('JD inventory parser supports RDC national rows without double counting regional stock', () => {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
    { SKU: 'SKU-A', RDC: '全国', 现货库存: '40', 商品状态: '上柜' },
    { SKU: 'SKU-A', RDC: '广州', 现货库存: '10', 商品状态: '上柜' },
    { SKU: 'SKU-A', RDC: '上海', 现货库存: '30', 商品状态: '上柜' },
    { SKU: 'SKU-ZERO', RDC: '全国', 现货库存: '0', 商品状态: '赠品' },
    { SKU: 'SKU-ZERO', RDC: '广州', 现货库存: '0', 商品状态: '赠品' }
  ]), '原表');
  const parsed = parseInventorySummaryWorkbook(
    { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
    'inventorySummaryFile7'
  );
  assert.deepEqual(parsed.rows, [{ jdId: 'SKU-A', jdRdc: '全国', jdStockQty: '40' }]);
  assert.deepEqual(parsed.mapping.__inventorySummary, {
    ...parsed.mapping.__inventorySummary,
    parserVersion: 5,
    sourceRowCount: 5,
    rowCount: 1,
    filteredZeroQtyRows: 1,
    filteredJdRegionalRows: 3,
    jdFormat: 'RDC全国行+现货库存',
    jdScopeRows: 2,
    jdScopeQuantity: 40
  });
});

test('JD inventory parser keeps legacy national-stock format compatible', () => {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
    { SKU: 'SKU-LEGACY', 全国现货库存: '55' },
    { SKU: 'SKU-ZERO', 全国现货库存: '0' }
  ]), '原表');
  const parsed = parseInventorySummaryWorkbook(
    { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
    'inventorySummaryFile7'
  );
  assert.deepEqual(parsed.rows, [{ jdId: 'SKU-LEGACY', jdRdc: '', jdStockQty: '55' }]);
  assert.equal(parsed.mapping.__inventorySummary.jdFormat, '旧版全国现货库存列');
  assert.equal(parsed.mapping.__inventorySummary.filteredJdRegionalRows, 0);
  assert.equal(parsed.mapping.__inventorySummary.filteredZeroQtyRows, 1);
  assert.equal(parsed.mapping.__inventorySummary.jdScopeQuantity, 55);
});

test('JD inventory parser rejects invalid RDC national-row structures', () => {
  const workbookWithoutRdc = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbookWithoutRdc, xlsx.utils.json_to_sheet([
    { SKU: 'SKU-A', 现货库存: '10' }
  ]), '原表');
  assert.throws(
    () => parseInventorySummaryWorkbook(
      { buffer: xlsx.write(workbookWithoutRdc, { type: 'buffer', bookType: 'xlsx' }) },
      'inventorySummaryFile7'
    ),
    /必须包含RDC列/
  );

  const workbookWithoutNational = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbookWithoutNational, xlsx.utils.json_to_sheet([
    { SKU: 'SKU-A', RDC: '广州', 现货库存: '10' }
  ]), '原表');
  assert.throws(
    () => parseInventorySummaryWorkbook(
      { buffer: xlsx.write(workbookWithoutNational, { type: 'buffer', bookType: 'xlsx' }) },
      'inventorySummaryFile7'
    ),
    /缺少RDC=全国行：SKU-A/
  );

  const workbookWithDuplicateNational = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbookWithDuplicateNational, xlsx.utils.json_to_sheet([
    { SKU: 'SKU-A', RDC: '全国', 现货库存: '10' },
    { SKU: 'SKU-A', RDC: '全国', 现货库存: '20' }
  ]), '原表');
  assert.throws(
    () => parseInventorySummaryWorkbook(
      { buffer: xlsx.write(workbookWithDuplicateNational, { type: 'buffer', bookType: 'xlsx' }) },
      'inventorySummaryFile7'
    ),
    /RDC=全国行重复：SKU-A/
  );
});

test('JD transit workbook parser requires one sheet and preserves zero, negative and invalid quantities', () => {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
    { 物料编码: 'M-POSITIVE', 在途数量: '12' },
    { 物料编码: 'M-ZERO', 在途数量: '0' },
    { 物料编码: 'M-NEGATIVE', 在途数量: '-3' },
    { 物料编码: 'M-INVALID', 在途数量: '-' },
    { 物料编码: '合计', 在途数量: '9' }
  ]), '京东在途');
  const parsed = parseInventorySummaryWorkbook(
    { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
    'inventorySummaryFile14'
  );
  assert.deepEqual(parsed.rows, [
    { materialCode: 'M-POSITIVE', jdTransitQty: '12' },
    { materialCode: 'M-ZERO', jdTransitQty: '0' },
    { materialCode: 'M-NEGATIVE', jdTransitQty: '-3' },
    { materialCode: 'M-INVALID', jdTransitQty: '-' }
  ]);
  assert.equal(parsed.mapping.__inventorySummary.filteredZeroQtyRows, 0);
  assert.equal(parsed.mapping.__inventorySummary.filteredSummaryRows, 1);

  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([['其他']]), '多余工作表');
  assert.throws(
    () => parseInventorySummaryWorkbook(
      { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
      'inventorySummaryFile14'
    ),
    /京东在途报表应只包含一个工作表/
  );
});

test('JD transit aggregates by domestic material, retains subject layers and diagnoses zero-impact missing dimensions', () => {
  const rowsBySlot = new Map([
    ['productCategory', [{
      materialCode: 'M1',
      sku: 'SKU-1',
      materialName: 'Material One',
      productLine: 'Line A',
      productSeries: 'Series A',
      pretaxPrice: '10'
    }]],
    ['inventorySummaryFile14', [
      { materialCode: 'M1', jdTransitQty: '5' },
      { materialCode: 'M1', jdTransitQty: '-2' },
      { materialCode: 'M1', jdTransitQty: '0' },
      { materialCode: 'M1', jdTransitQty: '-' },
      { materialCode: 'M-MISSING', jdTransitQty: '4' },
      { materialCode: 'M-MISSING-ZERO', jdTransitQty: '0' }
    ]]
  ]);
  const model = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  const m1 = model.rows.find((row) => row.matchKey === '国内事业部+M1');
  assert.equal(m1?.jdTransitQty, 3);
  assert.equal(m1?.jdTransitValue, 30);
  assert.deepEqual(m1?.inventorySubjects, ['浙江迈德斯特医疗器械科技有限公司']);
  assert.deepEqual(m1?.inventorySubjectBreakdown, [{
    subject: '浙江迈德斯特医疗器械科技有限公司',
    jdTransitQty: 3,
    jdTransitValue: 30
  }]);
  assert.equal(model.在途量, 7);
  assert.equal(model.totals.jdTransitQty, 7);
  assert.equal(model.totals.jdTransitValue, 30);
  assert.equal(model.totals.transitQty, 7);
  assert.equal(model.totals.transitValue, 30);

  const diagnostics = buildInventoryDimensionDiagnostics(model);
  assert.equal(
    diagnostics.issues.some((row) => (
      row.targetSlotId === 'inventorySummaryFile14'
      && row.issueCode === '在途数量不是有效数量'
      && row.materialCode === 'M1'
    )),
    true
  );
  assert.equal(
    diagnostics.issues.some((row) => (
      row.targetSlotId === 'productCategory'
      && row.materialCode === 'M-MISSING-ZERO'
      && row.qty === 0
    )),
    true
  );
});

test('inventory summary rows are excluded during upload parsing and when reading legacy saved rows', () => {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
    { subject: 'Domestic Subject', warehouseName: 'Domestic Warehouse', materialCode: 'M-STOCK', domesticStockQty: '30' },
    { subject: '合计', warehouseName: '', materialCode: '', domesticStockQty: '12,513,828.915' }
  ]), 'Inventory');
  const parsed = parseInventorySummaryWorkbook(
    { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
    'inventorySummaryFile6',
    {
      subject: 'subject',
      warehouseName: 'warehouseName',
      materialCode: 'materialCode',
      domesticStockQty: 'domesticStockQty'
    }
  );
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].materialCode, 'M-STOCK');
  assert.equal(parsed.mapping.__inventorySummary.filteredSummaryRows, 1);

  const legacyRows = [
    { subject: '合计', warehouseName: '', materialCode: '', domesticStockQty: '12,513,828.915' }
  ];
  const model = buildInventorySummaryModel({
    getRows: () => [],
    getRecord: (slotId) => ({
      rows: slotId === 'inventorySummaryFile6' ? legacyRows : [],
      updatedAt: now
    })
  });
  assert.equal(model.rows.length, 0);
  assert.equal(model.anomalies.length, 0);
  assert.equal(model.在库量.合计, 0);
  assert.equal(buildInventoryDimensionDiagnostics(model).qualitySummary.issueRows, 0);
});

test('FBA parser locks the ending inventory field and retains every nonzero unmapped-SKU row', () => {
  const quantities = [1, 1, 1, 1, 1, 1, 1, 1, 6, 24, 146, 273, 71, 22, 3];
  const plainQuantities = [1, 39, 20, 5, 141, ...Array(10).fill(0)];
  const workbook = xlsx.utils.book_new();
  const rows = quantities.map((quantity, index) => ({
    SKU: `MISSING-SKU-${index + 1}`,
    仓库: '国源欧洲-PL波兰仓',
    库存属性: '全部',
    '期末库存-数量': plainQuantities[index],
    '期末库存(含移仓)-数量': quantity
  }));
  rows.push({
    SKU: 'MISSING-SKU-ZERO',
    仓库: '国源欧洲-PL波兰仓',
    库存属性: '全部',
    '期末库存-数量': 999,
    '期末库存(含移仓)-数量': 0
  });
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rows), '底表');

  const parsed = parseInventorySummaryWorkbook(
    { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
    'inventorySummaryFile1',
    {
      sku: 'SKU',
      warehouseName: '仓库',
      inventoryAttribute: '库存属性',
      endingInventoryQty: '期末库存(含移仓)-数量'
    }
  );

  assert.equal(parsed.mapping.endingInventoryQty, '期末库存(含移仓)-数量');
  assert.equal(parsed.rows.length, 15);
  assert.equal(parsed.rows.reduce((sum, row) => sum + Number(row.endingInventoryQty), 0), 553);
  assert.equal(parsed.mapping.__inventorySummary.filteredZeroQtyRows, 1);
  assert.equal(parsed.mapping.__inventorySummary.sourceRowCount, 16);
  assert.equal(parsed.mapping.__inventorySummary.fbaScopeRows, 15);
  assert.equal(parsed.mapping.__inventorySummary.fbaScopeQuantity, 553);
  assert.equal(parsed.mapping.__inventorySummary.fbaBlankSkuRows, 0);
  assert.equal(parsed.mapping.__inventorySummary.fbaBlankSkuQuantity, 0);

  const model = buildInventorySummaryModel({
    getRows: (slotId) => (slotId === 'inventorySummaryFile1' ? parsed.rows : []),
    getRecord: (slotId) => ({ rows: slotId === 'inventorySummaryFile1' ? parsed.rows : [], updatedAt: now })
  });
  const diagnostics = buildInventoryDimensionDiagnostics(model);
  const missingSkuIssues = diagnostics.issues.filter((row) => row.targetSlotId === 'inventorySummaryFile10');
  assert.equal(missingSkuIssues.length, 15);
  assert.equal(missingSkuIssues.reduce((sum, row) => sum + row.qty, 0), 553);
  assert.equal(diagnostics.issues.some((row) => row.qty === 0), false);
});

test('FBA parser rejects workbooks that only contain the non-transfer ending inventory field', () => {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
    { SKU: 'SKU-WRONG-FIELD', 仓库: 'Warehouse', 库存属性: '全部', '期末库存-数量': 100 }
  ]), 'FBA库存');
  assert.throws(
    () => parseInventorySummaryWorkbook(
      { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
      'inventorySummaryFile1',
      { endingInventoryQty: '期末库存-数量' }
    ),
    /缺少必填列：期末库存\(含移仓\)-数量/
  );
});

test('SKU dimension parser automatically recognizes the *SKU header', () => {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
    { '*SKU': 'SKU-STAR-1', 识别码: 'M-STAR-1' }
  ]), 'SKU映射');
  const parsed = parseInventorySummaryWorkbook(
    { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
    'inventorySummaryFile10'
  );
  assert.deepEqual(parsed.rows, [{ lingxingSku: 'SKU-STAR-1', identifier: 'M-STAR-1', remark: '' }]);
  assert.equal(parsed.mapping.lingxingSku, '*SKU');
});

test('WFS inventory resolves business unit by subject, mapped warehouse and material code', () => {
  const rowsBySlot = new Map([
    ['productCategory', [
      { materialCode: 'M-ONE', sku: 'SKU-ONE', materialName: 'Item One', productLine: 'Line', productSeries: 'Series', pretaxPrice: '10' },
      { materialCode: 'M-TWO', sku: 'SKU-TWO', materialName: 'Item Two', productLine: 'Line', productSeries: 'Series', pretaxPrice: '20' }
    ]],
    ['warehouseMaterialMap', [
      { subject: '102-G', warehouseName: '102-G/海外一部/WFS仓/国源-Walmart美国仓', materialCode: 'M-ONE', businessUnit: '海外一部' },
      { subject: '102-G', warehouseName: '102-G/海外二部/WFS仓/国源-Walmart美国仓', materialCode: 'M-TWO', businessUnit: '海外二部' }
    ]],
    ['inventorySummaryFile3', [
      { sku: 'SKU-ONE', warehouseName: '国源-Walmart美国仓', totalInventoryQty: '100' },
      { sku: 'SKU-TWO', warehouseName: '国源-Walmart美国仓', totalInventoryQty: '200' }
    ]],
    ['inventorySummaryFile9', [
      { subject: '102-G', lingxingWarehouseName: '国源-Walmart美国仓', kingdeeWarehouseName: '102-G/海外一部/WFS仓/国源-Walmart美国仓' },
      { subject: '102-G', lingxingWarehouseName: '国源-Walmart美国仓', kingdeeWarehouseName: '102-G/海外二部/WFS仓/国源-Walmart美国仓' }
    ]],
    ['inventorySummaryFile10', [
      { lingxingSku: 'SKU-ONE', identifier: 'M-ONE' },
      { lingxingSku: 'SKU-TWO', identifier: 'M-TWO' }
    ]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  const overseasOne = result.rows.find((row) => row.matchKey === '海外一部+M-ONE');
  const overseasTwo = result.rows.find((row) => row.matchKey === '海外二部+M-TWO');
  assert.equal(overseasOne?.wfsInventoryQty, 100);
  assert.equal(overseasTwo?.wfsInventoryQty, 200);
  assert.equal(result.anomalies.length, 0);
});

test('WFS inventory resolves by terminal warehouse name and material when warehouse aliases are incomplete', () => {
  const rowsBySlot = new Map([
    ['productCategory', [
      { materialCode: 'M-ONE', sku: 'SKU-ONE', materialName: 'Item One', productLine: 'Line', productSeries: 'Series', pretaxPrice: '10' },
      { materialCode: 'M-TWO', sku: 'SKU-TWO', materialName: 'Item Two', productLine: 'Line', productSeries: 'Series', pretaxPrice: '20' }
    ]],
    ['warehouseMaterialMap', [
      { subject: '杭州国源养老科技有限公司', warehouseName: '101-G/海外事业一部/WFS仓/国源-Walmart美国仓', materialCode: 'M-ONE', businessUnit: '海外事业一部' },
      { subject: '杭州国源养老科技有限公司', warehouseName: '102-G/海外事业二部/WFS仓/国源-Walmart美国仓', materialCode: 'M-TWO', businessUnit: '海外事业二部' }
    ]],
    ['inventorySummaryFile3', [
      { sku: 'SKU-ONE', warehouseName: '国源-Walmart美国仓', totalInventoryQty: '100' },
      { sku: 'SKU-TWO', warehouseName: '国源-Walmart美国仓', totalInventoryQty: '200' }
    ]],
    ['inventorySummaryFile9', [
      { subject: '杭州国源养老科技有限公司', lingxingWarehouseName: '国源-Walmart美国仓', kingdeeWarehouseName: '102-G/海外事业二部/WFS仓/国源-Walmart美国仓' }
    ]],
    ['inventorySummaryFile10', [
      { lingxingSku: 'SKU-ONE', identifier: 'M-ONE' },
      { lingxingSku: 'SKU-TWO', identifier: 'M-TWO' }
    ]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  const overseasOne = result.rows.find((row) => row.matchKey === '海外事业一部+M-ONE');
  const overseasTwo = result.rows.find((row) => row.matchKey === '海外事业二部+M-TWO');
  assert.equal(overseasOne?.wfsInventoryQty, 100);
  assert.equal(overseasTwo?.wfsInventoryQty, 200);
  assert.equal(result.anomalies.length, 0);
});

test('WFS inventory ignores warehouse dimension candidates whose composite key uses SKU instead of material code', () => {
  const rowsBySlot = new Map([
    ['productCategory', [
      { materialCode: 'M-ONE', sku: 'SKU-ONE', materialName: 'Item One', productLine: 'Line', productSeries: 'Series', pretaxPrice: '10' }
    ]],
    ['warehouseMaterialMap', [
      {
        subject: '杭州国源养老科技有限公司',
        warehouseName: '101-G/海外一部/WFS仓/国源-Walmart美国仓',
        materialCode: 'M-ONE',
        sku: 'SKU-ONE',
        businessUnit: '海外事业一部',
        raw: { '仓库名称&物料编码': '杭州国源养老科技有限公司101-G/海外一部/WFS仓/国源-Walmart美国仓M-ONE' }
      },
      {
        subject: '杭州国源养老科技有限公司',
        warehouseName: '102-G/海外二部/WFS仓/国源-Walmart美国仓',
        materialCode: 'M-ONE',
        sku: 'SKU-ONE',
        businessUnit: '海外事业二部',
        raw: { '仓库名称&物料编码': '杭州国源养老科技有限公司102-G/海外二部/WFS仓/国源-Walmart美国仓SKU-ONE' }
      }
    ]],
    ['inventorySummaryFile3', [
      { sku: 'SKU-ONE', warehouseName: '国源-Walmart美国仓', totalInventoryQty: '100' }
    ]],
    ['inventorySummaryFile10', [
      { lingxingSku: 'SKU-ONE', identifier: 'M-ONE' }
    ]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  const overseasOne = result.rows.find((row) => row.matchKey === '海外事业一部+M-ONE');
  assert.equal(overseasOne?.wfsInventoryQty, 100);
  assert.equal(result.anomalies.length, 0);
});

test('WFS inventory marks conflicting business unit mappings instead of guessing', () => {
  const rowsBySlot = new Map([
    ['productCategory', [
      { materialCode: 'M-CONFLICT', sku: 'SKU-CONFLICT', materialName: 'Conflict Item', productLine: 'Line', productSeries: 'Series', pretaxPrice: '10' }
    ]],
    ['warehouseMaterialMap', [
      { subject: '102-G', warehouseName: '102-G/海外一部/WFS仓/国源-Walmart美国仓', materialCode: 'M-CONFLICT', businessUnit: '海外一部' },
      { subject: '102-G', warehouseName: '102-G/海外二部/WFS仓/国源-Walmart美国仓', materialCode: 'M-CONFLICT', businessUnit: '海外二部' }
    ]],
    ['inventorySummaryFile3', [
      { sku: 'SKU-CONFLICT', warehouseName: '国源-Walmart美国仓', totalInventoryQty: '50' }
    ]],
    ['inventorySummaryFile9', [
      { subject: '102-G', lingxingWarehouseName: '国源-Walmart美国仓', kingdeeWarehouseName: '102-G/海外一部/WFS仓/国源-Walmart美国仓' },
      { subject: '102-G', lingxingWarehouseName: '国源-Walmart美国仓', kingdeeWarehouseName: '102-G/海外二部/WFS仓/国源-Walmart美国仓' }
    ]],
    ['inventorySummaryFile10', [
      { lingxingSku: 'SKU-CONFLICT', identifier: 'M-CONFLICT' }
    ]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  const unmatched = result.rows.find((row) => row.matchKey === '未匹配');
  assert.equal(unmatched?.wfsInventoryQty, 50);
  assert.equal(result.rows.some((row) => ['海外一部', '海外二部'].includes(row.businessUnit)), false);
  assert.equal(result.anomalies.some((row) => row.issue === '主体、仓库与物料映射冲突'), true);
});

test('warehouse level 2 category prefers column H from the original warehouse file', () => {
  const rowsBySlot = new Map([
    ['productCategory', [{
      materialCode: 'M-H',
      sku: 'SKU-H',
      materialName: 'H Column Item',
      productLine: 'Line H',
      productSeries: 'Series H',
      pretaxPrice: '10'
    }]],
    ['spare1', [{
      raw: {
        A列: '主体一',
        B列: 'WH-H',
        C列: 'FBM仓',
        D列: '海外在库',
        E列: '美国',
        F列: '一级分类',
        G列: '辅助字段',
        H列: '正确二级分类',
        I列: '三级分类'
      },
      subject: '主体一',
      warehouseName: 'FBM仓',
      marketplace: '美国',
      level1WarehouseCategory: '一级分类',
      level2WarehouseCategory: '三级分类'
    }]],
    ['warehouseMaterialMap', [{
      subject: '主体一',
      warehouseName: 'FBM仓',
      materialCode: 'M-H',
      businessUnit: '海外事业一部'
    }]],
    ['inventorySummaryFile2', [{
      identifier: 'M-H',
      warehouseName: 'FBM仓',
      actualTotalQty: '5'
    }]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  const row = result.rows.find((item) => item.materialCode === 'M-H');
  assert.equal(row?.inventorySourceDetails[0]?.level1WarehouseCategory, '一级分类');
  assert.equal(row?.inventorySourceDetails[0]?.level2WarehouseCategory, '正确二级分类');
});

test('inventory business unit mapping reads legacy raw dimensions and stays independent from product price issues', () => {
  const rowsBySlot = new Map([
    ['productCategory', [{
      raw: {
        物料编码: 'M1',
        SKU: 'SKU-1',
        金蝶名称: 'Material One',
        销售产品线: 'Line A',
        销售系列: 'Series A'
      },
      materialCode: 'M1'
    }, {
      materialCode: 'M2',
      sku: 'SKU-2',
      materialName: 'Material Two',
      productLine: 'Line B',
      productSeries: 'Series B',
      pretaxPrice: '10'
    }]],
    ['spare1', [{
      raw: { 使用组织: '主体一', 金蝶名称: 'FBM仓' },
      subject: '',
      warehouseName: 'FBM仓'
    }]],
    ['warehouseMaterialMap', [{
      raw: {
        库存组织: '主体一',
        仓库名称: 'FBM仓',
        物料编码: 'M1',
        事业部: '跨境事业部'
      },
      subject: '',
      warehouseName: '',
      materialCode: '',
      businessUnit: ''
    }, {
      raw: {
        库存组织: '主体二',
        仓库名称: 'FBA金蝶仓',
        物料编码: 'M2',
        事业部: '海外事业部'
      }
    }]],
    ['inventorySummaryFile1', [{
      sku: 'SKU-2',
      warehouseName: 'FBA源仓',
      inventoryAttribute: '全部',
      endingInventoryQty: '7'
    }]],
    ['inventorySummaryFile2', [{
      identifier: 'M1',
      warehouseName: 'FBM仓',
      actualTotalQty: '5'
    }]],
    ['inventorySummaryFile9', [{
      raw: {
        主体: '主体二',
        仓库: 'FBA源仓',
        金蝶仓库: 'FBA金蝶仓'
      },
      lingxingWarehouseName: '',
      kingdeeWarehouseName: ''
    }]],
    ['inventorySummaryFile10', [{ lingxingSku: 'SKU-2', identifier: 'M2' }]]
  ]);
  const result = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: '2026-07-30 14:00:00' })
  });
  assert.equal(result.rows.length, 2);
  const legacyGeneralWarehouseRow = result.rows.find((row) => row.fbmInventoryQty === 5);
  assert.equal(legacyGeneralWarehouseRow?.businessUnit, '跨境事业部');
  assert.equal(legacyGeneralWarehouseRow?.materialCode, '未匹配');
  assert.equal(legacyGeneralWarehouseRow?.fbmInventoryValue, 0);
  assert.equal(legacyGeneralWarehouseRow?.mappingStatus, '映射冲突');
  assert.deepEqual(legacyGeneralWarehouseRow?.issues, ['不含税结算价缺失或无效']);
  const legacyFbaWarehouseRow = result.rows.find((row) => row.materialCode === 'M2');
  assert.equal(legacyFbaWarehouseRow?.businessUnit, '海外事业部');
  assert.equal(legacyFbaWarehouseRow?.fbaInventoryQty, 7);
  assert.equal(legacyFbaWarehouseRow?.fbaInventoryValue, 70);
  assert.equal(legacyFbaWarehouseRow?.mappingStatus, '完整');
  assert.equal(result.quantityReconciliation.summary.missingQuantity, 0);
  assert.equal(result.quantityReconciliation.summary.overlapQuantity, 0);
  assert.deepEqual(
    result.quantityReconciliation.sources
      .filter((row) => ['FBA库存', 'FBM库存'].includes(row.sourceType))
      .map((row) => [row.sourceType, row.expectedQuantity, row.dashboardQuantity, row.status]),
    [
      ['FBA库存', 7, 7, '校准通过'],
      ['FBM库存', 5, 5, '校准通过']
    ]
  );
});

test('inventory dimension diagnostics identifies the exact maintenance table and affected quantity', () => {
  const rowsBySlot = new Map([
    ['productCategory', [{
      materialCode: 'M1',
      sku: 'SKU-1',
      materialName: 'Material One',
      productLine: 'Line A',
      productSeries: 'Series A',
      pretaxPrice: '10'
    }]],
    ['spare1', [{ subject: '主体一', warehouseName: '缺失事业部仓' }]],
    ['inventorySummaryFile2', [{
      identifier: 'M1',
      warehouseName: '缺失事业部仓',
      actualTotalQty: '5'
    }]]
  ]);
  const model = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: '2026-07-30 15:00:00' })
  });
  const diagnostics = buildInventoryDimensionDiagnostics(model);
  assert.equal(diagnostics.issues.length, 1);
  assert.deepEqual({
    targetSlotId: diagnostics.issues[0].targetSlotId,
    targetTitle: diagnostics.issues[0].targetTitle,
    missingKey: diagnostics.issues[0].missingKey,
    subject: diagnostics.issues[0].subject,
    warehouse: diagnostics.issues[0].kingdeeWarehouseName,
    sku: diagnostics.issues[0].sku,
    materialCode: diagnostics.issues[0].materialCode,
    materialName: diagnostics.issues[0].materialName,
    productLine: diagnostics.issues[0].productLine,
    productSeries: diagnostics.issues[0].productSeries,
    qty: diagnostics.issues[0].qty,
    value: diagnostics.issues[0].value
  }, {
    targetSlotId: 'warehouseMaterialMap',
    targetTitle: '仓库与物料对照表',
    missingKey: '主体一 + 缺失事业部仓 + M1',
    subject: '主体一',
    warehouse: '缺失事业部仓',
    sku: 'SKU-1',
    materialCode: 'M1',
    materialName: 'Material One',
    productLine: 'Line A',
    productSeries: 'Series A',
    qty: 5,
    value: 50
  });
  assert.equal(diagnostics.tasks[0].affectedRows, 1);
  assert.equal(diagnostics.tasks[0].affectedQty, 5);
  assert.equal(diagnostics.qualitySummary.targetCount, 1);
});

test('inventory dimension diagnostics routes every mapping issue to its maintenance slot', () => {
  const diagnostics = buildInventoryDimensionDiagnostics({
    anomalies: [
      { id: '1', factId: '1', sourceType: 'FBA库存', sourceKey: 'SKU-1', sourceSku: 'SKU-1', issue: 'SKU与物料编码缺失', qty: 1 },
      { id: '2', factId: '2', sourceType: '京东在库', sourceKey: 'JD-1', jdId: 'JD-1', issue: '京东ID与品号映射冲突', qty: 2 },
      { id: '3', factId: '3', sourceType: 'FBA库存', sourceKey: 'FBA仓', sourceWarehouseName: 'FBA仓', issue: '仓库对照映射缺失', qty: 3 },
      { id: '4', factId: '4', sourceType: 'FBA在途', sourceKey: '店铺一', storeName: '店铺一', issue: '仓库对照映射缺失', qty: 4 },
      { id: '5', factId: '5', sourceType: 'FBM库存', sourceKey: 'FBM仓', sourceWarehouseName: 'FBM仓', issue: '仓库主体映射缺失', qty: 5 },
      {
        id: '6', factId: '6', sourceType: '国内在库', sourceKey: 'M6', subject: '主体六',
        kingdeeWarehouseName: '仓库六', materialCode: 'M6', issue: '主体、仓库与物料映射缺失', qty: 6
      },
      { id: '7', factId: '7', sourceType: '销售数据', sourceKey: 'M7', materialCode: 'M7', issue: '商品分类缺失', qty: 7 },
      { id: '8', factId: '7', sourceType: '销售数据', sourceKey: 'M7', materialCode: 'M7', issue: '不含税结算价缺失或无效', qty: 7 },
      {
        id: '9', factId: '9', sourceType: 'FBM库存', sourceKey: '', storeName: '店铺一',
        marketplace: '美国', sourceWarehouseName: 'FBM仓', issue: '识别码为空', qty: 9
      }
    ]
  });
  assert.deepEqual(
    [...new Set(diagnostics.issues.map((row) => row.targetSlotId))].sort(),
    [
      'inventorySummaryFile10',
      'inventorySummaryFile11',
      'inventorySummaryFile13',
      'inventorySummaryFile2',
      'inventorySummaryFile9',
      'productCategory',
      'spare1',
      'warehouseMaterialMap'
    ].sort()
  );
  assert.equal(diagnostics.qualitySummary.affectedFacts, 8);
  assert.equal(diagnostics.qualitySummary.affectedQty, 37);
  assert.equal(diagnostics.qualitySummary.targetCount, 8);
});

test('inventory dimension diagnostics defensively excludes legacy zero-quantity mapping issues', () => {
  const diagnostics = buildInventoryDimensionDiagnostics({
    anomalies: [
      {
        id: 'zero',
        factId: 'zero',
        sourceType: 'FBM库存',
        sourceKey: 'M-ZERO',
        materialCode: 'M-ZERO',
        issue: '主体、仓库与物料映射缺失',
        qty: 0,
        value: 0
      },
      {
        id: 'zero-transit',
        factId: 'zero-transit',
        sourceType: 'FBM在途',
        sourceKey: 'SKU-TRANSIT-ZERO',
        materialCode: 'M-TRANSIT-ZERO',
        issue: '主体、仓库与物料映射缺失',
        qty: 0,
        value: 0
      },
      {
        id: 'stock',
        factId: 'stock',
        sourceType: 'FBM库存',
        sourceKey: 'M-STOCK',
        materialCode: 'M-STOCK',
        issue: '主体、仓库与物料映射缺失',
        qty: 10,
        value: 100
      }
    ]
  });
  assert.equal(diagnostics.issues.length, 1);
  assert.equal(diagnostics.issues[0].sourceKey, 'M-STOCK');
  assert.equal(diagnostics.qualitySummary.affectedFacts, 1);
  assert.equal(diagnostics.qualitySummary.affectedQty, 10);
});

test('inventory workbook parser expands every merged FBA transit field and rejects ambiguous workbooks', () => {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.aoa_to_sheet([
    ['店铺', 'SKU', '货件状态', '发货数量', '已发货', '签收量'],
    ['店铺一', 'SKU-1', 'SHIPPED', 10, 8, 2],
    ['', '', '', '', '', '']
  ]);
  worksheet['!merges'] = [
    xlsx.utils.decode_range('A2:A3'),
    xlsx.utils.decode_range('B2:B3'),
    xlsx.utils.decode_range('C2:C3'),
    xlsx.utils.decode_range('D2:D3'),
    xlsx.utils.decode_range('E2:E3'),
    xlsx.utils.decode_range('F2:F3')
  ];
  xlsx.utils.book_append_sheet(workbook, worksheet, '任意名称');
  const parsed = parseInventorySummaryWorkbook(
    { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
    'inventorySummaryFile4'
  );
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[1], {
    storeName: '店铺一',
    marketplace: '',
    sku: 'SKU-1',
    shipmentStatus: 'SHIPPED',
    dispatchQty: 10,
    shippedQty: 8,
    signedQty: 2
  });

  const flattenedWorkbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(flattenedWorkbook, xlsx.utils.aoa_to_sheet([
    ['店铺', 'SKU', '货件状态', '发货数量', '已发货', '签收量'],
    ['店铺一', 'SKU-1', 'SHIPPED', 10, 8, 2],
    ['', 'SKU-2', '', '', 5, 1]
  ]), '已拆分明细');
  const flattened = parseInventorySummaryWorkbook(
    { buffer: xlsx.write(flattenedWorkbook, { type: 'buffer', bookType: 'xlsx' }) },
    'inventorySummaryFile4'
  );
  assert.deepEqual(flattened.rows[1], {
    storeName: '店铺一',
    marketplace: '',
    sku: 'SKU-2',
    shipmentStatus: 'SHIPPED',
    dispatchQty: 10,
    shippedQty: 5,
    signedQty: 1
  });

  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([['其他'], ['数据']]), '多余工作表');
  assert.throws(
    () => parseInventorySummaryWorkbook(
      { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
      'inventorySummaryFile4'
    ),
    /应只包含一个工作表/
  );
});

test('purchase tracking parser recognizes 未交付数量 and preserves supplier short names', () => {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([{
    下单月份: '2026-07',
    事业部: '全球招商事业部',
    物料编码: 'M-SUPPLIER',
    未交付数量: 12,
    完工未发产品: 2,
    已下单未备料未生产: 3,
    已备料未生产: 4,
    生产中产品: 3,
    是否需正常交货: '是',
    供应商简称: '迈锐',
    未履约原因: '未填写',
    原因详情: '未填写',
    备注: ''
  }]), '订单明细');

  const parsed = parseInventorySummaryWorkbook(
    { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
    'inventorySummaryFile12'
  );
  assert.equal(parsed.mapping.remainingQty, '未交付数量');
  assert.equal(parsed.mapping.supplierShortName, '供应商简称');
  assert.equal(parsed.mapping.__inventorySummary.parserVersion, 5);
  assert.equal(parsed.rows[0].remainingQty, 12);
  assert.equal(parsed.rows[0].supplierShortName, '迈锐');

  const rowsBySlot = new Map([
    ['productCategory', [{ materialCode: 'M-SUPPLIER', sku: 'SKU-SUPPLIER', salesRegion: '美国', pretaxPrice: 10 }]],
    ['inventorySummaryFile12', parsed.rows]
  ]);
  const model = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  const row = model.rows.find((item) => item.materialCode === 'M-SUPPLIER');
  assert.equal(row?.unfulfilledQty, 12);
  assert.equal(row?.unfulfilledSupplierShortName, '迈锐');
});

test('FBM transit parser and model keep only approved document warehouses and statuses', () => {
  const allowedWarehouses = [
    '102-US-海外二部-海上在途',
    '101-US-海外一部-海上在途',
    '101-G-海外一部-海上在途',
    '102-Q-海外二部-海上在途',
    '102-G-海外二部-海上在途',
    '104-US-全球招商部-海上在途',
    '106-G-国内事业部-海上在途',
    '101-G海外一部供应商仓跨境医疗器械'
  ];
  const sourceRows = [
    ...allowedWarehouses.map((warehouseName, index) => ({
      SKU: `SKU-${index + 1}`,
      '发货仓库（单据）': warehouseName,
      收货仓库: index === 0 ? '777-M/售后配件仓' : '正常收货仓',
      单据状态: index % 2 ? '待配货' : '待收货',
      备货数量: 10,
      收货数量: 2
    })),
    { SKU: 'SKU-BAD-WAREHOUSE', '发货仓库（单据）': '其他仓库', 收货仓库: '777-M/售后配件仓', 单据状态: '待收货', 备货数量: 100, 收货数量: 0 },
    { SKU: 'SKU-BAD-STATUS', '发货仓库（单据）': allowedWarehouses[0], 收货仓库: '777-M/售后配件仓', 单据状态: '已完成', 备货数量: 100, 收货数量: 0 }
  ];
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(sourceRows), '备货单详情');
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([['说明']]), '说明');
  const parsed = parseInventorySummaryWorkbook(
    { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
    'inventorySummaryFile5'
  );

  assert.equal(parsed.rows.length, 8);
  assert.deepEqual(new Set(parsed.rows.map((row) => row.warehouseName)), new Set(allowedWarehouses));
  assert.equal(parsed.rows.filter((row) => row.receivingWarehouseName.startsWith('777-')).length, 1);
  assert.deepEqual(new Set(parsed.rows.map((row) => row.documentStatus)), new Set(['待收货', '待配货']));
  assert.equal(parsed.mapping.__inventorySummary.filteredFbmTransitWarehouseRows, 1);
  assert.equal(parsed.mapping.__inventorySummary.filteredFbmTransitStatusRows, 1);

  const rowsBySlot = new Map([
    ['productCategory', [{ materialCode: 'M1', productType: '全新品', pretaxPrice: 10 }]],
    ['inventorySummaryFile10', sourceRows.map((row) => ({ lingxingSku: row.SKU, identifier: 'M1' }))],
    ['spare1', allowedWarehouses.map((warehouseName) => ({ subject: '主体一', warehouseName }))],
    ['warehouseMaterialMap', allowedWarehouses.map((warehouseName) => ({
      subject: '主体一', warehouseName, materialCode: 'M1', businessUnit: '海外事业一部'
    }))],
    ['inventorySummaryFile5', [
      ...parsed.rows,
      { sku: 'SKU-BAD-WAREHOUSE', warehouseName: '其他仓库', receivingWarehouseName: '777-M/售后配件仓', documentStatus: '待收货', stockupQty: 100, receivedQty: 0 },
      { sku: 'SKU-BAD-STATUS', warehouseName: allowedWarehouses[0], receivingWarehouseName: '777-M/售后配件仓', documentStatus: '已完成', stockupQty: 100, receivedQty: 0 }
    ]]
  ]);
  const model = buildInventorySummaryModel({
    getRows: (slotId) => rowsBySlot.get(slotId) || [],
    getRecord: (slotId) => ({ rows: rowsBySlot.get(slotId) || [], updatedAt: now })
  });
  assert.equal(model.totals.fbmTransitQty, 64);
  assert.equal(model.totals.fbmTransitValue, 640);
  const transitRow = model.rows.find((row) => row.materialCode === 'M1');
  assert.equal(
    transitRow.inventorySegmentBreakdown.find((row) => row.productType === '不可售')?.fbmTransitQty,
    8
  );
});

test('inventory summary and domestic board use complete source models and enforce page access', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'gendanjindu-inventory-summary-'));
  process.env.DATA_DIR = dataDir;
  const SQL = await initSqlJs();
  const legacyDatabase = new SQL.Database();
  legacyDatabase.run(`CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  writeFileSync(path.join(dataDir, 'gendanjindu.sqlite'), Buffer.from(legacyDatabase.export()));
  legacyDatabase.close();

  const database = await import(`./database.js?inventory-summary-test=${Date.now()}`);
  await database.initDatabase();
  assert.ok(database.all('PRAGMA table_info(sessions)').some((row) => row.name === 'expires_at'));

  const adminPassword = 'fixture-password';
  const adminPasswordHash = await bcrypt.hash(adminPassword, 4);

  database.run(
    'INSERT INTO users (id, name, password_hash, role, page_access, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['admin-id', 'Test Admin', adminPasswordHash, '管理员', '[]', now, now]
  );
  database.run(
    'INSERT INTO users (id, name, password_hash, role, page_access, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['system-owner-id', '孙立柱', adminPasswordHash, '管理员', '[]', now, now]
  );
  database.run(
    'INSERT INTO users (id, name, password_hash, role, page_access, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['limited-id', 'Limited User', 'unused', '普通用户', JSON.stringify(['operationBoard']), now, now]
  );
  database.run(
    'INSERT INTO users (id, name, password_hash, role, page_access, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['purchase-owner-id', '当前采购员', 'unused', '普通用户', JSON.stringify(['progressRefresh']), now, now]
  );
  database.run(
    'INSERT INTO users (id, name, password_hash, role, page_access, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['manual-owner-id', '李奇', 'unused', '普通用户', JSON.stringify(['progressRefresh']), now, now]
  );
  database.run(
    'INSERT INTO users (id, name, password_hash, role, page_access, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['bulk-user-1', 'Bulk User One', 'unused', '普通用户', '[]', now, now]
  );
  database.run(
    'INSERT INTO users (id, name, password_hash, role, page_access, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['bulk-user-2', 'Bulk User Two', 'unused', '普通用户', '[]', now, now]
  );
  database.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', ['admin-token', 'admin-id', now]);
  database.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', ['system-owner-token', 'system-owner-id', now]);
  database.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', ['limited-token', 'limited-id', now]);
  database.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', ['purchase-owner-token', 'purchase-owner-id', now]);
  database.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', ['manual-owner-token', 'manual-owner-id', now]);
  database.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', ['bulk-token-1', 'bulk-user-1', now]);
  database.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', ['bulk-token-2', 'bulk-user-2', now]);
  database.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', ['expired-token', 'admin-id', now, '2020-01-01 00:00:00']);

  const demandSql = `INSERT INTO order_demands
    (demand_key, month, business_unit, supplier, material_code, current_order_qty, current_inbound_qty,
     tracking_order_qty, tracking_inbound_qty, tracking_remaining_qty, active, logistics_code,
     purchase_org, oa_flow_no, source_batch_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  [
    ['active-june', '2026-06', '国内事业部', 'Supplier A', 'M1', 1200, 200, 1200, 200, 1000, 1, '', '', '', 'batch-june', now],
    ['active-july', '2026-07', '跨境事业部', 'Supplier B', 'M2', 500, 0, 500, 0, '500', 1, '', '', '', '', now],
    ['active-zero-may', '2026-05', '跨境事业部', 'Supplier C', 'M3', 0, 0, 0, 0, 0, 1, '', '', '', '', now],
    ['active-zero-april', '2026-04', '跨境事业部', 'Supplier D', 'M4', 0, 0, 0, 0, 0, 1, '', '', '', '', now],
    ['|2026-08|测试事业部|Current Supplier|M6', '2026-08', '测试事业部', 'Current Supplier', 'M6', 0, 0, 0, 0, 0, 1, '', '', '', '', now],
    ['|2026-08|测试事业部|Exact Supplier|M7', '2026-08', '测试事业部', 'Exact Supplier', 'M7', 0, 0, 0, 0, 0, 1, '', '', '', '', now],
    ['|2026-08|测试事业部|Vendor 8 A|M8', '2026-08', '测试事业部', 'Vendor 8 A', 'M8', 0, 0, 0, 0, 0, 1, '', '', '', '', now],
    ['manual-current-fields', '2026-08', '海外事业一部', '锐世迈医疗科技有限公司', '1007010984', 10, 0, 10, 0, 10, 1, '', '浙江采购组织', '', 'batch-current-fields', now],
    ['manual-short-name-fallback', '2026-08', '海外事业一部', '采购订单供应商全称', '1002010305', 12, 2, 12, 2, 10, 1, '', '浙江采购组织', '', 'batch-short-name-fallback', now],
    ['inactive', '2026-03', '国内事业部', 'Supplier E', 'M5', 9999, 0, 9999, 0, 9999, 0, '', '', '', '', now]
  ].forEach((params) => database.run(demandSql, params));
  database.run("UPDATE order_demands SET purchase_owner = '陈晨' WHERE demand_key IN (?, ?)", ['active-june', 'active-july']);
  database.run("UPDATE order_demands SET supplier_short_name = '供应商庚' WHERE material_code = 'M6'");
  const batchSql = `INSERT INTO kingdee_import_batches
    (id, file_name, import_mode, imported_by, imported_at, applied_at, row_count)
    VALUES (?, ?, 'snapshot', 'Test Admin', ?, ?, ?)`;
  database.run(batchSql, ['batch-june', '采购订单来源-六月.xlsx', now, now, 3]);
  database.run(batchSql, ['batch-current-fields', '采购订单来源-当前字段.xlsx', now, now, 1]);
  database.run(batchSql, ['batch-short-name-fallback', '采购订单来源-简称兜底.xlsx', now, now, 1]);

  const kingdeeOrderSql = `INSERT INTO kingdee_orders
    (id, batch_id, demand_key, month, business_unit, supplier, material_code, quantity,
     inbound_qty, remaining_inbound_qty, delivery_date, operator_name, order_no, document_status,
     close_status, business_close, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  database.run(
    kingdeeOrderSql,
    ['order-june', 'batch-june', 'active-june', '2026-06', '国内事业部', 'Supplier A', 'M1', 700,
      100, 600, '2026-09-30 15:30:00', '薛文乐7月柜1', 'CGDD011590', '已审核', '未关闭', '正常', '{}']
  );
  database.run(
    kingdeeOrderSql,
    ['order-june-date-2', 'batch-june', 'active-june', '2026-06', '国内事业部', 'Supplier A', 'M1', 500,
      100, 400, '2026/09/15 08:00:00', '薛文乐7月柜1', 'CGDD011560', '已审核', '未关闭', '正常', '{}']
  );
  database.run(
    kingdeeOrderSql,
    ['order-june-date-2-closed-line', 'batch-june', 'active-june', '2026-06', '国内事业部', 'Supplier A', 'M1', 0,
      0, 0, '', '薛文乐7月柜1', 'CGDD011560', '已审核', '未关闭', '已关闭', '{}']
  );
  database.run(
    kingdeeOrderSql,
    ['order-june-invalid', 'batch-june', 'active-june', '2026-06', '国内事业部', 'Supplier A', 'M1', 100,
      0, 100, '2026/09/15 08:00:00', '薛文乐7月柜1', 'CGDD011482', '已审核', '未关闭', '异常', '{}']
  );
  database.run(
    `INSERT INTO kingdee_orders
      (id, batch_id, demand_key, month, business_unit, supplier, material_code, purchase_org, creator,
       order_no, quantity, inbound_qty, remaining_inbound_qty, document_status, close_status, business_close, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'order-current-fields', 'batch-current-fields', 'manual-current-fields', '2026-08', '海外事业一部',
      '锐世迈医疗科技有限公司', '1007010984', '浙江采购组织', '陈晨', 'CGDD013047', 10, 0, 10,
      '已审核', '未关闭', '正常', '{}'
    ]
  );
  database.run(
    `INSERT INTO kingdee_orders
      (id, batch_id, demand_key, month, business_unit, supplier, material_code, purchase_org, creator,
       order_no, quantity, inbound_qty, remaining_inbound_qty, document_status, close_status, business_close, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'order-short-name-fallback', 'batch-short-name-fallback', 'manual-short-name-fallback', '2026-08',
      '海外事业一部', '采购订单供应商全称', '1002010305', '浙江采购组织', '陈晨', 'CGDD012997',
      12, 2, 10, '已审核', '未关闭', '正常', '{}'
    ]
  );

  const dimensionSql = `INSERT INTO dimension_files
    (slot_id, title, file_name, sheet_name, sheet_names, mapping_json, rows_json, applied, uploaded_by, updated_at)
    VALUES (?, ?, ?, '', '[]', '{}', ?, 1, 'Test Admin', ?)`;
  const putDimension = (slotId, title, rows) => database.run(
    dimensionSql,
    [slotId, title, `${slotId}.xlsx`, JSON.stringify(rows), now]
  );

  putDimension('firstMileData1', 'First mile test', [
    { id: 'sea-1', businessType: '头程成品发货', sourceFile: 'sea.xlsx', sourceSheet: 'Sheet1', cargoStatus: '海上在途', quantity: '2,000', businessUnit: '国内事业部', materialCode: 'M1' },
    { id: 'listed-1', businessType: '头程成品发货', sourceFile: 'listed.xlsx', sourceSheet: 'Sheet1', cargoStatus: '已上架', quantity: '8,000', materialCode: 'M2' },
    { id: 'foreign-1', businessType: '外贸', sourceFile: 'foreign.xlsx', sourceSheet: 'Sheet1', cargoStatus: '外贸订单已发货', quantity: '7,000', materialCode: 'M3' },
    { id: 'sea-empty', businessType: '头程成品发货', sourceFile: 'empty.xlsx', sourceSheet: 'Sheet1', cargoStatus: '海上在途', quantity: '', materialCode: 'M4' },
    { id: 'sea-invalid', businessType: '头程成品发货', sourceFile: 'invalid.xlsx', sourceSheet: 'Sheet1', cargoStatus: '海上在途', quantity: 'invalid', materialCode: 'M5' }
  ]);
  putDimension('wangdianDataMain', 'WDT inventory', [
    {
      merchantCode: 'M0',
      wdtStockQty: '0',
      raw: { 商家编码: 'M0', 可发库存: '0' }
    },
    {
      merchantCode: 'M1',
      wdtStockQty: '3,000',
      raw: { 是否正常备货: '正常', 品牌: 'Domestic Brand', 产品类型: 'Domestic Type', '系统SKU-必填': 'SKU-1' }
    },
    {
      merchantCode: 'M2',
      wdtStockQty: '',
      raw: { 商家编码: 'M2', 库存量: '200' }
    },
    {
      merchantCode: 'WDT-X',
      wdtStockQty: '100',
      raw: { 商家编码: 'WDT-X', 货品名称: 'Unique Product' }
    }
  ]);
  putDimension('wangdianSpare1', 'JD inventory', [
    { jdId: 'JD-1', jdStockQty: '400' },
    { jdId: 'JD-2', jdStockQty: '' }
  ]);
  putDimension('wangdianSpare2', 'JD mapping', [
    { jdId: 'JD-1', materialCode: 'M1' },
    { jdId: 'JD-2', materialCode: 'M2' }
  ]);
  putDimension('productCategory', 'Product category', [
    {
      materialCode: '',
      raw: { 品牌: 'Inherited Brand' }
    },
    {
      materialCode: 'M1',
      sku: 'SKU-1',
      materialName: 'Material One',
      productLine: 'Line A',
      productSeries: 'Series A',
      model: 'Model One'
    },
    {
      materialCode: '',
      raw: {
        物料编码: 'M2',
        SKU: 'SKU-2',
        品牌名称: 'Category Brand',
        商品类型: 'Category Type',
        销售产品线: 'Category Line',
        销售系列: 'Category Series',
        型号: 'Category Model'
      }
    },
    {
      materialCode: 'M9',
      sku: 'SKU-9',
      materialName: 'Unique Product',
      productLine: 'Unique Line',
      productSeries: 'Unique Series',
      model: 'Unique Model',
      raw: { 销售产品分类: 'Unique Type' }
    },
    {
      materialCode: '1007010984',
      sku: 'U31-E-GY',
      materialName: '1007010984',
      productLine: '手动轮椅',
      productSeries: 'U31',
      raw: { 金蝶名称: '手工轮椅测试物料' }
    },
    {
      materialCode: '1002010305',
      sku: 'TEST-SHENYU',
      materialName: '申裕测试物料',
      productLine: '测试产品线',
      productSeries: '测试系列'
    }
  ]);
  putDimension('purchaseAssignment', 'Purchase assignment', [
    {
      materialCode: 'M1',
      supplier: 'Unrelated Vendor One',
      supplierShortName: '供应商甲',
      productLineDetailSupplier: '供应商甲&供应商乙',
      purchaseOwner: '当前采购员'
    },
    {
      materialCode: 'M2',
      supplier: 'Supplier B First',
      supplierShortName: '供应商丙',
      purchaseOwner: '采购员甲'
    },
    {
      materialCode: 'M2',
      supplier: 'Supplier B Second',
      supplierShortName: '供应商丁',
      purchaseOwner: '采购员乙'
    },
    {
      materialCode: 'M6',
      supplier: 'Different Vendor',
      supplierShortName: '供应商己',
      purchaseOwner: '采购员丙'
    },
    {
      materialCode: 'M7',
      supplier: 'Exact Supplier',
      supplierShortName: '供应商辛&供应商戊&供应商辛',
      purchaseOwner: '采购员丁'
    },
    {
      materialCode: 'M7',
      supplier: 'Exact Supplier Extended',
      supplierShortName: '供应商模糊',
      purchaseOwner: '采购员戊'
    },
    {
      materialCode: 'M8',
      supplier: 'Vendor 8 A',
      supplierShortName: '供应商壬',
      purchaseOwner: '采购员己'
    },
    {
      materialCode: 'M8',
      supplier: 'Vendor 8 B',
      supplierShortName: '供应商癸',
      purchaseOwner: '采购员己'
    },
    {
      materialCode: 'M8',
      supplier: 'Vendor 8 C',
      supplierShortName: '供应商子',
      purchaseOwner: '采购员己'
    },
    {
      materialCode: '1007010984',
      supplier: '锐世迈医疗科技有限公司',
      supplierShortName: '锐世迈',
      purchaseOwner: '李奇'
    },
    {
      materialCode: '1002010305',
      supplier: '采购分工供应商全称',
      supplierShortName: '申裕',
      purchaseOwner: '李奇'
    }
  ]);
  database.run(
    `INSERT INTO manual_progress_import_batches
      (id, file_hash, file_name, sheet_name, row_count, status, summary_json, imported_by, imported_at, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['manual-current-fields-batch', 'manual-current-fields-hash', '手工跟单测试.xlsx', 'Sheet1', 2, 'applied', '{}', 'Test Admin', now, now]
  );
  database.run(
    `INSERT INTO manual_progress_rows
      (id, batch_id, source_row_no, source_key, group_key, row_type, data_status, demand_key, order_no,
       month, business_unit, supplier_short_name, purchase_owner, material_code, manual_remaining_qty,
       unprepared_qty, validation_status, raw_json, candidate_json, active, stale, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'manual-current-fields-row', 'manual-current-fields-batch', 2, 'manual-current-fields-source',
      'order|cgdd013047|1007010984', 'purchase_order', '手工已匹配', 'manual-current-fields', 'CGDD013047',
      '2026-08', '海外事业一部', '锐世迈', '', '1007010984', 15, 15, 'valid', '{}',
      JSON.stringify([{ demandKey: 'manual-current-fields', orderNo: 'CGDD013047', supplierShortName: '', purchaseOwner: '', orderCreator: '' }]),
      1, 0, 'Test Admin', now
    ]
  );
  database.run(
    `INSERT INTO manual_progress_rows
      (id, batch_id, source_row_no, source_key, group_key, row_type, data_status, demand_key, order_no,
       month, business_unit, supplier_short_name, purchase_owner, material_code, manual_remaining_qty,
       unprepared_qty, validation_status, raw_json, candidate_json, active, stale, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'manual-unmatched-row', 'manual-current-fields-batch', 4, 'manual-unmatched-source',
      'order|manual001|manual-material', 'purchase_order', '本次手工表未出现', '', 'MANUAL-001',
      '2026-08', '海外事业一部', '手工供应商', '李奇', 'MANUAL-MATERIAL', 5, 5, 'valid', '{}', '[]',
      1, 1, 'Test Admin', now
    ]
  );
  database.run(
    `INSERT INTO manual_progress_allocations
      (id, batch_id, source_row_id, source_row_no, order_no, material_code, demand_key, match_status,
       remaining_qty, allocated_unprepared_qty, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'manual-current-fields-allocation', 'manual-current-fields-batch', 'manual-current-fields-row', 2,
      'CGDD013047', '1007010984', 'manual-current-fields', 'matched', 10, 15, 1, now, now
    ]
  );
  database.run(
    `INSERT INTO manual_progress_rows
      (id, batch_id, source_row_no, source_key, group_key, row_type, data_status, demand_key, order_no,
       month, business_unit, supplier_short_name, purchase_owner, material_code, manual_remaining_qty,
       unprepared_qty, source_shipped_qty, validation_status, raw_json, candidate_json, active, stale, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'manual-short-name-row', 'manual-current-fields-batch', 3, 'manual-short-name-source',
      'order|cgdd012997|1002010305', 'purchase_order', '手工已匹配', 'manual-short-name-fallback', 'CGDD012997',
      '2026-08', '海外事业一部', '申裕', '', '1002010305', 10, 10, 2, 'valid', '{}',
      JSON.stringify([{ demandKey: 'manual-short-name-fallback', orderNo: 'CGDD012997', supplier: '采购订单供应商全称', supplierShortName: '未匹配', purchaseOwner: '', orderCreator: '' }]),
      1, 0, 'Test Admin', now
    ]
  );
  database.run(
    `INSERT INTO manual_progress_allocations
      (id, batch_id, source_row_id, source_row_no, order_no, material_code, demand_key, match_status,
       order_qty, inbound_qty, remaining_qty, allocated_unprepared_qty, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'manual-short-name-allocation', 'manual-current-fields-batch', 'manual-short-name-row', 3,
      'CGDD012997', '1002010305', 'manual-short-name-fallback', 'matched', 12, 2, 10, 10, 1, now, now
    ]
  );
  database.run(
    `INSERT INTO manual_progress_import_batches
      (id, file_hash, file_name, sheet_name, row_count, status, summary_json, imported_by, imported_at, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['manual-old-duplicate-batch', 'manual-old-duplicate-hash', '旧手工跟单测试.xlsx', 'Sheet1', 1, 'applied', '{}', 'Test Admin', '2026-01-01 00:00:00', '2026-01-01 00:00:00']
  );
  database.run(
    `INSERT INTO manual_progress_rows
      (id, batch_id, source_row_no, source_key, group_key, row_type, data_status, demand_key, order_no,
       month, business_unit, supplier_short_name, purchase_owner, material_code, manual_remaining_qty,
       unprepared_qty, validation_status, raw_json, candidate_json, active, stale, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'manual-old-duplicate-row', 'manual-old-duplicate-batch', 2, 'manual-old-duplicate-source',
      'order|cgdd012997|1002010305', 'purchase_order', '本次手工表未出现', 'manual-short-name-fallback', 'CGDD012997',
      '2026-08', '海外事业一部', '申裕', '', '1002010305', 10, 10, 'valid', '{}', '[]',
      1, 1, 'Test Admin', '2026-01-01 00:00:00'
    ]
  );
  putDimension('lingxingWfsInventory', 'WFS inventory', [
    { storeName: 'Test Store', marketplace: 'US', warehouseName: 'Test Warehouse', sku: 'SKU-WFS', totalInventoryQty: '5,000' },
    { storeName: 'Test Store', marketplace: 'US', warehouseName: 'Test Warehouse', sku: 'SKU-EMPTY', totalInventoryQty: '' },
    { storeName: 'Test Store', marketplace: 'US', warehouseName: 'Test Warehouse', sku: 'SKU-BAD', totalInventoryQty: 'invalid' }
  ]);
  database.run(
    'INSERT INTO import_mappings (kind, mapping_json, updated_by, updated_at) VALUES (?, ?, ?, ?)',
    ['kingdee', JSON.stringify({ createDate: '自定义日期', supplier: '自定义供应商', materialCode: '自定义物料', quantity: '自定义数量' }), 'Test Admin', now]
  );
  const sessionSummary = [{
    demandKey: 'active-june',
    month: '2026-06',
    businessUnit: '国内事业部',
    supplier: 'Supplier A',
    materialCode: 'M1',
    purchaseOrg: '',
    oaFlowNo: '',
    materialName: 'Material One',
    currentOrderQty: 1300,
    currentInboundQty: 200,
    trackingOrderQty: 1300,
    trackingInboundQty: 200,
    trackingRemainingQty: 1100
  }];
  const sessionSourceRows = [{
    demandKey: 'active-june',
    month: '2026-06',
    businessUnit: '国内事业部',
    supplier: 'Supplier A',
    materialCode: 'M1',
    purchaseOrg: '',
    creator: '',
    oaFlowNo: '',
    orderNo: 'PO-SESSION',
    quantity: 1300,
    inboundQty: 200,
    remainingInboundQty: 1100,
    purchaseDate: '2026-06-01',
    materialName: 'Material One',
    closeStatus: '未关闭',
    raw: {}
  }];
  database.run(
    `INSERT INTO difference_compare_sessions
      (id, file_name, mapping_json, summary_json, source_rows_json, total_rows, valid_rows, skipped_rows, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 1, 1, 0, 'pending', ?, ?)`,
    [
      'session-consistency',
      'session-consistency.xlsx',
      JSON.stringify({ createDate: '自定义日期', supplier: '自定义供应商', materialCode: '自定义物料', quantity: '自定义数量' }),
      JSON.stringify(sessionSummary),
      JSON.stringify(sessionSourceRows),
      'Test Admin',
      now
    ]
  );
  database.run(
    `INSERT INTO difference_compare_rows
      (id, session_id, demand_key, month, business_unit, supplier, material_code, order_creator, old_qty, new_qty,
       delta_qty, diff_type, handling_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto_new', ?)`,
    ['session-row', 'session-consistency', 'active-june', '2026-06', '国内事业部', 'Supplier A', 'M1', '陈晨', 1200, 1300, 100, '数量增加', now]
  );
  database.run(
    `INSERT INTO difference_allocations
      (id, session_id, row_id, demand_key, action_type, allocated_qty, reason, old_qty, new_qty,
       delta_qty, automatic, created_by, created_at)
     VALUES (?, ?, ?, ?, '新增订单', 100, '测试', 1200, 1300, 100, 1, ?, ?)`,
    ['session-allocation', 'session-consistency', 'session-row', 'active-june', 'Test Admin', now]
  );
  const currentFollowupAt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(new Date());
  database.run(
    `INSERT INTO production_order_followups
      (tracking_key, demand_key, order_no, fulfillment_remark, followed_by, followed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['active-june|CGDD011560', 'active-june', 'CGDD011560', '管理员保存的最新跟单备注', 'Test Admin', currentFollowupAt]
  );
  database.run(
    `INSERT INTO production_progress_save_requests
      (request_id, user_id, tracking_key, demand_key, order_no, saved_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['legacy-ordinary-followup-001', 'purchase-owner-id', 'active-june|CGDD011560', 'active-june', 'CGDD011560', currentFollowupAt]
  );
  database.run('UPDATE order_demands SET current_order_qty = 9999 WHERE demand_key = ?', ['active-june']);
  database.saveDatabase();

  const port = await getAvailablePort();
  const logs = [];
  const child = spawn(process.execPath, ['server/app.js'], {
    cwd: projectRoot,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ADMIN_INITIAL_PASSWORD: 'fixture-only-password' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  try {
    await waitForServer(`http://127.0.0.1:${port}/gendanjindu/`, child, logs);
    const endpoint = `http://127.0.0.1:${port}/api/inventory-summary`;
    const [adminResponse, manualReconciliationResponse, purchaseSummaryResponse, domesticResponse, dimensionMissingResponse, demandsResponse, operationBoardResponse, deniedOperationBoardResponse, firstMileResponse, anonymousResponse, limitedResponse, expiredResponse] = await Promise.all([
      fetch(endpoint, { headers: { Authorization: 'Bearer admin-token' } }),
      fetch(`${endpoint}/manual-reconciliation?category=${encodeURIComponent('成品+配件')}`, { headers: { Authorization: 'Bearer admin-token' } }),
      fetch(`http://127.0.0.1:${port}/api/inventory-purchase-summary`, { headers: { Authorization: 'Bearer admin-token' } }),
      fetch(`http://127.0.0.1:${port}/api/domestic-board`, { headers: { Authorization: 'Bearer admin-token' } }),
      fetch(`http://127.0.0.1:${port}/api/dimension-missing/cross-border`, { headers: { Authorization: 'Bearer admin-token' } }),
      fetch(`http://127.0.0.1:${port}/api/demands?orderLevel=1`, { headers: { Authorization: 'Bearer admin-token' } }),
      fetch(`http://127.0.0.1:${port}/api/operation-board/demands`, { headers: { Authorization: 'Bearer limited-token' } }),
      fetch(`http://127.0.0.1:${port}/api/operation-board/demands`, { headers: { Authorization: 'Bearer purchase-owner-token' } }),
      fetch(`http://127.0.0.1:${port}/api/first-mile-board`, { headers: { Authorization: 'Bearer admin-token' } }),
      fetch(endpoint),
      fetch(endpoint, { headers: { Authorization: 'Bearer limited-token' } }),
      fetch(`http://127.0.0.1:${port}/api/bootstrap`, { headers: { Authorization: 'Bearer expired-token' } })
    ]);

    assert.equal(adminResponse.status, 200);
    assert.equal(manualReconciliationResponse.status, 200);
    assert.equal(purchaseSummaryResponse.status, 200);
    assert.equal(domesticResponse.status, 200);
    assert.equal(dimensionMissingResponse.status, 200);
    assert.equal(demandsResponse.status, 200);
    assert.equal(operationBoardResponse.status, 200);
    assert.equal(deniedOperationBoardResponse.status, 403);
    assert.equal(firstMileResponse.status, 200);
    assert.equal(anonymousResponse.status, 401);
    assert.equal(limitedResponse.status, 403);
    assert.equal(expiredResponse.status, 401);
    assert.equal((await expiredResponse.json()).error, '登录已过期，请重新登录');
    const operationBoardRows = (await operationBoardResponse.json()).rows;
    assert.ok(operationBoardRows.length > 0);
    assert.ok(operationBoardRows.every((row) => row.canEdit === false));
    assert.ok(operationBoardRows.filter((row) => row.operationOrderLevel).every((row) => row.sourceFile));
    assert.ok(operationBoardRows.every((row) => row.operationOrderLevel && row.dataSource === '金蝶系统'));

    const purchaseOwnerDemandsResponse = await fetch(`http://127.0.0.1:${port}/api/demands`, {
      headers: { Authorization: 'Bearer purchase-owner-token' }
    });
    assert.equal(purchaseOwnerDemandsResponse.status, 200);
    const purchaseOwnerDemandRows = (await purchaseOwnerDemandsResponse.json()).rows;
    assert.ok(purchaseOwnerDemandRows.length > 0);
    assert.ok(purchaseOwnerDemandRows.some((row) => String(row.purchaseOwner).split(/[+、]/).includes('当前采购员')));
    assert.ok(purchaseOwnerDemandRows.some((row) => !String(row.purchaseOwner).split(/[+、]/).includes('当前采购员')));
    assert.ok(purchaseOwnerDemandRows.some((row) => row.canEdit === true));
    assert.ok(purchaseOwnerDemandRows.some((row) => row.canEdit === false));
    const progressDemandsResponse = await fetch(`http://127.0.0.1:${port}/api/progress/demands`, {
      headers: { Authorization: 'Bearer purchase-owner-token' }
    });
    assert.equal(progressDemandsResponse.status, 200);
    assert.equal(progressDemandsResponse.headers.get('cache-control'), 'no-store');
    assert.match(progressDemandsResponse.headers.get('server-timing') || '', /^progress-demands;dur=\d+$/);
    const progressDemandPayload = await progressDemandsResponse.json();
    assert.equal(progressDemandPayload.dataScope, 'progress');
    assert.ok(progressDemandPayload.rows.length > 0);
    assert.ok(progressDemandPayload.rows.every((row) => row.stockQty === 0));
    const deniedProgressDemandsResponse = await fetch(`http://127.0.0.1:${port}/api/progress/demands`, {
      headers: { Authorization: 'Bearer limited-token' }
    });
    assert.equal(deniedProgressDemandsResponse.status, 403);
    const unrelatedDemandsResponse = await fetch(`http://127.0.0.1:${port}/api/demands`, {
      headers: { Authorization: 'Bearer limited-token' }
    });
    assert.equal(unrelatedDemandsResponse.status, 200);
    const unrelatedDemandRows = (await unrelatedDemandsResponse.json()).rows;
    assert.equal(unrelatedDemandRows.length, purchaseOwnerDemandRows.length);
    assert.ok(unrelatedDemandRows.every((row) => row.canEdit === false));

    const nonAdminManualImportResponse = await fetch(`http://127.0.0.1:${port}/api/progress/manual-import/preview`, {
      method: 'POST',
      headers: { Authorization: 'Bearer purchase-owner-token' }
    });
    assert.equal(nonAdminManualImportResponse.status, 403);
    assert.deepEqual(await nonAdminManualImportResponse.json(), { error: '仅管理员孙立柱可操作' });

    const systemOwnerManualImportResponse = await fetch(`http://127.0.0.1:${port}/api/progress/manual-import/preview`, {
      method: 'POST',
      headers: { Authorization: 'Bearer system-owner-token' }
    });
    assert.equal(systemOwnerManualImportResponse.status, 400);
    assert.deepEqual(await systemOwnerManualImportResponse.json(), { error: '请选择手工登记表文件' });

    const usersResponse = await fetch(`http://127.0.0.1:${port}/api/users`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    assert.equal(usersResponse.status, 200);
    const userRows = (await usersResponse.json()).rows;
    assert.ok(userRows.length > 0);
    assert.ok(userRows.every((row) => !Object.hasOwn(row, 'password_hash')));

    const duplicateUserResponse = await fetch(`http://127.0.0.1:${port}/api/users`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Admin', password: 'duplicate-user-password' })
    });
    assert.equal(duplicateUserResponse.status, 500);
    assert.deepEqual(await duplicateUserResponse.json(), { error: '服务器处理失败，请稍后重试' });

    const unauthorizedBulkDeleteResponse = await fetch(`http://127.0.0.1:${port}/api/users/bulk-delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer limited-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ['bulk-user-1'] })
    });
    assert.equal(unauthorizedBulkDeleteResponse.status, 403);

    const selfDeleteResponse = await fetch(`http://127.0.0.1:${port}/api/users/bulk-delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ['admin-id', 'bulk-user-1'] })
    });
    assert.equal(selfDeleteResponse.status, 400);
    assert.deepEqual(await selfDeleteResponse.json(), { error: '不能删除当前登录用户' });

    const bulkDeleteResponse = await fetch(`http://127.0.0.1:${port}/api/users/bulk-delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ['bulk-user-1', 'bulk-user-2', 'bulk-user-1', 'missing-user'] })
    });
    assert.equal(bulkDeleteResponse.status, 200);
    assert.deepEqual(await bulkDeleteResponse.json(), {
      ok: true,
      deletedCount: 2,
      deletedIds: ['bulk-user-1', 'bulk-user-2'],
      deletedNames: ['Bulk User One', 'Bulk User Two'],
      notFoundIds: ['missing-user']
    });
    const usersAfterBulkDelete = await fetch(`http://127.0.0.1:${port}/api/users`, {
      headers: { Authorization: 'Bearer admin-token' }
    }).then((response) => response.json());
    assert.ok(!usersAfterBulkDelete.rows.some((row) => ['bulk-user-1', 'bulk-user-2'].includes(row.id)));
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/bootstrap`, { headers: { Authorization: 'Bearer bulk-token-1' } })).status, 401);

    const summary = await adminResponse.json();
    const manualReconciliationPayload = await manualReconciliationResponse.json();
    assert.deepEqual({
      在制量: summary.在制量,
      在途量: summary.在途量,
      在库量: summary.在库量
    }, {
      在制量: 0,
      在途量: 0,
      在库量: { 国内: 0, 跨境: 0, 合计: 0 }
    });
    assert.ok(Array.isArray(summary.rows));
    assert.equal(summary.rows.length, 0);
    assert.equal(summary.manualReconciliation, undefined);
    assert.deepEqual(manualReconciliationPayload.manualReconciliation.categories, ['全部', '成品+配件', '成品', '配件', '不可售']);
    assert.deepEqual(Object.keys(manualReconciliationPayload.manualReconciliation.summaryByCategory), ['成品+配件']);
    assert.deepEqual(manualReconciliationPayload.notes, []);
    const noteResponse = await fetch(`${endpoint}/manual-reconciliation/note`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: '成品+配件', businessUnit: '国内事业部', materialCode: 'M1', remark: '等待业务确认' })
    });
    assert.equal(noteResponse.status, 200);
    assert.equal((await noteResponse.json()).note.remark, '等待业务确认');
    const notesAfterSave = await fetch(`${endpoint}/manual-reconciliation?category=${encodeURIComponent('成品+配件')}`, {
      headers: { Authorization: 'Bearer admin-token' }
    }).then((response) => response.json());
    assert.equal(notesAfterSave.notes.length, 1);
    assert.deepEqual({ ...notesAfterSave.notes[0], updatedAt: Boolean(notesAfterSave.notes[0].updatedAt) }, {
      category: '成品+配件',
      businessUnit: '国内事业部',
      materialCode: 'M1',
      remark: '等待业务确认',
      updatedBy: 'Test Admin',
      updatedAt: true
    });
    const unauthorizedNoteResponse = await fetch(`${endpoint}/manual-reconciliation/note`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer limited-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: '成品+配件', businessUnit: '国内事业部', materialCode: 'M1', remark: '无权限修改' })
    });
    assert.equal(unauthorizedNoteResponse.status, 403);
    const invalidNoteResponse = await fetch(`${endpoint}/manual-reconciliation/note`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: '无效分类', businessUnit: '国内事业部', materialCode: 'M1', remark: '无效' })
    });
    assert.equal(invalidNoteResponse.status, 400);
    assert.equal(summary.quantityReconciliation.summary.sourceCount, 10);
    assert.equal(summary.quantityReconciliation.summary.missingQuantity, 0);
    assert.equal(summary.quantityReconciliation.summary.overlapQuantity, 0);
    assert.ok(Array.isArray(summary.quantityReconciliation.sources));
    assert.ok(Array.isArray(summary.quantityReconciliation.groups));
    assert.deepEqual((await purchaseSummaryResponse.json()).rows, []);
    const domesticRows = (await domesticResponse.json()).rows;
    assert.equal(domesticRows.length, 4);
    assert.deepEqual(domesticRows.map((row) => row.merchantCode), ['M1', 'M2', 'WDT-X', 'M0']);
    assert.deepEqual(
      domesticRows.filter((row) => row.merchantCode !== 'M0').map((row) => ({
        merchantCode: row.merchantCode,
        brand: row.brand,
        productType: row.productType,
        systemSku: row.systemSku,
        wdtStockQty: row.wdtStockQty,
        salesProductLine: row.salesProductLine,
        salesSeries: row.salesSeries,
        model: row.model
      })),
      [
        {
          merchantCode: 'M1', brand: 'Domestic Brand', productType: 'Domestic Type', systemSku: 'SKU-1',
          wdtStockQty: 3000, salesProductLine: 'Line A', salesSeries: 'Series A', model: 'Model One'
        },
        {
          merchantCode: 'M2', brand: 'Category Brand', productType: 'Category Type', systemSku: 'SKU-2',
          wdtStockQty: 200, salesProductLine: 'Category Line', salesSeries: 'Category Series', model: 'Category Model'
        },
        {
          merchantCode: 'WDT-X', brand: 'Category Brand', productType: 'Unique Type', systemSku: 'SKU-9',
          wdtStockQty: 100, salesProductLine: 'Unique Line', salesSeries: 'Unique Series', model: 'Unique Model'
        }
      ]
    );
    const dimensionMissing = await dimensionMissingResponse.json();
    assert.equal(dimensionMissing.matchRows.length, 1);
    assert.deepEqual({
      sourceSku: dimensionMissing.matchRows[0].sourceSku,
      inventoryQty: dimensionMissing.matchRows[0].inventoryQty,
      mappingStatus: dimensionMissing.matchRows[0].mappingStatus,
      maintenanceTargets: dimensionMissing.matchRows[0].maintenanceTargets.map((target) => target.title)
    }, {
      sourceSku: 'SKU-WFS',
      inventoryQty: 5000,
      mappingStatus: '维度缺失',
      maintenanceTargets: ['领星SKU和物料编码对照', '领星&金蝶仓库对照']
    });
    assert.ok(dimensionMissing.sourceAnomalies.every((row) => row.targetTitle && row.targetSlotId && row.maintainPage));
    assert.ok(Array.isArray(dimensionMissing.inventorySummaryIssues));
    assert.ok(Array.isArray(dimensionMissing.inventorySummaryTasks));
    assert.equal(typeof dimensionMissing.inventorySummaryQuality, 'object');
    const demandRows = (await demandsResponse.json()).rows;
    const m1Demand = demandRows.find((row) => row.materialCode === 'M1' && row.orderNo === 'CGDD011590');
    const m1DemandRows = demandRows.filter((row) => row.demandKey === m1Demand?.demandKey && row.materialCode === 'M1');
    assert.equal(m1DemandRows.length, 3);
    assert.deepEqual(m1DemandRows.map((row) => row.orderNo).sort(), ['CGDD011482', 'CGDD011560', 'CGDD011590']);
    const migratedFollowup = m1DemandRows.find((row) => row.orderNo === 'CGDD011560');
    assert.equal(migratedFollowup?.followupKey, 'order:CGDD011560:M1');
    assert.equal(migratedFollowup?.followupStatus, '本周已跟进');
    assert.equal(migratedFollowup?.followupUpdatedBy, '当前采购员');
    assert.equal(migratedFollowup?.fulfillmentRemark, '管理员保存的最新跟单备注');
    assert.equal(m1Demand?.followupStatus, '未跟进');
    const migratedReplayResponse = await fetch(
      `http://127.0.0.1:${port}/api/progress/${encodeURIComponent('active-june')}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer purchase-owner-token',
          'Content-Type': 'application/json',
          'X-Idempotency-Key': 'legacy-ordinary-followup-001'
        },
        body: JSON.stringify({
          requestId: 'legacy-ordinary-followup-001',
          trackingKey: 'active-june|CGDD011560',
          orderNo: 'CGDD011560'
        })
      }
    );
    assert.equal(migratedReplayResponse.status, 200);
    const migratedReplayPayload = await migratedReplayResponse.json();
    assert.equal(migratedReplayPayload.replayed, true);
    assert.equal(migratedReplayPayload.followupMarkedBySubmission, true);
    assert.equal(migratedReplayPayload.followupStatus, '本周已跟进');
    assert.equal(m1Demand?.operatorName, '薛文乐');
    assert.equal(m1Demand?.purchaseOwner, '当前采购员');
    assert.equal(m1Demand?.supplierShortName, '供应商甲&供应商乙');
    assert.equal(m1Demand?.orderSupplierShortName, '未匹配');
    assert.equal(m1Demand?.supplierCount, 1);
    assert.equal(m1Demand?.unpreparedQty, 0);
    assert.equal(m1Demand?.preparedNotStartedQty, 0);
    assert.deepEqual(m1DemandRows.map((row) => row.contractDeliveryDates).sort(), ['2026-09-15', '2026-09-15', '2026-09-30']);
    assert.equal(m1DemandRows.reduce((sum, row) => sum + row.operationStockQty, 0), 1300);
    assert.equal(m1Demand?.pretaxPriceMaintained, false);
    assert.equal(m1Demand?.normalFulfillmentAmount, 0);
    assert.equal(m1Demand?.abnormalFulfillmentAmount, 0);
    assert.ok(m1DemandRows.every((row) => row.operationOrderLevel && row.operationOrderRows.length === 0));
    assert.deepEqual(
      m1DemandRows.map((row) => ({
        orderNo: row.orderNo,
        remainingInboundQty: row.remainingInboundQty,
        shippedQty: row.shippedQty,
        sourceFile: row.sourceFile,
        effectiveOrderCondition: row.effectiveOrderCondition
      })).sort((left, right) => left.orderNo.localeCompare(right.orderNo)),
      [
        { orderNo: 'CGDD011482', remainingInboundQty: 100, shippedQty: 0, sourceFile: '采购订单来源-六月.xlsx', effectiveOrderCondition: '非有效订单' },
        { orderNo: 'CGDD011560', remainingInboundQty: 400, shippedQty: 100, sourceFile: '采购订单来源-六月.xlsx', effectiveOrderCondition: '有效订单' },
        { orderNo: 'CGDD011590', remainingInboundQty: 600, shippedQty: 100, sourceFile: '采购订单来源-六月.xlsx', effectiveOrderCondition: '有效订单' }
      ]
    );
    assert.equal(demandRows.find((row) => row.materialCode === 'M2')?.purchaseOwner, '未分配采购下单人');
    assert.equal(demandRows.find((row) => row.materialCode === 'M2')?.supplierShortName, '供应商丙&供应商丁');
    assert.equal(demandRows.find((row) => row.materialCode === 'M2')?.orderSupplierShortName, '供应商丙&供应商丁');
    assert.equal(demandRows.find((row) => row.materialCode === 'M2')?.supplierCount, 2);
    assert.equal(demandRows.find((row) => row.materialCode === 'M6')?.supplierShortName, '供应商己&供应商庚');
    assert.equal(demandRows.find((row) => row.materialCode === 'M6')?.purchaseOwner, '采购员丙');
    assert.equal(demandRows.find((row) => row.materialCode === 'M6')?.orderSupplierShortName, '未匹配');
    assert.equal(demandRows.find((row) => row.materialCode === 'M6')?.supplierCount, 1);
    assert.equal(demandRows.find((row) => row.materialCode === 'M7')?.orderSupplierShortName, '供应商辛&供应商戊');
    assert.equal(demandRows.find((row) => row.materialCode === 'M7')?.supplierCount, 3);
    assert.equal(demandRows.find((row) => row.materialCode === 'M8')?.orderSupplierShortName, '供应商壬');
    assert.equal(demandRows.find((row) => row.materialCode === 'M8')?.supplierCount, 3);
    const currentFieldsRow = demandRows.find((row) => row.orderNo === 'CGDD013047' && row.materialCode === '1007010984');
    assert.equal(currentFieldsRow?.dataSource, '金蝶系统');
    assert.deepEqual(currentFieldsRow?.manualSourceRows, []);
    const shortNameFallbackRow = demandRows.find((row) => row.orderNo === 'CGDD012997' && row.materialCode === '1002010305');
    assert.equal(shortNameFallbackRow?.dataSource, '金蝶系统');
    assert.deepEqual(shortNameFallbackRow?.manualSourceRows, []);
    assert.equal(
      demandRows.filter((row) => row.orderNo === 'CGDD012997' && row.materialCode === '1002010305').length,
      1
    );
    assert.ok(!demandRows.some((row) => row.dataStatus === '本次手工表未出现'));
    assert.ok(!demandRows.some((row) => row.purchaseOwner === '陈晨'));
    const completenessResponse = await fetch(`http://127.0.0.1:${port}/api/maintenance/data-completeness`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    assert.equal(completenessResponse.status, 200);
    const completeness = await completenessResponse.json();
    const orderVisibilityCheck = completeness.checks.find((check) => check.check === '当前金蝶非零订单完整展示');
    assert.deepEqual(orderVisibilityCheck, {
      check: '当前金蝶非零订单完整展示',
      passed: true,
      value: {
        sourceCount: 5,
        displayedCount: 5,
        missingCount: 0,
        extraCount: 0,
        duplicateCount: 0,
        missingOrderKeys: [],
        extraOrderKeys: [],
        duplicateOrderKeys: []
      }
    });
    const firstMileRows = (await firstMileResponse.json()).rows;
    assert.equal(firstMileRows.find((row) => row.materialCode === 'M1')?.model, 'Model One');

    const assignmentApplyResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions/purchaseAssignment/apply`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' }
    });
    assert.equal(assignmentApplyResponse.status, 200);
    const appliedDemandRows = (await assignmentApplyResponse.json()).rows;
    assert.equal(appliedDemandRows.find((row) => row.materialCode === 'M1')?.purchaseOwner, '当前采购员');
    assert.equal(appliedDemandRows.find((row) => row.materialCode === 'M1')?.supplierShortName, '供应商甲&供应商乙');
    assert.equal(appliedDemandRows.find((row) => row.materialCode === 'M2')?.purchaseOwner, '未分配采购下单人');
    assert.equal(appliedDemandRows.find((row) => row.materialCode === 'M2')?.supplierShortName, '供应商丙&供应商丁');
    assert.equal(appliedDemandRows.find((row) => row.materialCode === 'M6')?.supplierShortName, '供应商己&供应商庚');
    assert.equal(appliedDemandRows.find((row) => row.materialCode === 'M7')?.orderSupplierShortName, '供应商辛&供应商戊');

    const replacementAssignmentWorkbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(replacementAssignmentWorkbook, xlsx.utils.json_to_sheet([
      {
        物料编码: 'M1',
        供应商: 'Unrelated Vendor One',
        供应商简称: '供应商甲',
        产品线明细供应商: '供应商甲&供应商乙',
        采购下单人: '当前采购员'
      },
      {
        物料编码: 'M2',
        供应商: 'Supplier B First',
        供应商简称: '供应商丙',
        采购下单人: '采购员甲'
      }
    ]), '产品线明细');
    const replacementAssignmentForm = new FormData();
    replacementAssignmentForm.append('mapping', JSON.stringify({
      materialCode: '物料编码',
      supplier: '供应商',
      supplierShortName: '供应商简称',
      productLineDetailSupplier: '产品线明细供应商',
      purchaseOwner: '采购下单人'
    }));
    replacementAssignmentForm.append(
      'file',
      new Blob([xlsx.write(replacementAssignmentWorkbook, { type: 'buffer', bookType: 'xlsx' })]),
      '采购分工替换测试.xlsx'
    );
    const replacementAssignmentResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions/purchaseAssignment/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: replacementAssignmentForm
    });
    assert.equal(replacementAssignmentResponse.status, 200);
    const replacementDemandRows = (await replacementAssignmentResponse.json()).rows;
    assert.equal(replacementDemandRows.find((row) => row.materialCode === 'M2')?.orderSupplierShortName, '供应商丙');
    assert.equal(replacementDemandRows.find((row) => row.materialCode === 'M2')?.supplierCount, 1);

    const allocationRowsResponse = await fetch(`http://127.0.0.1:${port}/api/difference-allocations?sessionId=session-consistency`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    assert.equal(allocationRowsResponse.status, 200);
    const allocationRow = (await allocationRowsResponse.json()).rows.find((row) => row.id === 'session-allocation');
    assert.equal(allocationRow?.purchaseOwner, '当前采购员');
    assert.equal(allocationRow?.orderCreator, '陈晨');

    const progressEndpoint = `http://127.0.0.1:${port}/api/progress/${encodeURIComponent(m1Demand.demandKey)}`;
    const readSavedProgress = async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/progress/demands`, {
        headers: { Authorization: 'Bearer admin-token' }
      });
      assert.equal(response.status, 200);
      return aggregateDemandRows((await response.json()).rows, m1Demand.demandKey);
    };
    const progressSnapshotCount = async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/table-relationships`, {
        headers: { Authorization: 'Bearer admin-token' }
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      return payload.tables.find((table) => table.name === 'supplier_progress_snapshots')?.rowCount || 0;
    };
    const progressIdentity = { trackingKey: m1Demand.followupKey, orderNo: m1Demand.orderNo };
    const clientShippedOverrideResponse = await fetch(progressEndpoint, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...progressIdentity, inProductionQty: 400, finishedQty: 200, shippedQty: 199, remark: 'stale' })
    });
    assert.equal(clientShippedOverrideResponse.status, 200);
    const clientShippedOverridePayload = await clientShippedOverrideResponse.json();
    assert.equal(clientShippedOverridePayload.ok, true);
    assert.equal(clientShippedOverridePayload.followupMarkedBySubmission, false);
    assert.equal(clientShippedOverridePayload.followupStatus, '未跟进');
    assert.equal(Object.hasOwn(clientShippedOverridePayload, 'rows'), false);
    const clientShippedOverrideRow = await readSavedProgress();
    assert.equal(clientShippedOverrideRow?.shippedQty, 200);

    const invalidProgressResponse = await fetch(progressEndpoint, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...progressIdentity, preparedNotStartedQty: 500, inProductionQty: 600, finishedQty: 1, shippedQty: 200 })
    });
    assert.equal(invalidProgressResponse.status, 400);

    const missingReasonResponse = await fetch(progressEndpoint, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...progressIdentity, preparedNotStartedQty: 100, inProductionQty: 300, finishedQty: 200, shippedQty: 200, fulfillmentStatus: '否' })
    });
    assert.equal(missingReasonResponse.status, 400);

    const snapshotsBeforeIdempotentSave = await progressSnapshotCount();
    const currentProgressRequestId = 'progress-current-test-001';
    const currentProgressRequest = {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer admin-token',
        'Content-Type': 'application/json',
        'X-Idempotency-Key': currentProgressRequestId
      },
      body: JSON.stringify({
        ...progressIdentity,
        requestId: currentProgressRequestId,
        unpreparedQty: 0,
        preparedNotStartedQty: 100,
        inProductionQty: 300,
        finishedQty: 200,
        shippedQty: 200,
        productionDeliveryDate: '9/10/26',
        unproducedEstimatedDeliveryDate: '8/20/26',
        fulfillmentStatus: '否',
        unfulfilledReason: '供应商延期',
        reasonDetail: '原料延期',
        remark: 'current'
      })
    };
    const currentProgressResponse = await fetch(progressEndpoint, currentProgressRequest);
    assert.equal(currentProgressResponse.status, 200);
    const currentProgressPayload = await currentProgressResponse.json();
    assert.deepEqual({ ok: currentProgressPayload.ok, requestId: currentProgressPayload.requestId, replayed: currentProgressPayload.replayed }, {
      ok: true,
      requestId: currentProgressRequestId,
      replayed: false
    });
    assert.equal(currentProgressPayload.followupMarkedBySubmission, false);
    assert.equal(currentProgressPayload.followupStatus, '未跟进');
    assert.equal(Object.hasOwn(currentProgressPayload, 'rows'), false);
    const replayedProgressResponse = await fetch(progressEndpoint, currentProgressRequest);
    assert.equal(replayedProgressResponse.status, 200);
    const replayedProgressPayload = await replayedProgressResponse.json();
    assert.equal(replayedProgressPayload.replayed, true);
    assert.equal(replayedProgressPayload.followupMarkedBySubmission, false);
    assert.equal(replayedProgressPayload.followupStatus, '未跟进');
    assert.equal(await progressSnapshotCount(), snapshotsBeforeIdempotentSave + 1);
    const savedProgress = await readSavedProgress();
    assert.deepEqual({
      unpreparedQty: savedProgress?.unpreparedQty,
      preparedNotStartedQty: savedProgress?.preparedNotStartedQty,
      inProductionQty: savedProgress?.inProductionQty,
      finishedQty: savedProgress?.finishedQty,
      progressTotal: savedProgress?.progressTotal,
      fulfillmentStatus: savedProgress?.fulfillmentStatus,
      abnormalFulfillmentQty: savedProgress?.abnormalFulfillmentQty,
      abnormalFulfillmentAmount: savedProgress?.abnormalFulfillmentAmount,
      productionDeliveryDate: savedProgress?.productionDeliveryDate,
      unproducedEstimatedDeliveryDate: savedProgress?.unproducedEstimatedDeliveryDate,
      unfulfilledReason: savedProgress?.unfulfilledReason,
      reasonDetail: savedProgress?.reasonDetail
    }, {
      unpreparedQty: 0,
      preparedNotStartedQty: 100,
      inProductionQty: 300,
      finishedQty: 200,
      progressTotal: 600,
      fulfillmentStatus: '否',
      abnormalFulfillmentQty: 1100,
      abnormalFulfillmentAmount: 0,
      productionDeliveryDate: '2026-09-10',
      unproducedEstimatedDeliveryDate: '2026-08-20',
      unfulfilledReason: '供应商延期',
      reasonDetail: '原料延期'
    });

    const ordinaryProgressRequestId = 'progress-ordinary-test-001';
    const ordinaryProgressResponse = await fetch(progressEndpoint, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer purchase-owner-token',
        'Content-Type': 'application/json',
        'X-Idempotency-Key': ordinaryProgressRequestId
      },
      body: JSON.stringify({
        ...progressIdentity,
        requestId: ordinaryProgressRequestId,
        preparedNotStartedQty: 100,
        inProductionQty: 300,
        finishedQty: 200,
        fulfillmentStatus: '否',
        unfulfilledReason: '供应商延期',
        reasonDetail: '原料延期',
        fulfillmentRemark: '普通用户本周跟进'
      })
    });
    assert.equal(ordinaryProgressResponse.status, 200);
    const ordinaryProgressPayload = await ordinaryProgressResponse.json();
    assert.equal(ordinaryProgressPayload.followupMarkedBySubmission, true);
    assert.equal(ordinaryProgressPayload.followupStatus, '本周已跟进');
    const followedRowsResponse = await fetch(`http://127.0.0.1:${port}/api/progress/demands`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    const followedOrder = (await followedRowsResponse.json()).rows.find((row) => row.followupKey === m1Demand.followupKey);
    assert.equal(followedOrder?.followupStatus, '本周已跟进');
    assert.equal(followedOrder?.followupUpdatedBy, '当前采购员');
    assert.equal(followedOrder?.fulfillmentRemark, '普通用户本周跟进');

    const ordinaryResubmitRequestId = 'progress-ordinary-test-002';
    const ordinaryResubmitResponse = await fetch(progressEndpoint, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer purchase-owner-token',
        'Content-Type': 'application/json',
        'X-Idempotency-Key': ordinaryResubmitRequestId
      },
      body: JSON.stringify({
        ...progressIdentity,
        requestId: ordinaryResubmitRequestId,
        unpreparedQty: 0,
        preparedNotStartedQty: 120,
        inProductionQty: 280,
        finishedQty: 200,
        productionDeliveryDate: '2026.9.11',
        unproducedEstimatedDeliveryDate: '2026年8月21日',
        fulfillmentStatus: '否',
        unfulfilledReason: '供应商延期',
        reasonDetail: '原料延期后再次确认',
        fulfillmentRemark: '普通用户本周再次跟进'
      })
    });
    assert.equal(ordinaryResubmitResponse.status, 200);
    const ordinaryResubmitPayload = await ordinaryResubmitResponse.json();
    assert.equal(ordinaryResubmitPayload.followupMarkedBySubmission, true);
    assert.equal(ordinaryResubmitPayload.followupPreviouslyThisWeek, true);
    assert.equal(ordinaryResubmitPayload.followupStatus, '本周已跟进');
    const resubmittedRowsResponse = await fetch(`http://127.0.0.1:${port}/api/progress/demands`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    const resubmittedOrder = (await resubmittedRowsResponse.json()).rows.find((row) => row.followupKey === m1Demand.followupKey);
    assert.equal(resubmittedOrder?.followupStatus, '本周已跟进');
    assert.equal(resubmittedOrder?.fulfillmentRemark, '普通用户本周再次跟进');
    assert.equal(resubmittedOrder?.productionDeliveryDate, '2026-09-11');
    assert.equal(resubmittedOrder?.unproducedEstimatedDeliveryDate, '2026-08-21');

    const adminPreserveRequestId = 'progress-admin-preserve-001';
    const adminPreserveResponse = await fetch(progressEndpoint, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer admin-token',
        'Content-Type': 'application/json',
        'X-Idempotency-Key': adminPreserveRequestId
      },
      body: JSON.stringify({
        ...progressIdentity,
        requestId: adminPreserveRequestId,
        preparedNotStartedQty: 100,
        inProductionQty: 300,
        finishedQty: 200,
        fulfillmentStatus: '否',
        unfulfilledReason: '供应商延期',
        reasonDetail: '原料延期',
        fulfillmentRemark: '管理员更新跟单备注'
      })
    });
    assert.equal(adminPreserveResponse.status, 200);
    const adminPreservePayload = await adminPreserveResponse.json();
    assert.equal(adminPreservePayload.followupMarkedBySubmission, false);
    assert.equal(adminPreservePayload.followupStatus, '本周已跟进');
    const preservedRowsResponse = await fetch(`http://127.0.0.1:${port}/api/progress/demands`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    const preservedOrder = (await preservedRowsResponse.json()).rows.find((row) => row.followupKey === m1Demand.followupKey);
    assert.equal(preservedOrder?.followupUpdatedBy, '当前采购员');
    assert.equal(preservedOrder?.fulfillmentRemark, '管理员更新跟单备注');

    const manualProgressEndpoint = `http://127.0.0.1:${port}/api/progress/${encodeURIComponent('manual:manual-short-name-row')}`;
    const manualProgressRequestId = 'manual-progress-test-001';
    const manualProgressRequest = {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer admin-token',
        'Content-Type': 'application/json',
        'X-Idempotency-Key': manualProgressRequestId
      },
      body: JSON.stringify({
        requestId: manualProgressRequestId,
        trackingKey: 'manual:manual-short-name-row:CGDD012997',
        orderNo: 'CGDD012997',
        unpreparedQty: 10,
        preparedNotStartedQty: 0,
        inProductionQty: 0,
        finishedQty: 0,
        fulfillmentStatus: '是',
        fulfillmentRemark: '手工订单幂等测试'
      })
    };
    const manualProgressResponse = await fetch(manualProgressEndpoint, manualProgressRequest);
    assert.equal(manualProgressResponse.status, 200);
    const manualProgressPayload = await manualProgressResponse.json();
    assert.deepEqual({ ok: manualProgressPayload.ok, requestId: manualProgressPayload.requestId, replayed: manualProgressPayload.replayed }, {
      ok: true,
      requestId: manualProgressRequestId,
      replayed: false
    });
    assert.equal(manualProgressPayload.followupMarkedBySubmission, false);
    assert.equal(manualProgressPayload.followupStatus, '未跟进');
    assert.equal(Object.hasOwn(manualProgressPayload, 'rows'), false);
    const replayedManualProgressResponse = await fetch(manualProgressEndpoint, manualProgressRequest);
    assert.equal(replayedManualProgressResponse.status, 200);
    assert.equal((await replayedManualProgressResponse.json()).replayed, true);

    const manualOrdinaryRequestId = 'manual-progress-ordinary-001';
    const manualOrdinaryResponse = await fetch(
      `http://127.0.0.1:${port}/api/progress/${encodeURIComponent('manual:manual-unmatched-row')}`,
      {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer manual-owner-token',
        'Content-Type': 'application/json',
        'X-Idempotency-Key': manualOrdinaryRequestId
      },
      body: JSON.stringify({
        requestId: manualOrdinaryRequestId,
        trackingKey: 'manual:manual-unmatched-row:MANUAL-001',
        orderNo: 'MANUAL-001',
        unpreparedQty: 5,
        preparedNotStartedQty: 0,
        inProductionQty: 0,
        finishedQty: 0,
        fulfillmentStatus: '是',
        fulfillmentRemark: '手工订单普通用户跟进'
      })
    });
    assert.equal(manualOrdinaryResponse.status, 200);
    const manualOrdinaryPayload = await manualOrdinaryResponse.json();
    assert.equal(manualOrdinaryPayload.followupMarkedBySubmission, true);
    assert.equal(manualOrdinaryPayload.followupStatus, '本周已跟进');

    const manualOrdinaryResubmitRequestId = 'manual-progress-ordinary-002';
    const manualOrdinaryResubmitResponse = await fetch(
      `http://127.0.0.1:${port}/api/progress/${encodeURIComponent('manual:manual-unmatched-row')}`,
      {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer manual-owner-token',
        'Content-Type': 'application/json',
        'X-Idempotency-Key': manualOrdinaryResubmitRequestId
      },
      body: JSON.stringify({
        requestId: manualOrdinaryResubmitRequestId,
        trackingKey: 'manual:manual-unmatched-row:MANUAL-001',
        orderNo: 'MANUAL-001',
        unpreparedQty: 5,
        preparedNotStartedQty: 0,
        inProductionQty: 0,
        finishedQty: 0,
        productionDeliveryDate: '10/1/26',
        unproducedEstimatedDeliveryDate: '2026/10/15 00:00:00',
        fulfillmentStatus: '是',
        fulfillmentRemark: '手工订单普通用户再次跟进'
      })
    });
    assert.equal(manualOrdinaryResubmitResponse.status, 200);
    const manualOrdinaryResubmitPayload = await manualOrdinaryResubmitResponse.json();
    assert.equal(manualOrdinaryResubmitPayload.followupMarkedBySubmission, true);
    assert.equal(manualOrdinaryResubmitPayload.followupPreviouslyThisWeek, true);
    assert.equal(manualOrdinaryResubmitPayload.followupStatus, '本周已跟进');

    const sessionApplyResponse = await fetch(`http://127.0.0.1:${port}/api/difference-allocations/session-consistency/apply`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' }
    });
    assert.equal(sessionApplyResponse.status, 200);
    const sessionBatchId = (await sessionApplyResponse.json()).batchId;
    const sessionDiffsResponse = await fetch(`http://127.0.0.1:${port}/api/diffs`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    assert.equal(sessionDiffsResponse.status, 200);
    const sessionDiff = (await sessionDiffsResponse.json()).rows.find((row) => row.batch_id === sessionBatchId && row.demand_key === m1Demand.demandKey);
    assert.deepEqual(
      { diffType: sessionDiff?.diff_type, oldQty: sessionDiff?.old_qty, newQty: sessionDiff?.new_qty },
      { diffType: '数量增加', oldQty: 1200, newQty: 1300 }
    );
    const demandsAfterIncreaseResponse = await fetch(`http://127.0.0.1:${port}/api/demands`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    const demandsAfterIncreaseRows = (await demandsAfterIncreaseResponse.json()).rows;
    const increasedM1 = aggregateDemandRows(demandsAfterIncreaseRows, m1Demand.demandKey);
    const followedM1AfterReapply = demandsAfterIncreaseRows.find((row) => (
      row.materialCode === m1Demand.materialCode && row.orderNo === 'PO-SESSION'
    ));
    assert.equal(followedM1AfterReapply?.followupKey, 'order:PO-SESSION:M1');
    assert.equal(followedM1AfterReapply?.followupStatus, '未跟进');
    assert.deepEqual({
      unpreparedQty: increasedM1?.unpreparedQty,
      preparedNotStartedQty: increasedM1?.preparedNotStartedQty,
      inProductionQty: increasedM1?.inProductionQty,
      finishedQty: increasedM1?.finishedQty,
      progressTotal: increasedM1?.progressTotal,
      progressAdjustmentRequired: increasedM1?.progressAdjustmentRequired,
      fulfillmentStatus: increasedM1?.fulfillmentStatus,
      unfulfilledReason: increasedM1?.unfulfilledReason
    }, {
      unpreparedQty: 0,
      preparedNotStartedQty: 100,
      inProductionQty: 300,
      finishedQty: 200,
      progressTotal: 600,
      progressAdjustmentRequired: true,
      fulfillmentStatus: '否',
      unfulfilledReason: '供应商延期'
    });

    const normalProgressResponse = await fetch(progressEndpoint, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackingKey: followedM1AfterReapply?.followupKey,
        orderNo: followedM1AfterReapply?.orderNo,
        unpreparedQty: 100,
        preparedNotStartedQty: 100,
        inProductionQty: 500,
        finishedQty: 400,
        shippedQty: 200,
        productionDeliveryDate: '2026-09-10',
        unproducedEstimatedDeliveryDate: '2026-08-20',
        fulfillmentStatus: '是',
        remark: 'normal'
      })
    });
    assert.equal(normalProgressResponse.status, 200);
    const normalProgressPayload = await normalProgressResponse.json();
    assert.equal(normalProgressPayload.ok, true);
    assert.equal(normalProgressPayload.followupMarkedBySubmission, false);
    assert.equal(normalProgressPayload.followupStatus, '未跟进');
    assert.equal(Object.hasOwn(normalProgressPayload, 'rows'), false);
    const normalM1 = await readSavedProgress();
    assert.deepEqual({
      unpreparedQty: normalM1?.unpreparedQty,
      progressTotal: normalM1?.progressTotal,
      progressAdjustmentRequired: normalM1?.progressAdjustmentRequired,
      fulfillmentStatus: normalM1?.fulfillmentStatus,
      normalFulfillmentQty: normalM1?.normalFulfillmentQty,
      abnormalFulfillmentQty: normalM1?.abnormalFulfillmentQty
    }, {
      unpreparedQty: 100,
      progressTotal: 1100,
      progressAdjustmentRequired: false,
      fulfillmentStatus: '是',
      normalFulfillmentQty: 1100,
      abnormalFulfillmentQty: 0
    });

    const emptyProgressClearPreview = await fetch(`http://127.0.0.1:${port}/api/progress/clear-preview`, {
      method: 'POST',
      headers: { Authorization: 'Bearer system-owner-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(emptyProgressClearPreview.status, 400);

    const otherAdminProgressClearPreview = await fetch(`http://127.0.0.1:${port}/api/progress/clear-preview`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ suppliers: [m1Demand.supplier] })
    });
    assert.equal(otherAdminProgressClearPreview.status, 403);
    assert.deepEqual(await otherAdminProgressClearPreview.json(), { error: '仅管理员孙立柱可操作' });

    const fullSupplierClearPreview = await fetch(`http://127.0.0.1:${port}/api/progress/clear-preview`, {
      method: 'POST',
      headers: { Authorization: 'Bearer system-owner-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ suppliers: [m1Demand.supplier] })
    });
    assert.equal(fullSupplierClearPreview.status, 200);
    assert.equal((await fullSupplierClearPreview.json()).matchedDemands, 0);

    const progressClearFilters = {
      purchaseOwners: [m1Demand.purchaseOwner],
      suppliers: [m1Demand.orderSupplierShortName],
      productLines: [m1Demand.productLine],
      productSeries: [m1Demand.productSeries]
    };
    const progressClearPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/progress/clear-preview`, {
      method: 'POST',
      headers: { Authorization: 'Bearer system-owner-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(progressClearFilters)
    });
    assert.equal(progressClearPreviewResponse.status, 200);
    const progressClearPreview = await progressClearPreviewResponse.json();
    assert.ok(progressClearPreview.matchedDemands >= 1);
    assert.ok(progressClearPreview.currentProgressCount >= 1);
    assert.ok(progressClearPreview.snapshotCount >= 1);

    const staleProgressClearResponse = await fetch(`http://127.0.0.1:${port}/api/progress/clear`, {
      method: 'POST',
      headers: { Authorization: 'Bearer system-owner-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...progressClearFilters,
        expectedCount: progressClearPreview.matchedDemands + 1,
        expectedCurrentProgressCount: progressClearPreview.currentProgressCount,
        expectedSnapshotCount: progressClearPreview.snapshotCount,
        confirmation: 'CLEAR_PROGRESS'
      })
    });
    assert.equal(staleProgressClearResponse.status, 409);

    const progressClearResponse = await fetch(`http://127.0.0.1:${port}/api/progress/clear`, {
      method: 'POST',
      headers: { Authorization: 'Bearer system-owner-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...progressClearFilters,
        expectedCount: progressClearPreview.matchedDemands,
        expectedCurrentProgressCount: progressClearPreview.currentProgressCount,
        expectedSnapshotCount: progressClearPreview.snapshotCount,
        confirmation: 'CLEAR_PROGRESS'
      })
    });
    assert.equal(progressClearResponse.status, 200);
    const progressClearResult = await progressClearResponse.json();
    assert.equal(progressClearResult.clearedDemands, progressClearPreview.matchedDemands);
    assert.equal(progressClearResult.clearedCurrentProgress, progressClearPreview.currentProgressCount);
    assert.equal(progressClearResult.clearedSnapshots, progressClearPreview.snapshotCount);
    const demandsAfterProgressClear = await fetch(`http://127.0.0.1:${port}/api/demands`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    const rowsAfterProgressClear = (await demandsAfterProgressClear.json()).rows;
    const clearedM1 = aggregateDemandRows(rowsAfterProgressClear, m1Demand.demandKey);
    assert.equal(clearedM1?.inProductionQty, 0);
    assert.equal(clearedM1?.finishedQty, 0);
    assert.equal(clearedM1?.unpreparedQty, 0);
    assert.equal(clearedM1?.preparedNotStartedQty, 0);
    assert.equal(clearedM1?.fulfillmentStatus, '');
    assert.equal(clearedM1?.unfulfilledReason, '');
    assert.equal(clearedM1?.remark, '');
    assert.equal(clearedM1?.progressUpdatedAt, '');
    assert.equal(rowsAfterProgressClear.find((row) => row.followupKey === followedM1AfterReapply.followupKey)?.followupStatus, '未跟进');

    const inventoryWorkbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(inventoryWorkbook, xlsx.utils.json_to_sheet([
      {
        店铺: 'US Store',
        站点: 'US',
        SKU: 'SKU-FBA-1',
        事业部: '海外事业一部',
        物料编码: 'M-FBA-1',
        FNSKU: 'FNSKU-1',
        ASIN: 'ASIN-1',
        仓库名称: 'FBA Warehouse',
        库存属性: '可售',
        '期末库存(含移仓)-数量': '1,036',
        不应持久化字段: 'large-unused-value'
      }
    ]), 'FBA库存');
    const inventoryInspectForms = Array.from({ length: 3 }, (_, index) => {
      const form = new FormData();
      form.append('slotId', `inventoryManualFile${index + 1}`);
      form.append(
        'file',
        new Blob([xlsx.write(inventoryWorkbook, { type: 'buffer', bookType: 'xlsx' })]),
        `库存并发预览${index + 1}.xlsx`
      );
      return form;
    });
    const inventoryInspectResponses = await Promise.all(inventoryInspectForms.map((body) => fetch(
      `http://127.0.0.1:${port}/api/workbook/inspect`,
      { method: 'POST', headers: { Authorization: 'Bearer admin-token' }, body }
    )));
    const inventoryInspectPayloads = await Promise.all(inventoryInspectResponses.map((response) => response.json()));
    inventoryInspectResponses.forEach((response, index) => {
      assert.equal(response.status, 200, `${JSON.stringify(inventoryInspectPayloads[index])}\n${logs.join('')}`);
      assert.equal(inventoryInspectPayloads[index].streaming, true);
      assert.equal(inventoryInspectPayloads[index].rowCount, 1);
      assert.deepEqual(inventoryInspectPayloads[index].sheetNames, ['FBA库存']);
    });
    const inventoryForm = new FormData();
    inventoryForm.append(
      'file',
      new Blob([xlsx.write(inventoryWorkbook, { type: 'buffer', bookType: 'xlsx' })]),
      'FBA库存报表.xlsx'
    );
    inventoryForm.append('mapping', JSON.stringify({
      storeName: '店铺',
      marketplace: '站点',
      sku: 'SKU',
      fnsku: 'FNSKU',
      asin: 'ASIN',
      warehouseName: '仓库名称',
      inventoryAttribute: '库存属性',
      endingInventoryQty: '期末库存(含移仓)-数量'
    }));
    const inventoryUploadResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions/inventorySummaryFile1/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: inventoryForm
    });
    const inventoryUploadPayload = await inventoryUploadResponse.json();
    assert.equal(inventoryUploadResponse.status, 200, `${JSON.stringify(inventoryUploadPayload)}\n${logs.join('')}`);
    assert.equal(inventoryUploadPayload.rowCount, 1);
    assert.equal(Object.hasOwn(inventoryUploadPayload, 'rows'), false);

    const manualInventoryForm = new FormData();
    manualInventoryForm.append(
      'file',
      new Blob([xlsx.write(inventoryWorkbook, { type: 'buffer', bookType: 'xlsx' })]),
      'FBA库存报表手工.xlsx'
    );
    manualInventoryForm.append('mapping', JSON.stringify({
      businessUnit: '事业部',
      materialCode: '物料编码',
      quantity: '期末库存(含移仓)-数量'
    }));
    const manualInventoryUploadResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions/inventoryManualFile1/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: manualInventoryForm
    });
    const manualInventoryUploadPayload = await manualInventoryUploadResponse.json();
    assert.equal(manualInventoryUploadResponse.status, 200, `${JSON.stringify(manualInventoryUploadPayload)}\n${logs.join('')}`);
    assert.equal(manualInventoryUploadPayload.rowCount, 1);
    assert.equal(Object.hasOwn(manualInventoryUploadPayload, 'rows'), false);

    const invalidInventoryWorkbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(invalidInventoryWorkbook, xlsx.utils.aoa_to_sheet([
      ['SKU', '仓库名称', '库存属性', '期末库存(含移仓)-数量'],
      ['SKU-BAD', '仓库', '全部', 999]
    ]), '工作表1');
    xlsx.utils.book_append_sheet(invalidInventoryWorkbook, xlsx.utils.aoa_to_sheet([['多余工作表']]), '工作表2');
    const invalidInventoryForm = new FormData();
    invalidInventoryForm.append(
      'file',
      new Blob([xlsx.write(invalidInventoryWorkbook, { type: 'buffer', bookType: 'xlsx' })]),
      '不应替换旧数据.xlsx'
    );
    const invalidInventoryResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions/inventorySummaryFile1/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: invalidInventoryForm
    });
    assert.equal(invalidInventoryResponse.status, 400);
    assert.match((await invalidInventoryResponse.json()).error, /只包含一个工作表/);

    const transitWarehouseWorkbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(transitWarehouseWorkbook, xlsx.utils.json_to_sheet([{
      主体: '美国主体',
      店铺: 'US-FBA-TRANSIT',
      金蝶仓库名称: '美国FBA在途仓',
      无关字段: 'do-not-store'
    }]), '仓库对照');
    const transitWarehouseForm = new FormData();
    transitWarehouseForm.append(
      'file',
      new Blob([xlsx.write(transitWarehouseWorkbook, { type: 'buffer', bookType: 'xlsx' })]),
      'FBA在途仓库对照.xlsx'
    );
    transitWarehouseForm.append('mapping', JSON.stringify({
      subject: '主体',
      storeName: '店铺',
      kingdeeWarehouseName: '金蝶仓库名称'
    }));
    const transitWarehouseUploadResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions/inventorySummaryFile13/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: transitWarehouseForm
    });
    const transitWarehouseUploadPayload = await transitWarehouseUploadResponse.json();
    assert.equal(transitWarehouseUploadResponse.status, 200, `${JSON.stringify(transitWarehouseUploadPayload)}\n${logs.join('')}`);
    assert.equal(transitWarehouseUploadPayload.rowCount, 1);

    const inventoryDimensionsResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    assert.equal(inventoryDimensionsResponse.status, 200);
    const inventoryDimensionRows = (await inventoryDimensionsResponse.json()).rows;
    const inventoryRecord = inventoryDimensionRows.find((row) => row.slot_id === 'inventorySummaryFile1');
    assert.deepEqual(
      { title: inventoryRecord?.title, rowCount: inventoryRecord?.rowCount, fileName: inventoryRecord?.file_name },
      { title: 'FBA库存报表', rowCount: 1, fileName: 'FBA库存报表.xlsx' }
    );
    const manualInventoryRecord = inventoryDimensionRows.find((row) => row.slot_id === 'inventoryManualFile1');
    assert.deepEqual(
      { title: manualInventoryRecord?.title, rowCount: manualInventoryRecord?.rowCount, fileName: manualInventoryRecord?.file_name },
      { title: 'FBA库存报表手工', rowCount: 1, fileName: 'FBA库存报表手工.xlsx' }
    );
    assert.deepEqual(
      {
        businessUnit: manualInventoryRecord?.mapping?.businessUnit,
        materialCode: manualInventoryRecord?.mapping?.materialCode,
        quantity: manualInventoryRecord?.mapping?.quantity
      },
      { businessUnit: '事业部', materialCode: '物料编码', quantity: '期末库存(含移仓)-数量' }
    );
    assert.equal(Object.hasOwn(manualInventoryRecord?.mapping || {}, 'endingInventoryQty'), false);
    const transitWarehouseRecord = inventoryDimensionRows.find((row) => row.slot_id === 'inventorySummaryFile13');
    assert.deepEqual(
      { title: transitWarehouseRecord?.title, rowCount: transitWarehouseRecord?.rowCount },
      { title: 'Dim-领星FBA在途&金蝶仓库', rowCount: 1 }
    );

    const forecastWorkbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(forecastWorkbook, xlsx.utils.json_to_sheet([
      { 月份: '2026-08', SKU: 'SKU-A', 预测数量: 10 }
    ]), '预测A');
    xlsx.utils.book_append_sheet(forecastWorkbook, xlsx.utils.json_to_sheet([
      { 月份: '2026-09', SKU: 'SKU-B', 预测数量: 20 }
    ]), '预测B');
    const forecastBuffer = xlsx.write(forecastWorkbook, { type: 'buffer', bookType: 'xlsx' });
    const forecastInspectForm = new FormData();
    forecastInspectForm.append('slotId', 'inventorySummaryFile15');
    forecastInspectForm.append('file', new Blob([forecastBuffer]), '销售预测.xlsx');
    const forecastInspectResponse = await fetch(`http://127.0.0.1:${port}/api/workbook/inspect`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: forecastInspectForm
    });
    const forecastInspection = await forecastInspectResponse.json();
    assert.equal(forecastInspectResponse.status, 200);
    assert.equal(forecastInspection.lightweight, true);
    assert.deepEqual(forecastInspection.sheetNames, ['预测A', '预测B']);
    assert.equal(forecastInspection.rowCount, null);
    const unselectedForecastForm = new FormData();
    unselectedForecastForm.append('file', new Blob([forecastBuffer]), '销售预测.xlsx');
    const unselectedForecastResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions/inventorySummaryFile15/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: unselectedForecastForm
    });
    assert.equal(unselectedForecastResponse.status, 400);
    assert.match((await unselectedForecastResponse.json()).error, /包含多个工作表，请先选择/);

    const selectedForecastForm = new FormData();
    selectedForecastForm.append('file', new Blob([forecastBuffer]), '销售预测.xlsx');
    selectedForecastForm.append('sheetName', '预测B');
    const selectedForecastResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions/inventorySummaryFile15/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: selectedForecastForm
    });
    const selectedForecastPayload = await selectedForecastResponse.json();
    assert.equal(selectedForecastResponse.status, 200, `${JSON.stringify(selectedForecastPayload)}\n${logs.join('')}`);
    assert.deepEqual({
      rowCount: selectedForecastPayload.rowCount,
      sheetName: selectedForecastPayload.sheetName,
      sheetNames: selectedForecastPayload.sheetNames
    }, {
      rowCount: 1,
      sheetName: '预测B',
      sheetNames: ['预测A', '预测B']
    });

    const forecastDimensionsResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    const forecastRecord = (await forecastDimensionsResponse.json()).rows.find((row) => row.slot_id === 'inventorySummaryFile15');
    assert.deepEqual({
      title: forecastRecord?.title,
      sheetName: forecastRecord?.sheet_name,
      rowCount: forecastRecord?.rowCount
    }, {
      title: '销售预测',
      sheetName: '预测B',
      rowCount: 1
    });
    const forecastDatabase = new SQL.Database(readFileSync(path.join(dataDir, 'gendanjindu.sqlite')));
    const forecastStatement = forecastDatabase.prepare('SELECT rows_json FROM dimension_files WHERE slot_id = ?');
    forecastStatement.bind(['inventorySummaryFile15']);
    assert.equal(forecastStatement.step(), true);
    assert.deepEqual(JSON.parse(forecastStatement.getAsObject().rows_json), [{ 月份: '2026-09', SKU: 'SKU-B', 预测数量: '20' }]);
    forecastStatement.free();
    forecastDatabase.close();

    const agingWorkbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(agingWorkbook, xlsx.utils.json_to_sheet([
      { 物料编码: 'AGING-A', 库龄: '0-30天', 数量: 10 }
    ]), '国内库龄');
    xlsx.utils.book_append_sheet(agingWorkbook, xlsx.utils.json_to_sheet([
      { 物料编码: 'AGING-B', 库龄: '31-60天', 数量: 20 }
    ]), '跨境库龄');
    xlsx.utils.book_append_sheet(agingWorkbook, xlsx.utils.json_to_sheet([
      { 物料编码: 'AGING-C', 库龄: '61天以上', 数量: 30 }
    ]), '说明');
    const agingBuffer = xlsx.write(agingWorkbook, { type: 'buffer', bookType: 'xlsx' });
    const agingInspectForm = new FormData();
    agingInspectForm.append('slotId', 'inventorySummaryFile16');
    agingInspectForm.append('file', new Blob([agingBuffer]), '库龄文件.xlsx');
    const agingInspectResponse = await fetch(`http://127.0.0.1:${port}/api/workbook/inspect`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: agingInspectForm
    });
    const agingInspection = await agingInspectResponse.json();
    assert.equal(agingInspectResponse.status, 200);
    assert.equal(agingInspection.lightweight, true);
    assert.deepEqual(agingInspection.sheetNames, ['国内库龄', '跨境库龄', '说明']);

    const oneAgingSheetForm = new FormData();
    oneAgingSheetForm.append('file', new Blob([agingBuffer]), '库龄文件.xlsx');
    oneAgingSheetForm.append('sheetNames', JSON.stringify(['国内库龄']));
    const oneAgingSheetResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions/inventorySummaryFile16/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: oneAgingSheetForm
    });
    assert.equal(oneAgingSheetResponse.status, 400);
    assert.match((await oneAgingSheetResponse.json()).error, /必须选择两个工作表/);

    const invalidAgingSheetForm = new FormData();
    invalidAgingSheetForm.append('file', new Blob([agingBuffer]), '库龄文件.xlsx');
    invalidAgingSheetForm.append('sheetNames', JSON.stringify(['国内库龄', '不存在']));
    const invalidAgingSheetResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions/inventorySummaryFile16/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: invalidAgingSheetForm
    });
    assert.equal(invalidAgingSheetResponse.status, 400);
    assert.match((await invalidAgingSheetResponse.json()).error, /工作表不存在/);

    const selectedAgingSheetsForm = new FormData();
    selectedAgingSheetsForm.append('file', new Blob([agingBuffer]), '库龄文件.xlsx');
    selectedAgingSheetsForm.append('sheetNames', JSON.stringify(['国内库龄', '跨境库龄']));
    const selectedAgingSheetsResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions/inventorySummaryFile16/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: selectedAgingSheetsForm
    });
    const selectedAgingSheetsPayload = await selectedAgingSheetsResponse.json();
    assert.equal(selectedAgingSheetsResponse.status, 200, `${JSON.stringify(selectedAgingSheetsPayload)}\n${logs.join('')}`);
    assert.deepEqual({
      rowCount: selectedAgingSheetsPayload.rowCount,
      selectedSheetNames: selectedAgingSheetsPayload.selectedSheetNames,
      sheetNames: selectedAgingSheetsPayload.sheetNames
    }, {
      rowCount: 2,
      selectedSheetNames: ['国内库龄', '跨境库龄'],
      sheetNames: ['国内库龄', '跨境库龄', '说明']
    });

    const agingDimensionsResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    const agingRecord = (await agingDimensionsResponse.json()).rows.find((row) => row.slot_id === 'inventorySummaryFile16');
    assert.deepEqual({
      title: agingRecord?.title,
      selectedSheetNames: agingRecord?.selectedSheetNames,
      rowCount: agingRecord?.rowCount
    }, {
      title: '库龄文件',
      selectedSheetNames: ['国内库龄', '跨境库龄'],
      rowCount: 2
    });

    const agingDatabase = new SQL.Database(readFileSync(path.join(dataDir, 'gendanjindu.sqlite')));
    const agingStatement = agingDatabase.prepare('SELECT rows_json, selected_sheet_names FROM dimension_files WHERE slot_id = ?');
    agingStatement.bind(['inventorySummaryFile16']);
    assert.equal(agingStatement.step(), true);
    const storedAging = agingStatement.getAsObject();
    agingStatement.free();
    agingDatabase.close();
    assert.deepEqual(JSON.parse(storedAging.selected_sheet_names), ['国内库龄', '跨境库龄']);
    assert.deepEqual(JSON.parse(storedAging.rows_json).map((row) => row.__sourceSheet), ['国内库龄', '跨境库龄']);

    const inventoryDatabase = new SQL.Database(readFileSync(path.join(dataDir, 'gendanjindu.sqlite')));
    const inventoryStatement = inventoryDatabase.prepare('SELECT rows_json FROM dimension_files WHERE slot_id = ?');
    inventoryStatement.bind(['inventorySummaryFile1']);
    assert.equal(inventoryStatement.step(), true);
    const storedInventoryRows = JSON.parse(inventoryStatement.getAsObject().rows_json);
    inventoryStatement.free();
    const transitWarehouseStatement = inventoryDatabase.prepare('SELECT rows_json FROM dimension_files WHERE slot_id = ?');
    transitWarehouseStatement.bind(['inventorySummaryFile13']);
    assert.equal(transitWarehouseStatement.step(), true);
    assert.deepEqual(JSON.parse(transitWarehouseStatement.getAsObject().rows_json), [{
      subject: '美国主体',
      storeName: 'US-FBA-TRANSIT',
      kingdeeWarehouseName: '美国FBA在途仓'
    }]);
    transitWarehouseStatement.free();
    inventoryDatabase.close();
    assert.deepEqual(storedInventoryRows, [{
      storeName: 'US Store',
      marketplace: 'US',
      sku: 'SKU-FBA-1',
      warehouseName: 'FBA Warehouse',
      inventoryAttribute: '可售',
      endingInventoryQty: '1,036'
    }]);

    const fbaCompletenessWorkbook = xlsx.utils.book_new();
    const fbaMissingQuantities = [1, 1, 1, 1, 1, 1, 1, 1, 6, 24, 146, 273, 71, 22, 3];
    xlsx.utils.book_append_sheet(fbaCompletenessWorkbook, xlsx.utils.json_to_sheet([
      ...fbaMissingQuantities.map((quantity, index) => ({
        SKU: `MISSING-SKU-${index + 1}`,
        仓库: '国源欧洲-PL波兰仓',
        库存属性: '全部',
        '期末库存(含移仓)-数量': quantity
      })),
      {
        SKU: 'MISSING-SKU-ZERO',
        仓库: '国源欧洲-PL波兰仓',
        库存属性: '全部',
        '期末库存(含移仓)-数量': 0
      }
    ]), 'FBA库存');
    const fbaCompletenessForm = new FormData();
    fbaCompletenessForm.append(
      'file',
      new Blob([xlsx.write(fbaCompletenessWorkbook, { type: 'buffer', bookType: 'xlsx' })]),
      '【FBA在库】库存报表-FBA仓-明细-202607300925.xlsx'
    );
    const fbaCompletenessResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions/inventorySummaryFile1/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: fbaCompletenessForm
    });
    const fbaCompletenessPayload = await fbaCompletenessResponse.json();
    assert.equal(fbaCompletenessResponse.status, 200, `${JSON.stringify(fbaCompletenessPayload)}\n${logs.join('')}`);
    assert.equal(fbaCompletenessPayload.rowCount, 15);
    assert.deepEqual(
      {
        sourceRows: fbaCompletenessPayload.parseSummary?.sourceRowCount,
        parserVersion: fbaCompletenessPayload.parseSummary?.parserVersion,
        validRows: fbaCompletenessPayload.parseSummary?.fbaScopeRows,
        validQty: fbaCompletenessPayload.parseSummary?.fbaScopeQuantity,
        blankSkuRows: fbaCompletenessPayload.parseSummary?.fbaBlankSkuRows,
        blankSkuQty: fbaCompletenessPayload.parseSummary?.fbaBlankSkuQuantity,
        filteredZeroRows: fbaCompletenessPayload.parseSummary?.filteredZeroQtyRows
      },
      { sourceRows: 16, parserVersion: 4, validRows: 15, validQty: 553, blankSkuRows: 0, blankSkuQty: 0, filteredZeroRows: 1 }
    );

    const fbaDiagnosticsResponse = await fetch(`http://127.0.0.1:${port}/api/dimension-missing/cross-border`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    const fbaDiagnosticsPayload = await fbaDiagnosticsResponse.json();
    assert.equal(fbaDiagnosticsResponse.status, 200, `${JSON.stringify(fbaDiagnosticsPayload)}\n${logs.join('')}`);
    const fbaMissingSkuIssues = fbaDiagnosticsPayload.inventorySummaryIssues.filter((row) => (
      row.sourceType === 'FBA库存'
      && row.targetSlotId === 'inventorySummaryFile10'
      && row.sourceWarehouseName === '国源欧洲-PL波兰仓'
    ));
    assert.equal(fbaMissingSkuIssues.length, 15);
    assert.equal(fbaMissingSkuIssues.reduce((sum, row) => sum + row.qty, 0), 553);
    const fbaSourceApplication = fbaDiagnosticsPayload.sourceApplications.find((row) => row.slotId === 'inventorySummaryFile1');
    assert.deepEqual(
      {
        fileName: fbaSourceApplication?.fileName,
        rows: fbaSourceApplication?.parseSummary?.fbaScopeRows,
        quantity: fbaSourceApplication?.parseSummary?.fbaScopeQuantity
      },
      {
        fileName: '【FBA在库】库存报表-FBA仓-明细-202607300925.xlsx',
        rows: 15,
        quantity: 553
      }
    );

    const refreshedSkuWorkbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(refreshedSkuWorkbook, xlsx.utils.json_to_sheet(
      fbaMissingQuantities.map((_, index) => ({
        '*SKU': `MISSING-SKU-${index + 1}`,
        识别码: `REFRESHED-MATERIAL-${index + 1}`
      }))
    ), 'SKU映射');
    const refreshedSkuForm = new FormData();
    refreshedSkuForm.append(
      'file',
      new Blob([xlsx.write(refreshedSkuWorkbook, { type: 'buffer', bookType: 'xlsx' })]),
      'Dim-领星SKU对应物料编码-产品管理.xlsx'
    );
    const refreshedSkuResponse = await fetch(`http://127.0.0.1:${port}/api/dimensions/inventorySummaryFile10/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: refreshedSkuForm
    });
    const refreshedSkuPayload = await refreshedSkuResponse.json();
    assert.equal(refreshedSkuResponse.status, 200, `${JSON.stringify(refreshedSkuPayload)}\n${logs.join('')}`);
    assert.equal(refreshedSkuPayload.rowCount, 15);

    const refreshedDiagnosticsResponse = await fetch(`http://127.0.0.1:${port}/api/dimension-missing/cross-border?refresh=${Date.now()}`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    const refreshedDiagnosticsPayload = await refreshedDiagnosticsResponse.json();
    assert.equal(refreshedDiagnosticsResponse.status, 200, `${JSON.stringify(refreshedDiagnosticsPayload)}\n${logs.join('')}`);
    const staleSkuIssues = refreshedDiagnosticsPayload.inventorySummaryIssues.filter((row) => (
      row.sourceType === 'FBA库存'
      && row.targetSlotId === 'inventorySummaryFile10'
      && row.sourceWarehouseName === '国源欧洲-PL波兰仓'
    ));
    assert.equal(staleSkuIssues.length, 0);

    const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Admin', password: adminPassword })
    });
    assert.equal(loginResponse.status, 200);
    const loginPayload = await loginResponse.json();
    const loggedInBootstrap = await fetch(`http://127.0.0.1:${port}/api/bootstrap`, {
      headers: { Authorization: `Bearer ${loginPayload.token}` }
    });
    assert.equal(loggedInBootstrap.status, 200);
    const loggedInBootstrapPayload = await loggedInBootstrap.json();
    assert.equal(loggedInBootstrapPayload.pages.inventoryPurchase, '采购未交付');
    assert.ok(loggedInBootstrapPayload.user.pageAccess.includes('inventoryPurchase'));
    assert.equal(loggedInBootstrapPayload.dimensionSlots.inventorySummaryFile13, 'Dim-领星FBA在途&金蝶仓库');
    assert.equal(loggedInBootstrapPayload.dimensionSlots.inventorySummaryFile10, 'Dim-领星SKU对应物料编码-产品管理');
    assert.equal(loggedInBootstrapPayload.dimensionSlots.inventorySummaryFile15, '销售预测');
    assert.equal(loggedInBootstrapPayload.dimensionSlots.inventorySummaryFile16, '库龄文件');

    const persistedDatabase = new SQL.Database(readFileSync(path.join(dataDir, 'gendanjindu.sqlite')));
    const sessionStatement = persistedDatabase.prepare('SELECT created_at, expires_at FROM sessions WHERE token = ?');
    sessionStatement.bind([loginPayload.token]);
    assert.equal(sessionStatement.step(), true);
    const persistedSession = sessionStatement.getAsObject();
    sessionStatement.free();
    const expiredStatement = persistedDatabase.prepare('SELECT COUNT(*) AS count FROM sessions WHERE token = ?');
    expiredStatement.bind(['expired-token']);
    expiredStatement.step();
    assert.equal(expiredStatement.getAsObject().count, 0);
    expiredStatement.free();
    persistedDatabase.close();
    const sessionDurationMs = new Date(String(persistedSession.expires_at).replace(' ', 'T')).getTime()
      - new Date(String(persistedSession.created_at).replace(' ', 'T')).getTime();
    assert.ok(sessionDurationMs >= 24 * 60 * 60 * 1000 - 1000);
    assert.ok(sessionDurationMs <= 24 * 60 * 60 * 1000 + 1000);

    for (let attempt = 0; attempt < 9; attempt += 1) {
      const failedLogin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Admin', password: `wrong-password-${attempt}` })
      });
      assert.equal(failedLogin.status, 401);
    }
    const rateLimitedLogin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Admin', password: 'wrong-password-rate-limited' })
    });
    assert.equal(rateLimitedLogin.status, 429);
    assert.deepEqual(await rateLimitedLogin.json(), { error: '登录尝试过多，请15分钟后再试' });

    const legacyApplyResponse = await fetch(`http://127.0.0.1:${port}/api/imports/kingdee/apply`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' }
    });
    assert.equal(legacyApplyResponse.status, 410);

    const validWorkbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(validWorkbook, xlsx.utils.json_to_sheet([
      { 说明: '采购订单导出说明页' },
      { 说明: '该页不应被识别为采购订单数据' }
    ]), '说明');
    xlsx.utils.book_append_sheet(validWorkbook, xlsx.utils.json_to_sheet([{
      自定义日期: new Date('2026-07-22T00:00:00Z'),
      自定义供应商: 'Auto Supplier',
      自定义物料: 'AUTO-001',
      自定义数量: 12
    }]), '采购订单');
    const validForm = new FormData();
    validForm.append('file', new Blob([xlsx.write(validWorkbook, { type: 'buffer', bookType: 'xlsx' })]), '自动应用测试.xlsx');
    const autoApplyResponse = await fetch(`http://127.0.0.1:${port}/api/imports/kingdee/new-snapshot`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: validForm
    });
    const autoApplyPayload = await autoApplyResponse.json();
    assert.equal(autoApplyResponse.status, 200, `${JSON.stringify(autoApplyPayload)}\n${logs.join('')}`);
    assert.equal(autoApplyPayload.rowCount, 1);

    const statusAfterValid = await fetch(`http://127.0.0.1:${port}/api/imports/kingdee/current-status`, {
      headers: { Authorization: 'Bearer admin-token' }
    }).then((response) => response.json());
    assert.equal(statusAfterValid.current.fileName, '自动应用测试.xlsx');
    assert.equal(statusAfterValid.current.activeRows, 1);

    async function uploadReplacementSnapshot(index) {
      const workbook = xlsx.utils.book_new();
      const rowCount = index === 2 ? 25000 : 1;
      const rows = Array.from({ length: rowCount }, (_unused, rowIndex) => ({
        自定义日期: `2026-07-${22 + index}`,
        自定义供应商: `Replacement Supplier ${index}`,
        自定义物料: `AUTO-00${index}`,
        自定义数量: 10 + index,
        ...Object.fromEntries(Array.from(
          { length: 12 },
          (_empty, columnIndex) => [`无关字段${columnIndex + 1}`, `extra-${rowIndex}-${columnIndex}`]
        ))
      }));
      xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rows), '采购订单列表');
      const form = new FormData();
      form.append('file', new Blob([xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx', bookSST: true })]), `替换快照-${index}.xlsx`);
      return fetch(`http://127.0.0.1:${port}/api/imports/kingdee/new-snapshot`, {
        method: 'POST',
        headers: { Authorization: 'Bearer admin-token' },
        body: form
      });
    }

    assert.equal((await uploadReplacementSnapshot(2)).status, 200);
    assert.equal((await uploadReplacementSnapshot(3)).status, 200);

    const persistedOrderDatabase = new SQL.Database(readFileSync(path.join(dataDir, 'gendanjindu.sqlite')));
    const persistedOrderSummary = persistedOrderDatabase.exec(
      'SELECT COUNT(*) AS row_count, COUNT(DISTINCT batch_id) AS batch_count, MAX(LENGTH(raw_json)) AS max_raw_length FROM kingdee_orders'
    )[0];
    assert.equal(persistedOrderSummary.values[0][0], 25001);
    assert.equal(persistedOrderSummary.values[0][1], 2);
    assert.ok(persistedOrderSummary.values[0][2] < 500);
    persistedOrderDatabase.close();

    const invalidWorkbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(invalidWorkbook, xlsx.utils.json_to_sheet([{ 无效字段: '无有效采购订单' }]), '错误数据');
    const invalidForm = new FormData();
    invalidForm.append('file', new Blob([xlsx.write(invalidWorkbook, { type: 'buffer', bookType: 'xlsx' })]), '无效采购订单.xlsx');
    const rejectedResponse = await fetch(`http://127.0.0.1:${port}/api/imports/kingdee/new-snapshot`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: invalidForm
    });
    assert.equal(rejectedResponse.status, 400);

    const statusAfterRejected = await fetch(`http://127.0.0.1:${port}/api/imports/kingdee/current-status`, {
      headers: { Authorization: 'Bearer admin-token' }
    }).then((response) => response.json());
    assert.equal(statusAfterRejected.current.fileName, '替换快照-3.xlsx');
    assert.equal(statusAfterRejected.current.activeRows, 1);
  } finally {
    child.kill();
    if (child.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 3000))
      ]);
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
});
