import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStockingPlanRows,
  filterStockingPlanRows,
  groupStockingPlanRowsByMaterial
} from './stocking-plan.js';

const now = new Date('2026-09-05T00:00:00.000Z');

test('备货需求按事业部物料组装并生成型号物料父子汇总', () => {
  const plan = buildStockingPlanRows({
    inventoryRows: [
      { businessUnit: '海外事业一部', materialCode: '1001', onHandQty: 10, inTransitQty: 5 },
      { businessUnit: '国内事业部', materialCode: '1001', onHandQty: 20, inTransitQty: 0 }
    ],
    undeliveredRows: [
      { businessUnit: '海外事业一部', materialCode: '1001', undeliveredQty: 3, finishedQty: 2 },
      { businessUnit: '国内事业部', materialCode: '1001', undeliveredQty: 4, finishedQty: 6 }
    ],
    forecastRows: [
      { businessUnit: '海外事业一部', materialCode: '1001', sku: 'SKU-1', skuName: '源名称', month1: 40, month2: 10 },
      { businessUnit: '国内事业部', materialCode: '1001', month1: 30 }
    ],
    productRows: [
      { materialCode: '1001', sku: 'SKU-P', materialName: '商品名称', productLine: '护理床', productSeries: '星云', productType: '主力产品', model: 'A1' }
    ]
  }, now);

  assert.equal(plan.rows.length, 2);
  assert.deepEqual(plan.rows.find((row) => row.businessUnit === '海外事业一部').monthForecasts, [40, 10, 0, 0, 0, 0]);
  assert.equal(plan.rows[0].sku, 'SKU-P');
  assert.equal(plan.rows[0].productName, '商品名称');
  assert.equal(plan.rows[0].productLine, '护理床');
  assert.equal(plan.rows[0].productSeries, '星云');
  assert.equal(plan.rows[0].productType, '主力产品');
  assert.equal(plan.rows[0].model, 'A1');

  const [group] = groupStockingPlanRowsByMaterial(plan.rows);
  assert.equal(group.model, 'A1');
  assert.equal(group.materialCode, '1001');
  assert.equal(group.children.length, 2);
  assert.equal(group.parent.businessUnit, '');
  assert.deepEqual(group.parent.monthForecasts, [70, 10, 0, 0, 0, 0]);
  assert.equal(group.parent.onHandQty, 30);
  assert.equal(group.parent.inTransitQty, 5);
  assert.equal(group.parent.undeliveredQty, 7);
  assert.equal(group.parent.suggestedPurchaseQty, 38);
});

test('月预测拆周后数量守恒且按物料分组保持跨事业部行连续', () => {
  const plan = buildStockingPlanRows({
    forecastRows: [
      { businessUnit: '海外事业一部', materialCode: '1001', month1: 31, month2: 28 },
      { businessUnit: '国内事业部', materialCode: '1001', month1: 14 },
      { businessUnit: '国内事业部', materialCode: '1002', month1: 7 }
    ]
  }, now);
  plan.rows.forEach((row) => {
    assert.equal(
      row.weeklyForecast.reduce((sum, value) => sum + value, 0),
      row.monthForecasts.reduce((sum, value) => sum + value, 0)
    );
  });
  const groups = groupStockingPlanRowsByMaterial(plan.rows);
  assert.deepEqual(groups.map((group) => [group.materialCode, group.children.length]), [['1001', 2], ['1002', 1]]);
  assert.equal(groups[0].parent.weeklyForecast.reduce((sum, value) => sum + value, 0), 73);
});

test('同物料编码不同型号拆成独立父行', () => {
  const groups = groupStockingPlanRowsByMaterial([
    { businessUnit: '国内事业部', materialCode: '1001', model: 'A1', monthForecasts: [1, 0, 0, 0, 0, 0], weeklyForecast: [1], onHandQty: 0, inTransitQty: 0, undeliveredQty: 0 },
    { businessUnit: '海外事业一部', materialCode: '1001', model: 'A2', monthForecasts: [2, 0, 0, 0, 0, 0], weeklyForecast: [2], onHandQty: 0, inTransitQty: 0, undeliveredQty: 0 }
  ]);

  assert.deepEqual(groups.map((group) => group.model), ['A1', 'A2']);
});

test('备货需求计划忽略斜杠等非物料占位行', () => {
  const result = buildStockingPlanRows({
    inventoryRows: [{ businessUnit: '国内事业部', materialCode: '/', onHandQty: 10 }],
    undeliveredRows: [{ businessUnit: '海外事业一部', materialCode: '-', undeliveredQty: 20 }],
    forecastRows: [{ businessUnit: '海外事业二部', materialCode: 'N/A', month1: 30 }]
  }, new Date('2026-09-05T00:00:00Z'));

  assert.equal(result.rows.length, 0);
});

test('备货需求计划先按多选维度、库存状态和预测状态过滤明细', () => {
  const rows = [
    { productLine: '护理床', productSeries: '星云', productType: '主力产品', businessUnit: '国内事业部', onHandQty: 3, inTransitQty: 0, undeliveredQty: 0, forecastTotal: 8 },
    { productLine: '护理床', productSeries: '星河', productType: '培育产品', businessUnit: '海外事业一部', onHandQty: 0, inTransitQty: 4, undeliveredQty: 0, forecastTotal: 0 },
    { productLine: '制氧机', productSeries: '轻氧', productType: '主力产品', businessUnit: '国内事业部', onHandQty: 0, inTransitQty: 0, undeliveredQty: 2, forecastTotal: 6 }
  ];

  assert.deepEqual(filterStockingPlanRows(rows, {
    productLine: ['护理床'],
    productSeries: [],
    productType: ['主力产品'],
    businessUnit: ['国内事业部'],
    inventoryStatus: 'onHand',
    hasForecast: 'yes'
  }), [rows[0]]);
  assert.deepEqual(filterStockingPlanRows(rows, { inventoryStatus: 'inTransit', hasForecast: 'no' }), [rows[1]]);
  assert.deepEqual(filterStockingPlanRows(rows, { inventoryStatus: 'undelivered', hasForecast: 'yes' }), [rows[2]]);
  assert.deepEqual(
    filterStockingPlanRows(rows, { productSeries: ['星云', '轻氧'] }),
    [rows[0], rows[2]],
    '同一筛选器内的多个值应按 OR 关系保留'
  );
});

test('筛选后重新组装父子树，只保留命中子行并隐藏无子项父行', () => {
  const rows = [
    { rowKey: '国内\u001f1001', businessUnit: '国内事业部', productLine: '护理床', productSeries: '星云', productType: '主力产品', model: 'A1', materialCode: '1001', monthForecasts: [1, 0, 0, 0, 0, 0], weeklyForecast: [1], onHandQty: 1, inTransitQty: 0, undeliveredQty: 0, forecastTotal: 1 },
    { rowKey: '海外\u001f1001', businessUnit: '海外事业一部', productLine: '护理床', productSeries: '星云', productType: '主力产品', model: 'A1', materialCode: '1001', monthForecasts: [2, 0, 0, 0, 0, 0], weeklyForecast: [2], onHandQty: 2, inTransitQty: 0, undeliveredQty: 0, forecastTotal: 2 },
    { rowKey: '国内\u001f2001', businessUnit: '国内事业部', productLine: '制氧机', productSeries: '轻氧', productType: '培育产品', model: 'B1', materialCode: '2001', monthForecasts: [3, 0, 0, 0, 0, 0], weeklyForecast: [3], onHandQty: 3, inTransitQty: 0, undeliveredQty: 0, forecastTotal: 3 }
  ];
  const filtered = filterStockingPlanRows(rows, { businessUnit: ['海外事业一部'] });
  const groups = groupStockingPlanRowsByMaterial(filtered);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].materialCode, '1001');
  assert.deepEqual(groups[0].children.map((row) => row.businessUnit), ['海外事业一部']);
  assert.equal(groups[0].parent.onHandQty, 2);
});
