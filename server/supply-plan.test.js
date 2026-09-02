import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildSupplyPlanSummary,
  normalizeSupplyPlanParams
} from './inventory-risk.js';

const NOW = new Date('2026-08-10T00:00:00.000Z');

function inventoryRow(overrides = {}) {
  return {
    businessUnit: '海外事业一部',
    materialCode: '1001',
    sku: 'SKU-1001',
    materialName: '测试产品',
    productLine: '测试产品线',
    productSeries: '测试系列',
    model: '测试型号',
    salesRegion: '美国',
    inventoryQty: 100,
    transitQty: 20,
    unfulfilledQty: 30,
    inventorySourceDetails: [{ warehouseLocation: '海外仓' }],
    salesByMonth: {},
    ...overrides
  };
}

test('供应计划工具三渠道默认参数及派生天数独立于供应计划分析', () => {
  const params = normalizeSupplyPlanParams({});
  assert.deepEqual(params.channels.overseasUs, {
    onHandSellableDays: 60,
    dispatchToShelfDays: 10,
    transportDays: 40,
    bookingDays: 10,
    averageLeadTimeDays: 45,
    contractSigningDays: 10,
    spotDays: 120,
    fullChainDays: 175,
    safetyDays: 175
  });
  assert.equal(params.channels.overseasEurope.spotDays, 135);
  assert.equal(params.channels.overseasEurope.fullChainDays, 190);
  assert.equal(params.channels.overseasEurope.safetyDays, 190);
  assert.equal(params.channels.domestic.spotDays, 47);
  assert.equal(params.channels.domestic.fullChainDays, 102);
  assert.equal(params.channels.domestic.safetyDays, 102);
});

test('供应计划工具自定义参数重算派生天数并阻止负数', () => {
  const params = normalizeSupplyPlanParams({
    channels: {
      overseasUs: {
        onHandSellableDays: 50,
        dispatchToShelfDays: 8,
        transportDays: 30,
        bookingDays: 6,
        averageLeadTimeDays: 35,
        contractSigningDays: 7
      },
      domestic: { safetyDays: 88 }
    }
  });
  assert.equal(params.channels.overseasUs.spotDays, 94);
  assert.equal(params.channels.overseasUs.fullChainDays, 136);
  assert.equal(params.channels.overseasUs.safetyDays, 136);
  assert.equal(params.channels.domestic.safetyDays, 88);
  assert.throws(
    () => normalizeSupplyPlanParams({ channels: { domestic: { transportDays: -1 } } }),
    /非负数字/
  );
});

test('供应计划工具按事业部和物料聚合库存并输出渠道参数', () => {
  const payload = buildSupplyPlanSummary({
    now: NOW,
    inventoryModel: {
      rows: [
        inventoryRow(),
        inventoryRow({ inventoryQty: 40, transitQty: 5, unfulfilledQty: 7, inventorySourceDetails: [{ warehouseLocation: '美西仓' }] }),
        inventoryRow({ businessUnit: '海外事业二部', inventoryQty: 9, transitQty: 1, unfulfilledQty: 2 })
      ]
    }
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.generatedAt, NOW.toISOString());
  assert.equal(payload.rows.length, 2);
  const first = payload.rows.find((row) => row.businessUnit === '海外事业一部');
  assert.equal(first.onHandQty, 140);
  assert.equal(first.inTransitQty, 25);
  assert.equal(first.undeliveredQty, 37);
  assert.equal(first.inventoryQty, 165);
  assert.deepEqual(first.warehouseLocations, ['海外仓', '美西仓']);
  assert.equal(first.channelKey, 'overseasUs');
  assert.equal(first.spotDays, 120);
  assert.equal(first.fullChainDays, 175);
  assert.equal(first.safetyDays, 175);
});

test('供应计划工具排除零数量和非三渠道数据', () => {
  const payload = buildSupplyPlanSummary({
    now: NOW,
    inventoryModel: {
      rows: [
        inventoryRow({ materialCode: '1000', inventoryQty: 0, transitQty: 0, unfulfilledQty: 0 }),
        inventoryRow({ materialCode: '1002', salesRegion: '沙特' }),
        inventoryRow({ materialCode: '1003', salesRegion: '欧洲' }),
        inventoryRow({ materialCode: '1004', businessUnit: '国内事业部', salesRegion: '中国' })
      ]
    }
  });
  assert.deepEqual(payload.rows.map((row) => row.materialCode), ['1004', '1003']);
  assert.deepEqual(payload.rows.map((row) => row.channel), ['国内', '海外-欧洲']);
});

test('供应计划工具接口、独立设置键、权限和操作日志均完成注册', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const server = fs.readFileSync(path.join(root, 'server', 'app.js'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'src', 'SupplyPlanBoard.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
  assert.match(server, /'supplyPlanBoard'/);
  assert.match(server, /supplyPlanBoard: '供应计划工具'/);
  assert.match(server, /SUPPLY_PLAN_SETTING_KEY = 'supplyPlan'/);
  assert.match(server, /requestPath\.startsWith\('\/api\/supply-plan'\)/);
  assert.match(server, /app\.get\('\/api\/supply-plan\/summary', requireAuth, requirePage\('supplyPlanBoard'\)/);
  assert.match(server, /app\.get\('\/api\/supply-plan\/params', requireAuth, requirePage\('supplyPlanBoard'\)/);
  assert.match(server, /app\.post\('\/api\/supply-plan\/params', requireAuth, requirePage\('supplyPlanBoard'\)/);
  assert.match(server, /normalizeSupplyPlanParams\(saved \? JSON\.parse\(saved\.params_json\) : \{\}\)/);
  assert.match(server, /\[SUPPLY_PLAN_SETTING_KEY, paramsJson, updatedBy, updatedAt\]/);
  assert.match(client, /React\.lazy\(\(\) => import\('\.\/SupplyPlanBoard\.jsx'\)\)/);
  assert.match(client, /'inventoryRisk',[\s\S]*?'supplyPlanBoard',[\s\S]*?'inventoryPurchase'/);
  assert.match(client, /shouldMount\('supplyPlanBoard'\)/);
  assert.match(page, /SUPPLY_PLAN_PAGE_SIZE/);
  assert.match(page, /parseSupplyPlanWorksheet/);
  assert.match(page, /applySupplyPlanImport/);
  assert.match(page, /rowSpan=\{SUPPLY_PLAN_ROW_TYPES\.length\}/);
  assert.match(page, /重算/);
  assert.match(page, /导入销售预测/);
  assert.match(page, /导入安全库存/);
  assert.match(page, /供应计划筛选器/);
  assert.match(page, /SUPPLY_PLAN_FILTER_FIELDS/);
  assert.match(page, /当前显示/);
  assert.match(styles, /\.supply-plan-table \.supply-plan-sticky/);
  assert.match(styles, /\.supply-plan-table \.gap-positive/);
  assert.match(styles, /\.supply-plan-filter-bar/);
});
