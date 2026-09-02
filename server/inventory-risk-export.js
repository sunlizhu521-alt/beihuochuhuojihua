import xlsx from 'xlsx';

export const INVENTORY_RISK_EXPORT_COLUMNS = [
  ['数据来源', 'dataSource'],
  ['渠道', 'channel'],
  ['销售区域', 'salesRegion'],
  ['事业部', 'businessUnit'],
  ['产品线', 'productLine'],
  ['物料编码', 'materialCode'],
  ['SKU', 'sku'],
  ['物料名称', 'materialName'],
  ['未交付供应商简称', 'unfulfilledSupplierShortName'],
  ['在库数量', 'onHandQty'],
  ['在途数量', 'inTransitQty'],
  ['待交付数量', 'undeliveredQty'],
  ['合计数量', 'totalInventoryQty'],
  ['预测月均销量', 'forecastMonthlyAverage'],
  ['最近N月平均月销量', 'historicalMonthlyAverage'],
  ['在库在途周转天数', 'transitTurnoverDays'],
  ['全链覆盖天数', 'fullChainCoverageDays'],
  ['预测状态', 'forecastStatus'],
  ['处置动作', 'action']
];

const INVENTORY_RISK_PARAMETER_COLUMNS = [
  '渠道', '在库量可销天数', '发货到上架', '海运/运输', '订舱/预约', '现货天数',
  '平均交期', '合同签订', '全链路天数', '限制采购阈值', '停止采购阈值', '预测月数', '历史月数',
  '预测开始月份', '预测结束月份', '历史开始月份', '历史结束月份', '生成时间'
];

function cellValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return value;
}

function sheetFromObjects(rows = [], columns = []) {
  const headers = columns.length
    ? columns
    : [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  const values = rows.map((row) => headers.map((header) => cellValue(row?.[header])));
  return xlsx.utils.aoa_to_sheet([headers, ...values]);
}

export function inventoryRiskExportRows(rows = [], { includeDataSource = true } = {}) {
  const columns = includeDataSource
    ? INVENTORY_RISK_EXPORT_COLUMNS
    : INVENTORY_RISK_EXPORT_COLUMNS.filter(([, key]) => key !== 'dataSource');
  return rows.map((row) => Object.fromEntries(columns.map(([label, key]) => [
    label,
    key === 'unfulfilledSupplierShortName'
      ? row?.[key] || '未匹配'
      : key === 'dataSource' ? row?.[key] || '无仓库数据' : row?.[key] ?? ''
  ])));
}

export function inventoryRiskParameterRows(payload = {}) {
  const labels = { overseasUs: '海外-美国', overseasEurope: '海外-欧洲', domestic: '国内' };
  return Object.entries(payload.params?.channels || {}).map(([key, settings]) => ({
    '渠道': labels[key] || key,
    '在库量可销天数': settings.onHandSellableDays,
    '发货到上架': settings.dispatchToShelfDays,
    '海运/运输': settings.transportDays,
    '订舱/预约': settings.bookingDays,
    '现货天数': settings.spotDays,
    '平均交期': settings.averageLeadTimeDays,
    '合同签订': settings.contractSigningDays,
    '全链路天数': settings.fullChainDays,
    '限制采购阈值': settings.restrictThresholdDays,
    '停止采购阈值': settings.stopThresholdDays,
    '预测月数': payload.params?.forecastMonths,
    '历史月数': payload.params?.historicalMonths,
    '预测开始月份': payload.periods?.forecastStartMonth,
    '预测结束月份': payload.periods?.forecastEndMonth,
    '历史开始月份': payload.periods?.historicalStartMonth,
    '历史结束月份': payload.periods?.historicalEndMonth,
    '生成时间': payload.generatedAt
  }));
}

export function buildInventoryRiskWorkbook(payload = {}) {
  const workbook = xlsx.utils.book_new();
  const includeDataSource = payload.includeDataSource !== false;
  const exportColumns = includeDataSource
    ? INVENTORY_RISK_EXPORT_COLUMNS
    : INVENTORY_RISK_EXPORT_COLUMNS.filter(([, key]) => key !== 'dataSource');
  const exportRows = inventoryRiskExportRows(payload.rows, { includeDataSource });
  xlsx.utils.book_append_sheet(
    workbook,
    sheetFromObjects(exportRows, exportColumns.map(([label]) => label)),
    '处置清单'
  );
  xlsx.utils.book_append_sheet(workbook, sheetFromObjects(payload.diagnostics?.mappingIssues || []), '映射诊断');
  xlsx.utils.book_append_sheet(workbook, sheetFromObjects(payload.diagnostics?.forecastIssues || []), '预测诊断');
  xlsx.utils.book_append_sheet(
    workbook,
    sheetFromObjects(inventoryRiskParameterRows(payload), INVENTORY_RISK_PARAMETER_COLUMNS),
    '计算参数'
  );
  return workbook;
}
