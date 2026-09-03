import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSupplyPlanData, buildSupplyPlanWeeks, splitForecastToWeeks, supplyPlanChannel } from './supply-plan.js';

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
});

test('渠道按仓库站点归类', () => {
  assert.equal(supplyPlanChannel('US').key, 'overseasUs');
  assert.equal(supplyPlanChannel('101-US-海外仓').key, 'overseasUs');
  assert.equal(supplyPlanChannel('加拿大').key, 'overseasUs');
  assert.equal(supplyPlanChannel('DE').key, 'overseasEurope');
  assert.equal(supplyPlanChannel('中国').key, 'domestic');
});
