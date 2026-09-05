import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProductIterationMap,
  buildSupplyPlanData,
  buildSupplyPlanWeeks,
  calculateSuggestedPurchase,
  calculateWeeklyRemainingStock,
  getActionConclusion,
  groupSupplyPlanModels,
  normalizeSupplyPlanBusinessUnit,
  paginateSupplyPlanData,
  prepareSupplyPlanBeihuoPush,
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
      productCategory: [{ materialCode: '1001', productLine: '护理床', productSeries: '星云', model: 'A1', productType: '成品' }],
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
  assert.equal(payload.rows[0].productType, '成品');
  assert.equal(payload.rows[0].channelKey, 'overseasUs');
  assert.equal(payload.rows[0].safetyDays, 175);
  assert.equal(payload.rows[0].weeklyForecast.reduce((sum, value) => sum + value, 0), 70);
  assert.equal(
    payload.rows[0].inventoryRemainingQty,
    payload.rows[0].onHandQty + payload.rows[0].inTransitQty - payload.rows[0].weeklyForecast[0]
  );
  assert.equal(payload.rows[0].weeklyRemainingStock.length, payload.weeks.length);
  assert.equal(
    payload.rows[0].weeklyRemainingStock[1],
    payload.rows[0].weeklyRemainingStock[0] - payload.rows[0].weeklyForecast[1]
  );
});

test('预测剩余库存逐周递推且建议采购按首次低于安全库存周倒退计算', () => {
  const weeklyForecast = [10, 20, 15, 5];
  const weeklyRemainingStock = calculateWeeklyRemainingStock({
    onHandQty: 70,
    inTransitQty: 30,
    weeklyForecast
  });
  assert.deepEqual(weeklyRemainingStock, [90, 70, 55, 50]);
  assert.equal(calculateSuggestedPurchase({
    onHandQty: 70,
    inTransitQty: 30,
    undeliveredQty: 5,
    safetyStockQty: 80,
    weeklyForecast,
    weeklyRemainingStock
  }), 5);
  assert.equal(calculateSuggestedPurchase({
    onHandQty: 70,
    inTransitQty: 30,
    undeliveredQty: 0,
    safetyStockQty: 40,
    weeklyForecast,
    weeklyRemainingStock
  }), 0);
});

test('产品迭代关系把同型号库存和预测合并到首个latest并保留关联原始明细', () => {
  const iterationMap = buildProductIterationMap([
    { productLine: '护理床', productSeries: '星云', model: 'A1', latestMaterialCode: '1001', latestSku: 'LATEST', relatedMaterialCode: '1002' },
    { productLine: '护理床', productSeries: '星云', model: 'A1', latestMaterialCode: '1003', relatedMaterialCode: '1004' }
  ]);
  assert.deepEqual(iterationMap.get('1001'), {
    model: 'A1', latestMaterialCode: '1001', isLatest: true,
    productLine: '护理床', productSeries: '星云', latestSku: 'LATEST', latestMaterialName: ''
  });
  assert.equal(iterationMap.get('1002').latestMaterialCode, '1001');
  assert.equal(iterationMap.get('1003').isLatest, false);
  assert.equal(iterationMap.get('1004').latestMaterialCode, '1001');

  const payload = buildSupplyPlanData({
    inventorySummaryData: {
      inventorySummaryFile18: { rows: [
        { warehouseName: '美国仓', businessUnit: '海外事业一部', materialCode: '1001', onHandQty: 5, inTransitQty: 1 },
        { warehouseName: '美国仓', businessUnit: '海外事业一部', materialCode: '1002', onHandQty: 10, inTransitQty: 2 },
        { warehouseName: '欧洲仓', businessUnit: '海外事业一部', materialCode: '1003', onHandQty: 20, inTransitQty: 3 },
        { warehouseName: '欧洲仓', businessUnit: '海外事业一部', materialCode: '1004', onHandQty: 30, inTransitQty: 4 }
      ] },
      inventorySummaryFile19: { rows: [
        { businessUnit: '海外事业一部', materialCode: '1002', undeliveredQty: 6 }
      ] },
      inventorySummaryFile21: { rows: [
        { businessUnit: '海外事业一部', materialCode: '1001', month1: 31 },
        { businessUnit: '海外事业一部', materialCode: '1002', month1: 62 },
        { businessUnit: '海外事业一部', materialCode: '1003', month1: 93 },
        { businessUnit: '海外事业一部', materialCode: '1004', month1: 124 }
      ] }
    },
    dimensionData: {
      productCategory: [{ materialCode: '1001', productLine: '护理床', productSeries: '星云', model: 'A1', sku: 'LATEST' }],
      warehouseName: [
        { warehouseName: '美国仓', marketplace: 'US' },
        { warehouseName: '欧洲仓', marketplace: 'DE' }
      ]
    },
    iterationMap,
    supplyPlanSettings: { channels: { overseasUs: { safetyDays: 175 } } },
    months: 6,
    now
  });
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].materialCode, '1001');
  assert.equal(payload.rows[0].onHandQty, 65);
  assert.equal(payload.rows[0].inTransitQty, 10);
  assert.equal(payload.rows[0].undeliveredQty, 6);
  assert.equal(payload.rows[0].weeklyForecast.reduce((sum, value) => sum + value, 0), 310);
  assert.deepEqual(payload.rows[0].relatedDetails.map((row) => row.materialCode), ['1002', '1003', '1004']);
  assert.equal(payload.rows[0].relatedDetails.find((row) => row.materialCode === '1002').undeliveredQty, 6);
  assert.equal(payload.rows[0].relatedDetails.find((row) => row.materialCode === '1004').forecastTotal, 124);
  assert.equal(payload.sourceSummary.mergedRelatedMaterials, 3);
});

test('产品迭代关系优先选择有related的latest，并在全部孤立时回退首个', () => {
  const iterationMap = buildProductIterationMap([
    { model: '119', latestMaterialCode: '8197', latestSku: '孤立SKU', relatedMaterialCode: '' },
    { model: '119', latestMaterialCode: '8200', latestSku: '规范SKU', relatedMaterialCode: '8198,8199' },
    { model: '120', latestMaterialCode: '9001', relatedMaterialCode: '' },
    { model: '120', latestMaterialCode: '9002', relatedMaterialCode: '' }
  ]);

  ['8197', '8198', '8199', '8200'].forEach((materialCode) => {
    assert.equal(iterationMap.get(materialCode).latestMaterialCode, '8200');
  });
  assert.equal(iterationMap.get('8197').isLatest, false);
  assert.equal(iterationMap.get('8200').isLatest, true);
  assert.equal(iterationMap.get('8200').latestSku, '规范SKU');
  assert.equal(iterationMap.get('9001').latestMaterialCode, '9001');
  assert.equal(iterationMap.get('9001').isLatest, true);
  assert.equal(iterationMap.get('9002').isLatest, false);
});

test('产品迭代槽位为空时供应计划保持原物料编码逻辑', () => {
  const payload = buildSupplyPlanData({
    inventorySummaryData: {
      inventorySummaryFile18: { rows: [
        { warehouseName: '国内仓', businessUnit: '国内事业部', materialCode: '2001', onHandQty: 8, inTransitQty: 2 }
      ] }
    },
    months: 6,
    now
  });
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].materialCode, '2001');
  assert.deepEqual(payload.rows[0].relatedDetails, []);
});

test('渠道按仓库站点归类', () => {
  assert.equal(supplyPlanChannel('US').key, 'overseasUs');
  assert.equal(supplyPlanChannel('101-US-海外仓').key, 'overseasUs');
  assert.equal(supplyPlanChannel('加拿大').key, 'overseasUs');
  assert.equal(supplyPlanChannel('DE').key, 'overseasEurope');
  assert.equal(supplyPlanChannel('中国').key, 'domestic');
});

test('服务端先按父型号分组再分页且每页固定最多10个', () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    modelKey: `产品线\u001f系列\u001fM${index}`,
    productLine: '产品线',
    productSeries: '系列',
    model: `M${index}`,
    businessUnit: '国内事业部',
    materialCode: String(index),
    weeklyForecast: [1, 2],
    inventoryRemainingQty: index
  }));
  rows.push({ ...rows[0], businessUnit: '海外事业部', materialCode: 'duplicate-child' });
  const page = paginateSupplyPlanData({ ok: true, rows, weeks: [{}, {}] }, { page: 2, pageSize: 200 });
  assert.equal(page.rows.length, 10);
  assert.equal(page.rows[0].model, 'M10');
  assert.deepEqual(page.pagination, {
    page: 2, pageSize: 10, totalItems: 25, totalPages: 3, totalChildItems: 26
  });
});

test('服务端支持销售产品分类、库存状态任一匹配和销售预测筛选', () => {
  const rows = [
    { modelKey: '线\u001f系列\u001fM1', productLine: '线', productSeries: '系列', productType: '成品', model: 'M1', materialCode: '1', onHandQty: 5, inTransitQty: 0, undeliveredQty: 0, forecastTotal: 0 },
    { modelKey: '线\u001f系列\u001fM2', productLine: '线', productSeries: '系列', productType: '配件', model: 'M2', materialCode: '2', onHandQty: 0, inTransitQty: 6, undeliveredQty: 0, forecastTotal: 12 },
    { modelKey: '线\u001f系列\u001fM3', productLine: '线', productSeries: '系列', productType: '成品', model: 'M3', materialCode: '3', onHandQty: 0, inTransitQty: 0, undeliveredQty: 7, forecastTotal: 0 },
    { modelKey: '线\u001f系列\u001fM4', productLine: '线', productSeries: '系列', productType: '成品', model: 'M4', materialCode: '4', onHandQty: 0, inTransitQty: 0, undeliveredQty: 0, forecastTotal: 8 }
  ];
  const payload = { ok: true, rows, weeks: [] };
  const filtered = paginateSupplyPlanData(payload, {
    filters: { productType: '成品', inventoryStatus: ['在库', '未交付'], hasForecast: ['无'] }
  });
  assert.deepEqual(filtered.rows.map((row) => row.model), ['M1', 'M3']);
  assert.equal(filtered.pagination.totalChildItems, 2);

  const unfiltered = paginateSupplyPlanData(payload, { filters: { inventoryStatus: [], hasForecast: [] } });
  assert.equal(unfiltered.pagination.totalItems, 4);
  assert.deepEqual(unfiltered.filterOptions.productType, ['成品', '配件']);
  assert.deepEqual(unfiltered.filterOptions.inventoryStatus, ['在库', '在途', '未交付']);
  assert.deepEqual(unfiltered.filterOptions.hasForecast, ['有', '无']);
});

test('服务端产品维度和动作结论支持多选OR', () => {
  const rows = [
    { modelKey: 'A', productLine: '护理床', productSeries: 'A系列', actionConclusion: '正常流转', model: 'M1', materialCode: '1' },
    { modelKey: 'B', productLine: '轮椅', productSeries: 'B系列', actionConclusion: '需要补货', model: 'M2', materialCode: '2' },
    { modelKey: 'C', productLine: '拐杖', productSeries: 'C系列', actionConclusion: '停采观察', model: 'M3', materialCode: '3' }
  ];
  const filtered = paginateSupplyPlanData({ ok: true, rows, weeks: [] }, {
    filters: {
      productLine: ['护理床', '轮椅'],
      actionConclusion: ['正常流转', '需要补货']
    }
  });
  assert.deepEqual(filtered.rows.map((row) => row.model), ['M1', 'M2']);
});

test('服务端事业部筛选合并星号后的下级名称', () => {
  const rows = [
    { modelKey: '线\u001f系列\u001fM1', productLine: '线', productSeries: '系列', model: 'M1', businessUnit: '国内事业部', materialCode: '1' },
    { modelKey: '线\u001f系列\u001fM2', productLine: '线', productSeries: '系列', model: 'M2', businessUnit: '国内事业部*TEMU业务部', materialCode: '2' },
    { modelKey: '线\u001f系列\u001fM3', productLine: '线', productSeries: '系列', model: 'M3', businessUnit: '供应链管理中心*采购部', materialCode: '3' }
  ];
  const page = paginateSupplyPlanData({ ok: true, rows, weeks: [] }, {
    filters: { businessUnit: '国内事业部' }
  });
  assert.equal(normalizeSupplyPlanBusinessUnit('国内事业部*TEMU业务部'), '国内事业部');
  assert.deepEqual(page.rows.map((row) => row.model), ['M1', 'M2']);
  assert.deepEqual(page.filterOptions.businessUnit, ['供应链管理中心', '国内事业部']);
});

test('全球招商部与全球招商事业部在服务端聚合为同一事业部', () => {
  const payload = buildSupplyPlanData({
    inventorySummaryData: {
      inventorySummaryFile18: { rows: [
        { warehouseName: '国内仓', businessUnit: '全球招商部', materialCode: '3001', onHandQty: 3, inTransitQty: 1 },
        { warehouseName: '国内仓', businessUnit: '全球招商事业部', materialCode: '3001', onHandQty: 4, inTransitQty: 2 }
      ] }
    },
    months: 6,
    now
  });
  assert.equal(normalizeSupplyPlanBusinessUnit('全球招商部'), '全球招商事业部');
  assert.equal(normalizeSupplyPlanBusinessUnit('全球招商事业部'), '全球招商事业部');
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].businessUnit, '全球招商事业部');
  assert.equal(payload.rows[0].onHandQty, 7);
  assert.equal(payload.rows[0].inTransitQty, 3);
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

test('动作结论按预测、全链路剩余和含未交付全窗口剩余判定', () => {
  const normal = getActionConclusion({
    weeklyForecast: [7, 7, 7, 7], onHandQty: 100, inTransitQty: 0,
    undeliveredQty: 0, purchaseGap: 0, safetyStockQty: 10, totalLeadTimeDays: 30
  });
  assert.equal(normal.conclusion, '正常流转');
  assert.equal(normal.forecastDaily, 1);
  assert.equal(normal.stockCoverDays, 100);
  assert.equal(normal.daysUntilShortage, 0);

  const needPurchase = getActionConclusion({
    weeklyForecast: [10, 10, 10, 10], onHandQty: 15, inTransitQty: 0,
    undeliveredQty: 5, purchaseGap: 30, safetyStockQty: 10, totalLeadTimeDays: 14
  });
  assert.equal(needPurchase.conclusion, '需要补货');
  assert.equal(needPurchase.color, '#f44336');

  const adjust = getActionConclusion({
    weeklyForecast: [10, 10, 0, 0], onHandQty: 15, inTransitQty: 0,
    undeliveredQty: 20, purchaseGap: 5, safetyStockQty: 10, totalLeadTimeDays: 14
  });
  assert.equal(adjust.conclusion, '调整计划');

  const pause = getActionConclusion({
    weeklyForecast: [0, 0, 0, 0], onHandQty: 1, inTransitQty: 0,
    undeliveredQty: 1, purchaseGap: 0, safetyStockQty: 10, totalLeadTimeDays: 30
  });
  assert.equal(pause.conclusion, '停采观察');
  assert.equal(pause.stockCoverDays, 999);
  assert.equal(pause.color, '#9e9e9e');

  const empty = getActionConclusion({
    weeklyForecast: [0, 0, 0, 0], onHandQty: 0, inTransitQty: 0,
    undeliveredQty: 0, purchaseGap: 0, safetyStockQty: 10, totalLeadTimeDays: 30
  });
  assert.equal(empty.conclusion, '正常流转');
});

test('父行动作结论按需要补货、调整、停采、正常的严重度汇总', () => {
  const base = { modelKey: '产品线\u001f系列\u001fM1', productLine: '产品线', productSeries: '系列', model: 'M1', weeklyForecast: [] };
  const groups = groupSupplyPlanModels([
    { ...base, businessUnit: '一部', materialCode: '1', actionConclusion: '正常流转', actionColor: '#4caf50' },
    { ...base, businessUnit: '二部', materialCode: '2', actionConclusion: '停采观察', actionColor: '#9e9e9e' },
    { ...base, businessUnit: '三部', materialCode: '3', actionConclusion: '调整计划', actionColor: '#ff9800' },
    { ...base, businessUnit: '四部', materialCode: '4', actionConclusion: '需要补货', actionColor: '#f44336' }
  ]);
  assert.equal(groups[0].actionConclusion, '需要补货');
  assert.equal(groups[0].actionColor, '#f44336');
});

test('父行按关联物料编码跨事业部聚合关联明细且保留首个SKU', () => {
  const base = { modelKey: '产品线\u001f系列\u001fM1', productLine: '产品线', productSeries: '系列', model: 'M1', weeklyForecast: [] };
  const groups = groupSupplyPlanModels([
    {
      ...base,
      businessUnit: '一部',
      materialCode: '1',
      relatedDetails: [
        { materialCode: '1002', sku: 'SKU-FIRST', onHandQty: 1, inTransitQty: 2, undeliveredQty: 3 },
        { materialCode: '1003', sku: 'SKU-SECOND', onHandQty: 4, inTransitQty: 5, undeliveredQty: 6 }
      ]
    },
    {
      ...base,
      businessUnit: '二部',
      materialCode: '2',
      relatedDetails: [
        { relatedMaterialCode: '1002.0', sku: 'SKU-LATER', onHandQty: 10, inTransitQty: 20, undeliveredQty: 30 }
      ]
    }
  ]);

  assert.deepEqual(groups[0].relatedDetails, [
    { materialCode: '1002', relatedMaterialCode: '1002', sku: 'SKU-FIRST', onHandQty: 11, inTransitQty: 22, undeliveredQty: 33 },
    { materialCode: '1003', relatedMaterialCode: '1003', sku: 'SKU-SECOND', onHandQty: 4, inTransitQty: 5, undeliveredQty: 6 }
  ]);
});

test('动作筛选只保留符合结论的型号并生成联动筛选选项', () => {
  const rows = [
    { modelKey: 'A', productLine: '护理床', productSeries: '星云', businessUnit: '一部', actionConclusion: '需要补货', weeklyForecast: [] },
    { modelKey: 'B', productLine: '轮椅', productSeries: '标准', businessUnit: '二部', actionConclusion: '正常流转', weeklyForecast: [] }
  ];
  const page = paginateSupplyPlanData({ ok: true, rows, weeks: [] }, { filters: { actionConclusion: '需要补货' } });
  assert.equal(page.pagination.totalItems, 1);
  assert.equal(page.rows[0].modelKey, 'A');
  assert.deepEqual(page.filterOptions.actionConclusion, ['正常流转', '需要补货', '调整计划', '停采观察']);
});

test('备货计划预留接口只整理匹配动作的明细且不声明已推送', () => {
  const payload = { rows: [
    { modelId: 'M1', model: 'A1', businessUnit: '一部', materialCode: '1001', sku: 'S1', actionConclusion: '需要补货', purchaseGap: 12 },
    { modelId: 'M1', model: 'A1', businessUnit: '二部', materialCode: '1002', sku: 'S2', actionConclusion: '正常流转', purchaseGap: 0 }
  ] };
  const result = prepareSupplyPlanBeihuoPush(payload, { modelIds: ['M1'], actionType: 'urgent' });
  assert.equal(result.status, 'reserved');
  assert.equal(result.connected, false);
  assert.equal(result.pushed, false);
  assert.equal(result.targetPool, '紧急补货');
  assert.equal(result.items.length, 1);
  assert.equal(result.models[0].suggestedPurchaseQty, 12);
  assert.throws(() => prepareSupplyPlanBeihuoPush(payload, { modelIds: ['M1'], actionType: 'pause' }), /没有“停采观察”明细/);
});
