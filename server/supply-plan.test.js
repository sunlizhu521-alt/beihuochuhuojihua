import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSupplyPlanData,
  buildSupplyPlanWeeks,
  groupSupplyPlanModels,
  paginateSupplyPlanData,
  splitForecastToWeeks,
  supplyPlanChannel,
  supplyPlanModelDetail
} from './supply-plan.js';

const now = new Date('2026-09-03T02:00:00.000Z');

test('周视野从当前ISO周开始并支持6到24个月', () => {
  const weeks = buildSupplyPlanWeeks(6, now);
  assert.equal(weeks[0].key, '2026-W36');
  assert.equal(weeks[0].startDate, '2026-08-31');
  assert.ok(weeks.length >= 26 && weeks.length <= 28);
  assert.ok(buildSupplyPlanWeeks(24, now).length > weeks.length);
  assert.equal(buildSupplyPlanWeeks(7, now).length, weeks.length);
});

test('M+6月预测按自然日拆周且每月数量守恒', () => {
  const rows = splitForecastToWeeks([{
    businessUnit: '海外事业一部', materialCode: '1001', sku: 'SKU-1', skuName: '护理床',
    month1: 3, month2: 70, month3: 0, month4: 0, month5: 0, month6: 0
  }], now);
  assert.equal(rows.reduce((sum, row) => sum + row.forecastQty, 0), 73);
  assert.ok(rows.every((row) => Number.isInteger(row.forecastQty) && row.forecastQty > 0));
});

test('M+6预测兼容forecastM1字段名', () => {
  const rows = splitForecastToWeeks([{
    businessUnit: '海外事业一部', materialCode: '1001', forecastM1: 31
  }], now);
  assert.equal(rows.reduce((sum, row) => sum + row.forecastQty, 0), 31);
});

test('供应计划按事业部物料聚合18和19并接入21周预测及维度', () => {
  const payload = buildSupplyPlanData({
    inventorySummaryData: {
      inventorySummaryFile18: { rows: [
        { warehouseName: '美国仓', businessUnit: '海外事业一部', materialCode: '1001', onHandQty: 10, inTransitQty: 2 },
        { warehouseName: '美国仓', businessUnit: '海外事业一部', materialCode: '1001', onHandQty: 5, inTransitQty: 1 }
      ] },
      inventorySummaryFile19: { rows: [
        { businessUnit: '海外事业一部', materialCode: '1001', operator: '张三', undeliveredQty: 4 }
      ] },
      inventorySummaryFile21: { rows: [
        { businessUnit: '海外事业一部', materialCode: '1001', sku: 'SKU-1', skuName: '护理床', month1: 70, month2: 0, month3: 0, month4: 0, month5: 0, month6: 0 }
      ] }
    },
    dimensionData: {
      productCategory: [{ materialCode: '1001', productLine: '护理床', productSeries: '星云', model: 'A1' }],
      businessUnitFeedback: [{ businessUnit: '海外事业一部', materialCode: '1001', unifiedStage: '主力', unifiedPositioning: '核心' }],
      warehouseName: [{ warehouseName: '美国仓', marketplace: 'US', level1WarehouseCategory: '海外仓' }]
    },
    supplyPlanSettings: { channels: { overseasUs: { safetyDays: 175 } } },
    months: 6,
    now
  });
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].onHandQty, 15);
  assert.equal(payload.rows[0].inTransitQty, 3);
  assert.equal(payload.rows[0].undeliveredQty, 4);
  assert.equal(payload.rows[0].operator, '张三');
  assert.equal(payload.rows[0].productLifecycle, '主力');
  assert.equal(payload.rows[0].productPositioning, '核心');
  assert.equal(payload.rows[0].channelKey, 'overseasUs');
  assert.equal(payload.rows[0].safetyDays, 175);
  assert.equal(payload.rows[0].weeklyForecast.reduce((sum, value) => sum + value, 0), 70);
  assert.equal(
    payload.rows[0].inventoryRemainingQty,
    payload.rows[0].onHandQty + payload.rows[0].inTransitQty - payload.rows[0].weeklyForecast[0]
  );
});

test('渠道按仓库站点归类', () => {
  assert.equal(supplyPlanChannel('US').key, 'overseasUs');
  assert.equal(supplyPlanChannel('101-US-海外仓').key, 'overseasUs');
  assert.equal(supplyPlanChannel('加拿大').key, 'overseasUs');
  assert.equal(supplyPlanChannel('DE').key, 'overseasEurope');
  assert.equal(supplyPlanChannel('中国').key, 'domestic');
});

test('服务端按型号分页且每页最多100个', () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({
    modelKey: `产品线\u001f系列\u001fM${index}`,
    productLine: '产品线',
    productSeries: '系列',
    model: `M${index}`,
    businessUnit: '国内事业部',
    materialCode: String(index),
    weeklyForecast: [1, 2],
    inventoryRemainingQty: index
  }));
  const page = paginateSupplyPlanData({ ok: true, rows, weeks: [{}, {}] }, { page: 2, pageSize: 200 });
  assert.equal(page.rows.length, 100);
  assert.deepEqual(page.pagination, {
    page: 2, pageSize: 100, totalItems: 205, totalPages: 3, totalChildItems: 205
  });
});

test('型号详情使用产品线系列型号唯一键避免同名串数据', () => {
  const rows = [
    { modelKey: 'A\u001fX\u001fM1', productLine: 'A', productSeries: 'X', model: 'M1', businessUnit: '一部', materialCode: '1' },
    { modelKey: 'B\u001fY\u001fM1', productLine: 'B', productSeries: 'Y', model: 'M1', businessUnit: '二部', materialCode: '2' }
  ];
  const payload = { rows, weeks: [], horizonMonths: 9 };
  assert.equal(supplyPlanModelDetail(payload, { modelKey: 'A\u001fX\u001fM1' }).rows[0].materialCode, '1');
  assert.throws(() => supplyPlanModelDetail(payload, { model: 'M1' }), /同名型号/);
  assert.equal(groupSupplyPlanModels(rows).length, 2);
});
