import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySupplyPlanImport,
  buildSupplyPlanFilterOptions,
  buildSupplyPlanWeeks,
  calculateSupplyPlanRow,
  filterSupplyPlanRows,
  groupSupplyPlanRows,
  parseSupplyPlanWorksheet,
  SUPPLY_PLAN_ROW_TYPES,
  supplyPlanRowKey
} from './supply-plan.js';

const rows = [
  { businessUnit: '海外事业一部', materialCode: '1001', sku: 'SKU-1', onHandQty: 100, inTransitQty: 20, safetyDays: 10 },
  { businessUnit: '海外事业二部', materialCode: '1001', sku: 'SKU-1', onHandQty: 50, inTransitQty: 10, safetyDays: 10 },
  { businessUnit: '国内事业部', materialCode: '2002', sku: 'SKU-2', onHandQty: 10, inTransitQty: 0, safetyDays: 5 }
];

test('供应计划从当前ISO周生成可选月份视野', () => {
  const weeks = buildSupplyPlanWeeks(6, new Date('2026-09-03T02:00:00.000Z'));
  assert.ok(weeks.length >= 26 && weeks.length <= 28);
  assert.deepEqual(weeks[0], {
    key: '2026-W36', label: 'W36', dateRange: '8/31-9/6', startDate: '2026-08-31', endDate: '2026-09-06'
  });
  assert.ok(buildSupplyPlanWeeks(24, new Date('2026-09-03T02:00:00.000Z')).length > weeks.length);
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

test('采购缺口只用本周预测并扣减在库、在途和未交付', () => {
  const source = { onHandQty: 5, inTransitQty: 2, undeliveredQty: 3, safetyDays: 10, forecastDailyQty: 1 };
  const forecast = [7, 70];
  const calculated = calculateSupplyPlanRow(source, forecast);
  assert.equal(calculated.forecastTotal, 77);
  assert.equal(calculated.dailyForecast, 1);
  assert.equal(calculated.safetyStockQty, 10);
  assert.equal(calculated.inventoryRemainingQty, 0);
  assert.equal(calculated.purchaseGap, 7);
  const overridden = calculateSupplyPlanRow(source, forecast, 20);
  assert.equal(overridden.safetyStockQty, 20);
  assert.equal(overridden.purchaseGap, 17);
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

test('供应计划支持动作结论筛选', () => {
  const rows = [
    { businessUnit: '一部', productLine: 'A', productSeries: 'S1', actionConclusion: '加急补货' },
    { businessUnit: '二部', productLine: 'B', productSeries: 'S2', actionConclusion: '正常流转' }
  ];
  assert.deepEqual(filterSupplyPlanRows(rows, { actionConclusion: '加急补货' }), [rows[0]]);
  assert.deepEqual(buildSupplyPlanFilterOptions(rows, {}).actionConclusion, ['正常流转', '加急补货', '调整计划', '停采观察']);
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

test('供应计划固定使用六个指标', () => {
  assert.deepEqual(SUPPLY_PLAN_ROW_TYPES, [
    '销售预测', '未交付', '在途', '在库', '预测剩余库存', '建议采购'
  ]);
});

test('供应计划按产品型号生成父项并汇总事业部物料子项', () => {
  const sourceRows = [
    {
      productLine: '护理床', productSeries: '星云系列', model: 'A1', businessUnit: '海外事业部',
      materialCode: '1002', sku: 'SKU-A-US', materialName: 'A1海外版', onHandQty: 10,
      inTransitQty: 3, undeliveredQty: 4, inventoryQty: 13, safetyStockQty: 20,
      purchaseGap: 11, inventoryRemainingQty: 6, forecastTotal: 21, dailyForecast: 1, weeklyForecast: [7, 14]
    },
    {
      productLine: '护理床', productSeries: '星云系列', model: 'A1', businessUnit: '国内事业部',
      materialCode: '1001', sku: 'SKU-A-CN', materialName: 'A1国内版', onHandQty: 5,
      inTransitQty: 2, undeliveredQty: 6, inventoryQty: 7, safetyStockQty: 8,
      purchaseGap: 9, inventoryRemainingQty: 4, forecastTotal: 7, dailyForecast: 1, weeklyForecast: [3, 4]
    },
    {
      productLine: '护理床', productSeries: '星云系列', model: 'A2', businessUnit: '国内事业部',
      materialCode: '2001', sku: 'SKU-B', materialName: 'A2', onHandQty: 1,
      inTransitQty: 0, undeliveredQty: 0, inventoryQty: 1, safetyStockQty: 2,
      purchaseGap: 1, inventoryRemainingQty: 0, forecastTotal: 2, dailyForecast: 0, weeklyForecast: [1, 1]
    }
  ];
  const groups = groupSupplyPlanRows(sourceRows, 2);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].model, 'A1');
  assert.equal(groups[0].children.length, 2);
  assert.deepEqual(groups[0].children.map((row) => row.materialCode), ['1001', '1002']);
  assert.equal(groups[0].onHandQty, 15);
  assert.equal(groups[0].inTransitQty, 5);
  assert.equal(groups[0].undeliveredQty, 10);
  assert.equal(groups[0].inventoryQty, 20);
  assert.equal(groups[0].safetyStockQty, 28);
  assert.equal(groups[0].inventoryRemainingQty, 10);
  assert.equal(groups[0].purchaseGap, 20);
  assert.equal(groups[0].forecastTotal, 28);
  assert.deepEqual(groups[0].weeklyForecast, [10, 18]);
});

test('缺失型号时按SKU或物料编码隔离父项避免错误合并', () => {
  const groups = groupSupplyPlanRows([
    { productLine: '轮椅', productSeries: '基础系列', model: '', sku: 'SKU-1', materialCode: '1' },
    { productLine: '轮椅', productSeries: '基础系列', model: '', sku: 'SKU-2', materialCode: '2' }
  ]);
  assert.equal(groups.length, 2);
  assert.ok(groups.every((group) => group.model === '未匹配型号'));
});
