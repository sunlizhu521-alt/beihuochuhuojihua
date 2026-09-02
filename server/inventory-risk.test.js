import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildBeiHuoReviewAnalysis,
  buildInventoryRiskAnalysis,
  forecastMonth,
  normalizeInventoryRiskParams
} from './inventory-risk.js';

const NOW = new Date('2026-08-03T01:00:00.000Z');

function summaryRow(overrides = {}) {
  return {
    businessUnit: '海外事业一部',
    materialCode: '1001',
    sku: 'SKU-1001',
    materialName: '测试产品',
    productLine: '测试线',
    productSeries: '测试系列',
    model: '测试型号',
    salesRegion: '美国',
    inventoryQty: 100,
    transitQty: 0,
    unfulfilledQty: 0,
    unfulfilledSupplierShortName: '供应商甲&供应商乙&供应商甲',
    inventorySourceDetails: [{
      sourceTable: 'FBA库存报表', sourceWarehouseName: '美国仓', mappedWarehouseName: '101-US',
      warehouseLocation: '海外仓', site: '美国'
    }],
    salesByMonth: {
      '2026-02': 10,
      '2026-03': 20,
      '2026-04': 30,
      '2026-05': 40,
      '2026-06': 50,
      '2026-07': 60
    },
    ...overrides
  };
}

function wideForecast(overrides = {}) {
  return {
    事业部: '海外事业一部',
    物料编码: '1001',
    '2026年8月': 100,
    '2026-09': 100,
    '2026/10': 100,
    '2026.11': 100,
    '2026年12月': 100,
    '2027-01': 100,
    ...overrides
  };
}

test('销售预测月份兼容常用表头格式', () => {
  assert.equal(forecastMonth('2026年8月'), '2026-08');
  assert.equal(forecastMonth('2026/8'), '2026-08');
  assert.equal(forecastMonth('2026-08'), '2026-08');
  assert.equal(forecastMonth('合计'), '');
});

test('槽位15无年份销量列按文件日期跨年，并汇总重复渠道和店铺', () => {
  const currentRows = [
    {
      事业部: '海外事业一部', 渠道: 'Amazon', 店铺: '店铺A', SKU: 'SKU-1001', 物料编码: '1001',
      '7月预估销量': 9999, '7月预估销售金额': 999999,
      '8月预估销量': 100, '8月预估销售金额': 999999,
      '9月预估销量': 100, '10月预估销量': 100, '11月预估销量': 100, '12月预估销量': 100, '1月预估销量': 100
    },
    {
      事业部: '海外事业一部', 渠道: 'Walmart', 店铺: '店铺B', SKU: 'SKU-1001', 物料编码: '1001',
      '7月预估销量': 8888, '7月预估销售金额': 888888,
      '8月预估销量': 50, '8月预估销售金额': 888888,
      '9月预估销量': 50, '10月预估销量': 50, '11月预估销量': 50, '12月预估销量': 50, '1月预估销量': 50
    }
  ];
  const payload = buildInventoryRiskAnalysis({
    now: NOW,
    inventoryModel: { rows: [summaryRow({ inventoryQty: 600 })], anomalies: [] },
    forecastRows: currentRows,
    forecastSource: {
      fileName: '四大事业部M+6销量预测26.7.30.xlsx',
      updatedAt: '2026-08-03 10:12:16'
    }
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.stopped.length, 1);
  assert.equal(payload.stopped[0].forecastMonthlyAverage, 150);
  assert.equal(payload.stopped[0].forecastAvailability, '有预测销售');
  assert.equal(payload.stopped[0].totalInventoryQty, 600);
  assert.equal(payload.stopped[0].model, '测试型号');
  assert.deepEqual(payload.stopped[0].warehouseLocations, ['海外仓']);
  assert.deepEqual(payload.stopped[0].sites, ['美国']);
  assert.deepEqual(payload.periods.forecastMonths, ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01']);
  assert.deepEqual(
    payload.diagnostics.forecastParsing.monthColumns.map(({ header, month }) => [header, month]),
    [
      ['7月预估销量', '2026-07'], ['8月预估销量', '2026-08'], ['9月预估销量', '2026-09'],
      ['10月预估销量', '2026-10'], ['11月预估销量', '2026-11'], ['12月预估销量', '2026-12'], ['1月预估销量', '2027-01']
    ]
  );
  assert.equal(payload.diagnostics.forecastParsing.monthColumns.some(({ header }) => header.includes('金额')), false);
  assert.equal(payload.diagnostics.forecastParsing.reasonCounts.parsedRows, 2);
});

test('未交付供应商简称按事业部和物料去重汇总', () => {
  const payload = buildInventoryRiskAnalysis({
    now: NOW,
    inventoryModel: {
      rows: [
        summaryRow({ inventoryQty: 300, unfulfilledQty: 10, unfulfilledSupplierShortName: '供应商甲&供应商乙' }),
        summaryRow({ inventoryQty: 300, unfulfilledQty: 20, unfulfilledSupplierShortName: '供应商乙&供应商丙' })
      ],
      anomalies: []
    },
    forecastRows: [wideForecast()]
  });
  assert.equal(payload.stopped.length, 1);
  assert.equal(payload.stopped[0].undeliveredQty, 30);
  assert.equal(payload.stopped[0].unfulfilledSupplierShortName, '供应商甲&供应商乙&供应商丙');
  assert.equal(payload.stopped[0].dataSource, 'FBA库存报表：美国仓 → 映射：101-US');
});

test('无文件日期时使用槽位更新时间把年初月份归入次年', () => {
  const payload = buildInventoryRiskAnalysis({
    now: NOW,
    inventoryModel: { rows: [summaryRow({ inventoryQty: 600 })], anomalies: [] },
    forecastRows: [{
      事业部: '海外事业一部', 物料编码: '1001',
      '7月预测销量': 100, '8月预测销量': 100, '9月预测销量': 100, '10月预测销量': 100,
      '11月预测销量': 100, '12月预测销量': 100, '1月预测销量': 100
    }],
    forecastSource: { fileName: '销售预测.xlsx', updatedAt: '2027-01-05 09:30:00' }
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.diagnostics.forecastParsing.anchorSource, '槽位更新时间');
  assert.deepEqual(
    payload.diagnostics.forecastParsing.monthColumns.map(({ month }) => month),
    ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01']
  );
});

test('销售预测失败返回表头、月份列和原因统计', () => {
  const payload = buildInventoryRiskAnalysis({
    now: NOW,
    inventoryModel: { rows: [summaryRow()], anomalies: [] },
    forecastRows: [{ 事业部: '海外事业一部', 物料编码: '1001', '7月预估销售金额': 1000 }],
    forecastSource: { fileName: '销售预测26.7.30.xlsx', updatedAt: '2026-08-03 10:12:16' }
  });
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.diagnostics.forecastParsing.headers, ['事业部', '物料编码', '7月预估销售金额']);
  assert.deepEqual(payload.diagnostics.forecastParsing.monthColumns, []);
  assert.equal(payload.diagnostics.forecastParsing.reasonCounts.noValidMonthColumns, 1);
});

test('同一物料按国内和海外独立计算，最近N月均销独立展示', () => {
  const payload = buildInventoryRiskAnalysis({
    now: NOW,
    inventoryModel: {
      rows: [
        summaryRow({ businessUnit: '国内事业部', inventoryQty: 100 }),
        summaryRow({ businessUnit: '海外事业一部', inventoryQty: 400 })
      ],
      anomalies: []
    },
    forecastRows: [
      wideForecast({ 事业部: '国内事业部' }),
      wideForecast({ 事业部: '海外事业一部' })
    ]
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.summary.normalCount, 1);
  assert.equal(payload.stopped.length, 1);
  assert.equal(payload.stopped[0].channel, '海外-美国');
  assert.equal(payload.stopped[0].transitTurnoverDays, 120);
  assert.equal(payload.stopped[0].historicalMonthlyAverage, 35);
  assert.equal(payload.periods.historicalStartMonth, '2026-02');
  assert.equal(payload.periods.historicalEndMonth, '2026-07');
});

test('同一物料的不同海外事业部独立计算，不合并事业部或销售预测', () => {
  const payload = buildInventoryRiskAnalysis({
    now: NOW,
    inventoryModel: {
      rows: [
        summaryRow({ businessUnit: '海外事业一部', inventoryQty: 400 }),
        summaryRow({ businessUnit: '海外事业二部', inventoryQty: 800 })
      ],
      anomalies: []
    },
    forecastRows: [
      wideForecast({ 事业部: '海外事业一部' }),
      wideForecast({
        事业部: '海外事业二部',
        '2026年8月': 200,
        '2026-09': 200,
        '2026/10': 200,
        '2026.11': 200,
        '2026年12月': 200,
        '2027-01': 200
      })
    ]
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.stopped.length, 2);
  assert.equal(payload.rows.length, 2);
  const first = payload.rows.find((row) => row.businessUnit === '海外事业一部');
  const second = payload.rows.find((row) => row.businessUnit === '海外事业二部');
  assert.equal(first.forecastMonthlyAverage, 100);
  assert.equal(second.forecastMonthlyAverage, 200);
  assert.equal(first.onHandQty, 400);
  assert.equal(second.onHandQty, 800);
  assert.equal(payload.rows.some((row) => row.businessUnit.includes('&')), false);
  assert.equal(new Set(payload.rows.map((row) => row.id)).size, 2);
});

test('销售区域映射三个渠道，2B和无法区分不进入风险计算', () => {
  const payload = buildInventoryRiskAnalysis({
    now: NOW,
    inventoryModel: {
      rows: [
        summaryRow({ materialCode: '1001', sku: 'SKU-1001', salesRegion: '美国' }),
        summaryRow({ materialCode: '1002', sku: 'SKU-1002', salesRegion: '欧洲' }),
        summaryRow({ materialCode: '1003', sku: 'SKU-1003', salesRegion: '中国', businessUnit: '国内事业部' }),
        summaryRow({ materialCode: '1004', sku: 'SKU-1004', salesRegion: '沙特' }),
        summaryRow({ materialCode: '1005', sku: 'SKU-1005', salesRegion: '无法区分' }),
        summaryRow({ materialCode: '1006', sku: 'SKU-1006', salesRegion: '海外' }),
        summaryRow({ materialCode: '1007', sku: 'SKU-1007', salesRegion: '欧美' })
      ],
      anomalies: [
        { id: 'risk-1006', sourceType: '供应计划分析', materialCode: '1006', businessUnit: '不适用', qty: 100, issue: '销售区域缺失或无法识别' },
        { id: 'risk-1007', sourceType: '供应计划分析', materialCode: '1007', businessUnit: '不适用', qty: 100, issue: '销售区域缺失或无法识别' }
      ]
    },
    forecastRows: [
      wideForecast({ 物料编码: '1001' }),
      wideForecast({ 物料编码: '1002' }),
      wideForecast({ 物料编码: '1003', 事业部: '国内事业部' }),
      wideForecast({ 物料编码: '1004' }),
      wideForecast({ 物料编码: '1005' }),
      wideForecast({ 物料编码: '1006' }),
      wideForecast({ 物料编码: '1007' })
    ],
    params: {
      channels: {
        overseasUs: { restrictThresholdDays: 20, stopThresholdDays: 100 },
        overseasEurope: { restrictThresholdDays: 20, stopThresholdDays: 100 },
        domestic: { restrictThresholdDays: 20, stopThresholdDays: 100 }
      }
    }
  });
  assert.deepEqual(new Set(payload.rows.map((row) => row.channel)), new Set(['海外-美国', '海外-欧洲', '国内']));
  assert.equal(payload.restricted.length, 3);
  assert.equal(payload.summary.b2bExcludedCount, 1);
  assert.equal(payload.summary.channelMissingCount, 2);
  assert.equal(payload.diagnostics.mappingIssues.some((row) => row.materialCode === '1005'), false);
  assert.equal(payload.diagnostics.mappingIssues.some((row) => row.materialCode === '1006'), true);
  assert.equal(payload.diagnostics.mappingIssues.some((row) => row.materialCode === '1007'), true);
});

test('处置阈值严格大于才命中，且停止采购优先于限制采购', () => {
  const equalPayload = buildInventoryRiskAnalysis({
    now: NOW,
    inventoryModel: { rows: [summaryRow({ inventoryQty: 100 })], anomalies: [] },
    forecastRows: [wideForecast()],
    params: {
      channels: {
        overseasUs: { restrictThresholdDays: 30, stopThresholdDays: 40 }
      }
    }
  });
  assert.equal(equalPayload.summary.normalCount, 1);
  assert.equal(equalPayload.rows.length, 1);
  assert.equal(equalPayload.rows[0].action, '正常');
  assert.ok(equalPayload.rows[0].totalInventoryQty > 0);

  const payload = buildInventoryRiskAnalysis({
    now: NOW,
    inventoryModel: { rows: [summaryRow({ inventoryQty: 600 })], anomalies: [] },
    forecastRows: [wideForecast()],
    params: {
      channels: {
        overseasUs: { restrictThresholdDays: 100, stopThresholdDays: 100 }
      }
    }
  });
  assert.equal(payload.stopped.length, 1);
  assert.equal(payload.stopped[0].transitTurnoverDays, 180);
  assert.equal(payload.stopped[0].action, '停止采购');
});

test('无预测和预测为零均按999天进入停止采购', () => {
  const payload = buildInventoryRiskAnalysis({
    now: NOW,
    inventoryModel: {
      rows: [summaryRow(), summaryRow({ materialCode: '1002', sku: 'SKU-1002' })],
      anomalies: []
    },
    forecastRows: [wideForecast({
      '2026年8月': 0,
      '2026-09': 0,
      '2026/10': 0,
      '2026.11': 0,
      '2026年12月': 0,
      '2027-01': 0
    })]
  });
  assert.equal(payload.stopped.length, 2);
  const zero = payload.stopped.find((row) => row.materialCode === '1001');
  const missing = payload.stopped.find((row) => row.materialCode === '1002');
  assert.equal(zero.forecastStatus, '销售预测为0');
  assert.equal(missing.forecastStatus, '无销售预测');
  assert.equal(zero.forecastAvailability, '有预测销售');
  assert.equal(missing.forecastAvailability, '无预测销售');
  assert.equal(zero.transitTurnoverDays, 999);
  assert.equal(missing.fullChainCoverageDays, 999);
});

test('长表预测支持唯一SKU回退到物料编码', () => {
  const forecastRows = Array.from({ length: 6 }, (_, index) => ({
    事业部: '海外事业一部',
    SKU: 'SKU-1001',
    月份: `2026-${String(index + 8).padStart(2, '0')}`.replace('2026-13', '2027-01'),
    预测数量: 100
  }));
  const payload = buildInventoryRiskAnalysis({
    now: NOW,
    inventoryModel: { rows: [summaryRow({ inventoryQty: 400 })], anomalies: [] },
    forecastRows
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.stopped[0].materialCode, '1001');
  assert.equal(payload.stopped[0].forecastMonthlyAverage, 100);
});

test('销售预测文件缺失时阻止计算', () => {
  const payload = buildInventoryRiskAnalysis({
    now: NOW,
    inventoryModel: { rows: [summaryRow()], anomalies: [] },
    forecastRows: []
  });
  assert.equal(payload.ok, false);
  assert.equal(payload.status, 'missing_data');
});

test('备货复核物料编码模式只保留备货文件命中物料', () => {
  const payload = buildBeiHuoReviewAnalysis({
    now: NOW,
    mode: 'materialCode',
    stockupMaterialCodes: ['1001'],
    inventoryModel: {
      rows: [
        summaryRow({ inventoryQty: 60, transitQty: 30, unfulfilledQty: 10 }),
        summaryRow({ materialCode: '1002', sku: 'SKU-1002', inventoryQty: 500 })
      ]
    },
    forecastRows: [wideForecast(), wideForecast({ 物料编码: '1002' })]
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.status, 'ready');
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].materialCode, '1001');
  assert.equal(payload.rows[0].forecastMonthlyAverage, 100);
  assert.equal(payload.rows[0].transitTurnoverDays, 27);
  assert.equal(payload.rows[0].fullChainCoverageDays, 40);
  assert.equal(payload.rows[0].forecastSellableDays, 30);
  assert.equal(Math.round(payload.rows[0].historicalSellableDays * 100) / 100, 85.71);
  assert.deepEqual(payload.stockupInfo, { hasFile: true, materialCodeCount: 1 });
});

test('备货复核型号模式汇总同型号全部物料但只展示备货物料编码', () => {
  const payload = buildBeiHuoReviewAnalysis({
    now: NOW,
    mode: 'model',
    stockupMaterialCodes: ['1001'],
    inventoryModel: {
      rows: [
        summaryRow({ inventoryQty: 100, transitQty: 20, unfulfilledQty: 10 }),
        summaryRow({ materialCode: '1002', sku: 'SKU-1002', materialName: '同型号产品2', inventoryQty: 50, transitQty: 5, unfulfilledQty: 15 }),
        summaryRow({ materialCode: '1003', sku: 'SKU-1003', model: '其他型号', inventoryQty: 999 })
      ]
    },
    forecastRows: [
      wideForecast(),
      wideForecast({ 物料编码: '1002' }),
      wideForecast({ 物料编码: '1003' })
    ]
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].model, '测试型号');
  assert.equal(payload.rows[0].materialCode, '1001');
  assert.equal(payload.rows[0].onHandQty, 150);
  assert.equal(payload.rows[0].inTransitQty, 25);
  assert.equal(payload.rows[0].undeliveredQty, 25);
  assert.equal(payload.rows[0].forecastMonthlyAverage, 200);
});

test('备货文件无有效物料时返回空结果且不要求销售预测', () => {
  const payload = buildBeiHuoReviewAnalysis({
    now: NOW,
    inventoryModel: { rows: [summaryRow()] },
    forecastRows: [],
    stockupMaterialCodes: []
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.status, 'empty');
  assert.deepEqual(payload.rows, []);
  assert.deepEqual(payload.stockupInfo, { hasFile: false, materialCodeCount: 0 });
});

test('参数归一化计算渠道周期并阻止负数', () => {
  const params = normalizeInventoryRiskParams({});
  assert.equal(params.channels.overseasUs.spotDays, 40);
  assert.equal(params.channels.overseasUs.contractSigningDays, 10);
  assert.equal(params.channels.overseasUs.fullChainDays, 60);
  const custom = normalizeInventoryRiskParams({ channels: { overseasUs: { averageLeadTimeDays: 35, contractSigningDays: 12 } } });
  assert.equal(custom.channels.overseasUs.fullChainDays, 87);
  assert.throws(() => normalizeInventoryRiskParams({ channels: { domestic: { bookingDays: -1 } } }), /非负数字/);
});

test('供应计划分析页面、权限与API均注册在gendanjindu', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const server = fs.readFileSync(path.join(root, 'server', 'app.js'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const riskPage = fs.readFileSync(path.join(root, 'src', 'InventoryRiskPage.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
  assert.match(server, /'inventoryRisk'/);
  assert.match(server, /\/api\/inventory-risk\/query/);
  assert.match(server, /\/api\/inventory-risk\/params/);
  assert.match(server, /\/api\/inventory-risk\/export/);
  assert.match(client, /供应计划分析/);
  assert.match(client, /InventoryRiskPage/);
  assert.match(server, /buildInventoryRiskWorkbook\(\{[\s\S]*?includeDataSource: Boolean\(req\.body\?\.includeDataSource\)[\s\S]*?\}\)/);
  assert.doesNotMatch(server, /inventoryRiskSupplierContext/);
  assert.match(riskPage, /label="事业部"/);
  assert.match(riskPage, /label="产品线"/);
  assert.match(riskPage, /label="系列"/);
  assert.match(riskPage, /label="型号"/);
  assert.match(riskPage, /label="供应商简称"/);
  assert.match(riskPage, /supplierTotals\.get\(right\) - supplierTotals\.get\(left\)/);
  assert.match(riskPage, /label="渠道"/);
  assert.match(riskPage, /label="处置动作"/);
  assert.match(riskPage, /label="预测销售"/);
  assert.match(riskPage, /showDataSources \? '隐藏数据来源' : '显示数据来源'/);
  assert.match(riskPage, /showDataSources && <th>数据来源<\/th>/);
  assert.match(riskPage, /inventory-risk-table\$\{showDataSources \? ' show-data-source' : ''\}/);
  assert.match(riskPage, /includeDataSource: showDataSources/);
  assert.match(riskPage, /正在请求服务器生成 Excel/);
  assert.match(riskPage, /response\.body\?\.getReader/);
  assert.match(riskPage, /response\.headers\.get\('content-length'\)/);
  assert.match(riskPage, /exporting \? '导出中\.\.\.'/);
  assert.match(riskPage, /aria-live="polite"/);
  assert.match(styles, /\.inventory-risk-export-progress\.indeterminate span/);
  assert.match(riskPage, /有预测销售/);
  assert.match(riskPage, /无预测销售/);
  assert.match(riskPage, /forecastedCount: filteredRows\.filter\(\(row\) => row\.forecastAvailability === '有预测销售'\)\.length/);
  assert.match(riskPage, /unforecastedCount: filteredRows\.filter\(\(row\) => row\.forecastAvailability === '无预测销售'\)\.length/);
  assert.match(riskPage, /className="forecasted"/);
  assert.match(riskPage, /className="unforecasted"/);
  assert.match(riskPage, /有销售预测的物料编码数量/);
  assert.match(riskPage, /无销售预测的物料编码数量/);
  assert.match(styles, /\.inventory-risk-summary\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6,/);
  assert.match(styles, /\.inventory-risk-summary\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(riskPage, /库存总量/);
  assert.doesNotMatch(riskPage, /<span>映射待维护<\/span>/);
  assert.match(riskPage, /事业部 \+ 物料编码数量/);
  assert.match(riskPage, /在库<b>/);
  assert.match(riskPage, /在途<b>/);
  assert.match(riskPage, /未交付<b>/);
  const summaryMarkup = riskPage.slice(riskPage.indexOf('<section className="inventory-risk-summary">'));
  assert.ok(summaryMarkup.indexOf('库存总量') < summaryMarkup.indexOf('className="restricted"'));
  assert.match(riskPage, /在库在途周转天数/);
  assert.match(riskPage, /供应计划分析/);
  assert.doesNotMatch(riskPage, /localStorage|loadInventoryRiskParams|saveInventoryRiskParams/);
  assert.match(riskPage, /apiRequest\('\/api\/inventory-risk\/params', token\)/);
  assert.match(riskPage, /saveParams: force/);
  assert.match(riskPage, /参数保存在腾讯云/);
  assert.match(riskPage, /未交付供应商简称/);
  assert.match(riskPage, /在库量可销天数/);
  assert.match(riskPage, /全链路天数/);
  assert.match(riskPage, /合同签订/);
  assert.match(riskPage, /label="仓位位置"/);
  assert.match(riskPage, /label="站点"/);
  assert.match(riskPage, /warehouseLocations/);
  assert.match(riskPage, /全链路天数 = 现货天数 \+ 平均交期 \+ 合同签订/);
  assert.match(riskPage, /海外-美国/);
  assert.match(riskPage, /海外-欧洲/);
  assert.match(riskPage, /'海外事业一部',[\s\S]*'海外事业二部',[\s\S]*'国内事业部',[\s\S]*'全球招商事业部',[\s\S]*'销售部-工厂'/);
  assert.match(riskPage, /sort\(compareBusinessUnitFilterOptions\)/);
  assert.match(riskPage, /compareBusinessUnitFilterOptions\(left\.businessUnit, right\.businessUnit\)/);
  assert.equal((riskPage.match(/<RiskTable /g) || []).length, 1);
});
