import assert from 'node:assert/strict';
import test from 'node:test';
import xlsx from 'xlsx';
import {
  buildInventoryRiskWorkbook,
  INVENTORY_RISK_EXPORT_COLUMNS,
  inventoryRiskExportRows,
  inventoryRiskParameterRows
} from './inventory-risk-export.js';

const expectedHeaders = [
  '数据来源',
  '渠道', '销售区域', '事业部', '产品线', '物料编码', 'SKU', '物料名称', '未交付供应商简称',
  '在库数量', '在途数量', '待交付数量', '合计数量', '预测月均销量', '最近N月平均月销量',
  '在库在途周转天数', '全链覆盖天数', '预测状态', '处置动作'
];

test('库存风险导出严格使用页面列顺序并保留供应商简称', () => {
  assert.deepEqual(INVENTORY_RISK_EXPORT_COLUMNS.map(([label]) => label), expectedHeaders);
  const [row] = inventoryRiskExportRows([{
    dataSource: 'FBA库存报表：美国仓 → 映射：101-US',
    channel: '海外-美国', salesRegion: '美国', businessUnit: '海外事业一部', productLine: '产品线A',
    materialCode: '1001', sku: 'SKU-1001', materialName: '测试产品',
    unfulfilledSupplierShortName: '供应商甲&供应商乙', onHandQty: 10, inTransitQty: 20,
    undeliveredQty: 30, totalInventoryQty: 60, forecastMonthlyAverage: 40, historicalMonthlyAverage: 50,
    transitTurnoverDays: 22.5, fullChainCoverageDays: 67.5, forecastStatus: '已匹配', action: '限制采购'
  }]);
  assert.deepEqual(Object.keys(row), expectedHeaders);
  assert.equal(row.数据来源, 'FBA库存报表：美国仓 → 映射：101-US');
  assert.equal(row.未交付供应商简称, '供应商甲&供应商乙');
  assert.equal(row.合计数量, 60);
});

test('计算参数导出合同签订并使用新全链路公式结果', () => {
  const [row] = inventoryRiskParameterRows({
    params: {
      forecastMonths: 6,
      historicalMonths: 6,
      channels: {
        overseasUs: { spotDays: 40, averageLeadTimeDays: 35, contractSigningDays: 12, fullChainDays: 87 }
      }
    },
    periods: {}
  });
  assert.equal(row.平均交期, 35);
  assert.equal(row.合同签订, 12);
  assert.equal(row.全链路天数, 87);
});

test('库存风险工作簿在诊断为空或含嵌套字段时仍可导出', () => {
  const workbook = buildInventoryRiskWorkbook({
    rows: [],
    params: { channels: {}, forecastMonths: 6, historicalMonths: 6 },
    periods: {},
    diagnostics: {
      mappingIssues: [],
      forecastIssues: [{ issue: '测试', detail: { headers: ['事业部', '物料编码'] } }]
    }
  });
  const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  assert.ok(buffer.length > 0);
  const exported = xlsx.read(buffer, { type: 'buffer' });
  assert.deepEqual(exported.SheetNames, ['处置清单', '映射诊断', '预测诊断', '计算参数']);
  const disposalRows = xlsx.utils.sheet_to_json(exported.Sheets['处置清单'], { header: 1 });
  assert.deepEqual(disposalRows[0], expectedHeaders);
  const diagnosticRows = xlsx.utils.sheet_to_json(exported.Sheets['预测诊断']);
  assert.equal(diagnosticRows[0].detail, JSON.stringify({ headers: ['事业部', '物料编码'] }));
});
