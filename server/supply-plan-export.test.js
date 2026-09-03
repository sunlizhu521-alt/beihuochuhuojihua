import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  buildSupplyPlanExportData,
  buildSupplyPlanExportWorkbook,
  formatSupplyPlanExportDate,
  generateSupplyPlanExcel
} from './supply-plan-export.js';

const now = new Date('2026-09-03T02:00:00.000Z');
const settings = {
  channels: {
    overseasUs: {
      onHandSellableDays: 10,
      dispatchToShelfDays: 2,
      transportDays: 5,
      bookingDays: 3,
      averageLeadTimeDays: 8,
      contractSigningDays: 2,
      fullChainDays: 30,
      safetyDays: 30
    }
  }
};
const payload = {
  horizonMonths: 6,
  weeks: [{ key: '2026-W36', label: 'W36' }, { key: '2026-W37', label: 'W37' }],
  rows: [
    {
      modelKey: '护理床\u001f星云\u001fA1',
      productLine: '护理床', productSeries: '星云', model: 'A1', businessUnit: '海外事业一部',
      materialCode: '1001', sku: 'SKU-1', skuName: '护理床A1', productLifecycle: '主力',
      productPositioning: '核心', warehouses: ['101-US-海外仓'], channelKey: 'overseasUs', channel: '海外-美国',
      safetyDays: 30, onHandQty: 10, inTransitQty: 5, undeliveredQty: 3,
      inventoryRemainingQty: 11, purchaseGap: 8, weeklyForecast: [4, 6]
    },
    {
      modelKey: '轮椅\u001f标准\u001fB1',
      productLine: '轮椅', productSeries: '标准', model: 'B1', businessUnit: '国内事业部',
      materialCode: '2001', sku: 'SKU-2', channelKey: 'domestic', channel: '国内',
      onHandQty: 2, inTransitQty: 0, undeliveredQty: 0, inventoryRemainingQty: 1,
      purchaseGap: 0, weeklyForecast: [1, 1]
    }
  ]
};

function exportFixture() {
  return buildSupplyPlanExportData({
    supplyPlanData: payload,
    supplyPlanSettings: settings,
    assignmentRows: [{
      物料编码: '1001',
      产品线明细供应商: '供应商甲',
      产品线明细采购下单人: '采购员乙'
    }],
    filters: { businessUnit: '海外事业一部' },
    now
  });
}

test('导出数据遵循当前筛选并生成六个周指标行', () => {
  const data = exportFixture();
  assert.equal(data.modelCount, 1);
  assert.equal(data.childCount, 1);
  assert.equal(data.detailRows.length, 6);
  assert.equal(data.detailColumns.at(-2), '当前周');
  assert.equal(data.detailColumns.at(-1), 'W37');
  assert.deepEqual(data.detailRows.map((row) => row[17]), [
    '销售预测', '未交付', '在途', '在库', '库存剩余数量', '建议采购'
  ]);
  assert.deepEqual(data.detailRows.map((row) => row[18]), [4, 3, 5, 10, 11, 8]);
  assert.deepEqual(data.detailRows.map((row) => row[19]), [6, '', '', '', '', '']);
});

test('建议采购汇总只保留正数并关联采购分工与下单时间', () => {
  const data = exportFixture();
  assert.equal(data.purchaseRows.length, 1);
  assert.equal(data.purchaseRows[0][7], 8);
  assert.equal(data.purchaseRows[0][9], 'W36');
  assert.equal(data.purchaseRows[0][10], '供应商甲');
  assert.equal(data.purchaseRows[0][11], '采购员乙');
  const orderDate = data.purchaseRows[0][8];
  assert.deepEqual([orderDate.getFullYear(), orderDate.getMonth() + 1, orderDate.getDate()], [2026, 9, 23]);
  assert.equal(formatSupplyPlanExportDate(now), '2026-09-03');
});

test('生成的Excel包含双Sheet、冻结窗格与指标样式', async () => {
  const data = exportFixture();
  assert.deepEqual(buildSupplyPlanExportWorkbook(data).SheetNames, ['周维度备货计划', '建议采购汇总']);
  const buffer = await generateSupplyPlanExcel(data);
  assert.ok(buffer.byteLength > 1_000);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const detailSheet = workbook.getWorksheet('周维度备货计划');
  const purchaseSheet = workbook.getWorksheet('建议采购汇总');
  assert.equal(detailSheet.views[0].xSplit, 14);
  assert.equal(detailSheet.views[0].ySplit, 1);
  assert.equal(detailSheet.getCell('A1').fill.fgColor.argb, 'FFD9EAF7');
  assert.equal(detailSheet.getCell('A3').fill.fgColor.argb, 'FFFFF3CD');
  assert.equal(detailSheet.getCell('S7').font.color.argb, 'FFC00000');
  assert.equal(purchaseSheet.getCell('H2').font.color.argb, 'FFC00000');
  assert.equal(purchaseSheet.getCell('I2').numFmt, 'yyyy-mm-dd');
});
