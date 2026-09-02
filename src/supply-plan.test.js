import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySupplyPlanImport,
  buildSupplyPlanFilterOptions,
  buildSupplyPlanWeeks,
  calculateSupplyPlanRow,
  filterSupplyPlanRows,
  parseSupplyPlanWorksheet,
  supplyPlanRowKey
} from './supply-plan.js';

const rows = [
  { businessUnit: '海外事业一部', materialCode: '1001', sku: 'SKU-1', onHandQty: 100, inTransitQty: 20, safetyDays: 10 },
  { businessUnit: '海外事业二部', materialCode: '1001', sku: 'SKU-1', onHandQty: 50, inTransitQty: 10, safetyDays: 10 },
  { businessUnit: '国内事业部', materialCode: '2002', sku: 'SKU-2', onHandQty: 10, inTransitQty: 0, safetyDays: 5 }
];

test('供应计划固定生成2026年W32到W52共21周', () => {
  const weeks = buildSupplyPlanWeeks();
  assert.equal(weeks.length, 21);
  assert.deepEqual(weeks[0], {
    key: 'W32', label: 'W32', dateRange: '8/10-8/16', startDate: '2026-08-10', endDate: '2026-08-16'
  });
  assert.deepEqual(weeks.at(-1), {
    key: 'W52', label: 'W52', dateRange: '12/28-1/3', startDate: '2026-12-28', endDate: '2027-01-03'
  });
});

test('周预测支持W周和第X周表头且重复键以后出现的行为准', () => {
  const parsed = parseSupplyPlanWorksheet([
    ['SKU', 'W32', '第33周', '安全库存'],
    ['sku-1', 10, 20, 300],
    ['SKU-1', 30, 40, 500],
    ['SKU-9', 1, 2, '']
  ]);
  assert.equal(parsed.keyType, 'sku');
  assert.equal(parsed.entries.length, 2);
  assert.deepEqual(parsed.entries[0].forecast.slice(0, 3), [30, 40, 0]);
  assert.equal(parsed.entries[0].safetyOverride, 500);
  assert.equal(parsed.recognizedWeekColumns, 2);
});

test('导入按SKU更新所有匹配事业部并报告未匹配数量', () => {
  const parsed = parseSupplyPlanWorksheet([
    ['SKU', 'W32', 'W33'],
    ['SKU-1', 70, 80],
    ['SKU-404', 1, 2]
  ]);
  const applied = applySupplyPlanImport(rows, parsed);
  assert.equal(applied.stats.matchedImportRows, 1);
  assert.equal(applied.stats.unmatchedImportRows, 1);
  assert.equal(applied.stats.updatedSkuRows, 2);
  assert.deepEqual(applied.forecasts[supplyPlanRowKey(rows[0])].slice(0, 2), [70, 80]);
  assert.deepEqual(applied.forecasts[supplyPlanRowKey(rows[1])].slice(0, 2), [70, 80]);
});

test('安全库存导入按物料编码匹配并兼容Excel数字尾缀', () => {
  const parsed = parseSupplyPlanWorksheet([
    ['物料编码', '安全库存数量'],
    ['1001.0', 888]
  ], { mode: 'safety' });
  const applied = applySupplyPlanImport(rows, parsed);
  assert.equal(applied.stats.updatedSkuRows, 2);
  assert.equal(applied.safetyOverrides[supplyPlanRowKey(rows[0])], 888);
  assert.equal(applied.safetyOverrides[supplyPlanRowKey(rows[1])], 888);
});

test('采购缺口按21周预测、四舍五入日均和安全库存计算', () => {
  const forecast = Array.from({ length: 21 }, () => 7);
  const calculated = calculateSupplyPlanRow(rows[0], forecast);
  assert.equal(calculated.forecastTotal, 147);
  assert.equal(calculated.dailyForecast, 1);
  assert.equal(calculated.safetyStockQty, 10);
  assert.equal(calculated.purchaseGap, 37);
  const overridden = calculateSupplyPlanRow(rows[0], forecast, 200);
  assert.equal(overridden.safetyStockQty, 200);
  assert.equal(overridden.purchaseGap, 227);
});

test('导入文件缺少关键列时给出明确错误', () => {
  assert.throws(() => parseSupplyPlanWorksheet([['名称', 'W32'], ['产品', 1]]), /SKU 或物料编码/);
  assert.throws(() => parseSupplyPlanWorksheet([['SKU'], ['SKU-1']]), /周预测列/);
  assert.throws(
    () => parseSupplyPlanWorksheet([['SKU'], ['SKU-1']], { mode: 'safety' }),
    /安全库存列/
  );
});

test('供应计划按事业部、产品线和系列精确筛选', () => {
  const sourceRows = [
    { businessUnit: '国内事业部', productLine: '护理床', productSeries: 'A系列', materialCode: '1' },
    { businessUnit: '国内事业部', productLine: '轮椅', productSeries: 'B系列', materialCode: '2' },
    { businessUnit: '海外事业部', productLine: '护理床', productSeries: 'A系列', materialCode: '3' }
  ];
  assert.deepEqual(
    filterSupplyPlanRows(sourceRows, { businessUnit: '国内事业部', productLine: '护理床', productSeries: 'A系列' }).map((row) => row.materialCode),
    ['1']
  );
});

test('供应计划筛选选项按其他已选条件联动', () => {
  const sourceRows = [
    { businessUnit: '国内事业部', productLine: '护理床', productSeries: 'A系列' },
    { businessUnit: '国内事业部', productLine: '轮椅', productSeries: 'B系列' },
    { businessUnit: '海外事业部', productLine: '护理床', productSeries: 'C系列' }
  ];
  const options = buildSupplyPlanFilterOptions(sourceRows, { businessUnit: '国内事业部', productLine: '护理床', productSeries: '' });
  assert.deepEqual(options.businessUnit, ['国内事业部', '海外事业部']);
  assert.deepEqual(options.productLine, ['护理床', '轮椅']);
  assert.deepEqual(options.productSeries, ['A系列']);
});
