import xlsx from 'xlsx';
import { PassThrough } from 'node:stream';

export const SUPPLY_PLAN_EXPORT_METRICS = [
  '销售预测',
  '未交付',
  '在途',
  '在库',
  '预测剩余库存',
  '建议采购'
];

const DETAIL_COLUMNS = [
  '产品线', '系列', '型号', '事业部', '物料编码', 'SKU', '名称', '产品阶段', '产品定位',
  '仓库', '渠道', '安全库存天数', '全链路天数', '在库量', '在途量', '在制量', '预测剩余库存', '供应计划指标'
];
export const SUPPLY_PLAN_PURCHASE_COLUMNS = [
  '产品线', '系列', '型号', '物料编码', 'SKU', '名称', '事业部', '在库量', '在途量', '未交付量',
  '预测日均', '库存可销天数', '距缺货天数', '安全库存数量', '建议采购数量', '动作结论'
];
const PURCHASE_COLUMNS = [
  '产品线', '系列', '型号', '事业部', '物料编码', 'SKU', '渠道',
  '建议采购量', '需下单时间', '对应周', '供应商', '采购下单人'
];
const METRIC_FILLS = {
  销售预测: 'FFFFFFFF',
  未交付: 'FFFFF3CD',
  在途: 'FFE2F0D9',
  在库: 'FFDDEBF7',
  预测剩余库存: 'FFE4DFEC',
  建议采购: 'FFFCE4D6'
};
const HEADER_FILL = 'FFD9EAF7';
const HEADER_FONT = 'FF17324D';
const BORDER_COLOR = 'FFCBD5E1';
const POSITIVE_PURCHASE_COLOR = 'FFC00000';

function text(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

function numberValue(value) {
  const parsed = Number.parseFloat(text(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function aliasValue(row, aliases) {
  for (const alias of aliases) {
    const value = text(row?.[alias]);
    if (value) return value;
  }
  const normalizedAliases = new Set(aliases.map((alias) => text(alias).toLowerCase().replace(/[\s_\-—（）()]/g, '')));
  for (const [key, value] of Object.entries(row || {})) {
    if (normalizedAliases.has(text(key).toLowerCase().replace(/[\s_\-—（）()]/g, '')) && text(value)) return text(value);
  }
  return '';
}

function materialCode(value) {
  return text(value).replace(/\.0$/, '');
}

function uniqueText(values) {
  const list = Array.isArray(values) ? values : [values];
  return [...new Set(list.flatMap((value) => text(value).split(/[&+、,，;；]/)).map(text).filter(Boolean))].join('、');
}

function assignmentMap(rows = []) {
  const grouped = new Map();
  rows.forEach((row) => {
    const code = materialCode(aliasValue(row, ['materialCode', '物料编码', '商品编码', '存货编码', '产品编码']));
    if (!code) return;
    const current = grouped.get(code) || { suppliers: [], owners: [] };
    current.suppliers.push(aliasValue(row, [
      'productLineDetailSupplier', '产品线明细供应商', '产品线明细-供应商', '产品明细供应商',
      '供应商全称', '供应商名称', 'supplier', '供应商', 'supplierShortName', '供应商简称'
    ]));
    current.owners.push(aliasValue(row, [
      'productLineDetailPurchaseOwner', '产品线明细-采购下单人', '产品线明细采购下单人',
      'purchaseOwner', '采购下单人', '下单人', '采购负责人'
    ]));
    grouped.set(code, current);
  });
  return new Map([...grouped].map(([code, value]) => [code, {
    supplier: uniqueText(value.suppliers),
    purchaseOwner: uniqueText(value.owners)
  }]));
}

function channelSettings(settings, row) {
  return settings?.channels?.[row.channelKey] || {};
}

function fullChainDays(settings = {}) {
  if (Number.isFinite(Number(settings.fullChainDays))) return numberValue(settings.fullChainDays);
  return [
    'onHandSellableDays', 'dispatchToShelfDays', 'transportDays', 'bookingDays',
    'averageLeadTimeDays', 'contractSigningDays'
  ].reduce((sum, field) => sum + numberValue(settings[field]), 0);
}

function dateAfterDays(value, days) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + Math.round(days));
  return date;
}

function matchesFilters(row, filters = {}) {
  return ['businessUnit', 'productLine', 'productSeries', 'actionConclusion'].every((field) => (
    !text(filters[field]) || text(row?.[field]) === text(filters[field])
  ));
}

function metricWeekValue(row, metric, weekIndex) {
  if (metric === '销售预测') return numberValue(row.weeklyForecast?.[weekIndex]);
  if (weekIndex > 0) return '';
  if (metric === '未交付') return numberValue(row.undeliveredQty);
  if (metric === '在途') return numberValue(row.inTransitQty);
  if (metric === '在库') return numberValue(row.onHandQty);
  if (metric === '预测剩余库存') return numberValue(row.inventoryRemainingQty);
  return metric === '建议采购' ? numberValue(row.purchaseGap) : '';
}

export function formatSupplyPlanExportDate(value = new Date()) {
  const date = new Date(value);
  const part = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
}

export function formatSupplyPlanCompactDate(value = new Date()) {
  return formatSupplyPlanExportDate(value).replaceAll('-', '');
}

export function buildSupplyPlanExportData({
  supplyPlanData = {},
  supplyPlanSettings = {},
  assignmentRows = [],
  filters = {},
  now = new Date()
} = {}) {
  const weeks = Array.isArray(supplyPlanData.weeks) ? supplyPlanData.weeks : [];
  const rows = (Array.isArray(supplyPlanData.rows) ? supplyPlanData.rows : [])
    .filter((row) => !row.isRelatedDetail && matchesFilters(row, filters));
  const assignments = assignmentMap(assignmentRows);
  const detailRows = [];
  const purchaseRows = [];

  rows.forEach((row) => {
    const settings = channelSettings(supplyPlanSettings, row);
    const chainDays = fullChainDays(settings);
    const safetyDays = numberValue(row.safetyDays ?? settings.safetyDays ?? chainDays);
    const inventoryRemaining = numberValue(row.inventoryRemainingQty);
    const warehouse = uniqueText(row.warehouses || [row.warehouseSite || row.warehouseCategory]);
    const fixedValues = [
      row.productLine, row.productSeries, row.model, row.businessUnit, materialCode(row.materialCode),
      row.sku, row.skuName || row.materialName, row.productLifecycle, row.productPositioning,
      warehouse, row.channel, safetyDays, chainDays, numberValue(row.onHandQty), numberValue(row.inTransitQty),
      numberValue(row.undeliveredQty), inventoryRemaining
    ];
    SUPPLY_PLAN_EXPORT_METRICS.forEach((metric) => {
      detailRows.push([...fixedValues, metric, ...weeks.map((_, index) => metricWeekValue(row, metric, index))]);
    });

    const purchaseGap = numberValue(row.purchaseGap);
    if (purchaseGap <= 0) return;
    const assignment = assignments.get(materialCode(row.materialCode)) || {};
    const orderOffsetDays = chainDays - numberValue(settings.onHandSellableDays);
    purchaseRows.push([
      row.productLine, row.productSeries, row.model, row.businessUnit, materialCode(row.materialCode),
      row.sku, row.channel, purchaseGap, dateAfterDays(now, orderOffsetDays), weeks[0]?.label || '',
      assignment.supplier || '', assignment.purchaseOwner || ''
    ]);
  });

  return {
    detailColumns: [...DETAIL_COLUMNS, ...weeks.map((week, index) => index === 0 ? '当前周' : week.label)],
    detailRows,
    purchaseColumns: PURCHASE_COLUMNS,
    purchaseRows,
    modelCount: new Set(rows.map((row) => row.modelKey || [row.productLine, row.productSeries, row.model].join('|'))).size,
    childCount: rows.length,
    weeks,
    horizonMonths: supplyPlanData.horizonMonths,
    generatedAt: new Date(now).toISOString()
  };
}

export function buildSupplyPlanPurchaseExportData({ supplyPlanData = {}, filters = {} } = {}) {
  const rows = (Array.isArray(supplyPlanData.rows) ? supplyPlanData.rows : [])
    .filter((row) => !row.isRelatedDetail && matchesFilters(row, filters) && numberValue(row.purchaseGap) > 0)
    .map((row) => [
      row.productLine,
      row.productSeries,
      row.model,
      materialCode(row.materialCode),
      row.sku,
      row.skuName || row.materialName,
      row.businessUnit,
      numberValue(row.onHandQty),
      numberValue(row.inTransitQty),
      numberValue(row.undeliveredQty),
      numberValue(row.forecastDaily),
      numberValue(row.stockCoverDays),
      numberValue(row.daysUntilShortage),
      numberValue(row.safetyStockQty),
      numberValue(row.purchaseGap),
      row.actionConclusion
    ]);
  return { columns: SUPPLY_PLAN_PURCHASE_COLUMNS, rows };
}

export function buildSupplyPlanExportWorkbook(data = {}) {
  const workbook = xlsx.utils.book_new();
  const detailSheet = xlsx.utils.aoa_to_sheet([data.detailColumns || [], ...(data.detailRows || [])]);
  const purchaseSheet = xlsx.utils.aoa_to_sheet([data.purchaseColumns || [], ...(data.purchaseRows || [])], { cellDates: true });
  xlsx.utils.book_append_sheet(workbook, detailSheet, '周维度备货计划');
  xlsx.utils.book_append_sheet(workbook, purchaseSheet, '建议采购汇总');
  return workbook;
}

function thinBorder() {
  const side = { style: 'thin', color: { argb: BORDER_COLOR } };
  return { top: side, left: side, bottom: side, right: side };
}

function styleHeaderRow(row) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_FONT } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.border = thinBorder();
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
}

function styleDataRow(row, columnCount, fill = '') {
  for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
    const cell = row.getCell(columnNumber);
    cell.border = thinBorder();
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    if (typeof cell.value === 'number') cell.numFmt = '#,##0.##';
    if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  }
}

export async function generateSupplyPlanExcel(data = {}) {
  const excelModule = await import('exceljs');
  const ExcelJS = excelModule.default || excelModule;
  const outputStream = new PassThrough();
  const chunks = [];
  const outputComplete = new Promise((resolve, reject) => {
    outputStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    outputStream.on('end', resolve);
    outputStream.on('error', reject);
  });
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: outputStream,
    useStyles: true,
    useSharedStrings: false
  });
  workbook.creator = '备货出货计划';
  workbook.created = new Date(data.generatedAt || Date.now());

  const detailColumns = data.detailColumns || [];
  const detailSheet = workbook.addWorksheet('周维度备货计划', {
    views: [{ state: 'frozen', xSplit: 14, ySplit: 1, topLeftCell: 'O2', activeCell: 'O2' }]
  });
  const fixedWidths = [12, 12, 16, 14, 16, 16, 24, 12, 12, 20, 13, 15, 15, 12, 12, 12, 12, 16];
  detailSheet.columns = detailColumns.map((_, index) => ({
    key: `column${index + 1}`,
    width: fixedWidths[index] || 10
  }));
  const detailHeader = detailSheet.addRow(detailColumns);
  styleHeaderRow(detailHeader);
  detailHeader.commit();
  const metricColumn = (data.detailColumns || []).indexOf('供应计划指标') + 1;
  const currentWeekColumn = (data.detailColumns || []).indexOf('当前周') + 1;
  (data.detailRows || []).forEach((values) => {
    const row = detailSheet.addRow(values);
    const metric = text(values[metricColumn - 1]);
    const fill = METRIC_FILLS[metric];
    styleDataRow(row, detailColumns.length, fill);
    if (metric === '建议采购' && numberValue(row.getCell(currentWeekColumn).value) > 0) {
      row.getCell(currentWeekColumn).font = { bold: true, color: { argb: POSITIVE_PURCHASE_COLOR } };
    }
    row.commit();
  });
  detailSheet.autoFilter = {
    from: 'A1',
    to: `${xlsx.utils.encode_col(Math.max(0, detailColumns.length - 1))}${Math.max(1, (data.detailRows || []).length + 1)}`
  };
  detailSheet.commit();

  const purchaseColumns = data.purchaseColumns || [];
  const purchaseSheet = workbook.addWorksheet('建议采购汇总', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }]
  });
  const purchaseWidths = [12, 12, 16, 14, 16, 16, 13, 15, 15, 12, 24, 16];
  purchaseSheet.columns = purchaseColumns.map((_, index) => ({
    key: `column${index + 1}`,
    width: purchaseWidths[index] || 12
  }));
  const purchaseHeader = purchaseSheet.addRow(purchaseColumns);
  styleHeaderRow(purchaseHeader);
  purchaseHeader.commit();
  const purchaseQtyColumn = (data.purchaseColumns || []).indexOf('建议采购量') + 1;
  const orderDateColumn = (data.purchaseColumns || []).indexOf('需下单时间') + 1;
  (data.purchaseRows || []).forEach((values) => {
    const row = purchaseSheet.addRow(values);
    styleDataRow(row, purchaseColumns.length);
    row.getCell(purchaseQtyColumn).font = { bold: true, color: { argb: POSITIVE_PURCHASE_COLOR } };
    row.getCell(orderDateColumn).numFmt = 'yyyy-mm-dd';
    row.commit();
  });
  purchaseSheet.autoFilter = {
    from: 'A1',
    to: `${xlsx.utils.encode_col(Math.max(0, purchaseColumns.length - 1))}${Math.max(1, (data.purchaseRows || []).length + 1)}`
  };
  purchaseSheet.commit();

  await workbook.commit();
  await outputComplete;
  return Buffer.concat(chunks);
}

export async function generateSupplyPlanPurchaseExcel(data = {}) {
  const excelModule = await import('exceljs');
  const ExcelJS = excelModule.default || excelModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '备货出货计划';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('备货计划', {
    views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }]
  });
  const columns = data.columns || SUPPLY_PLAN_PURCHASE_COLUMNS;
  const rows = data.rows || [];
  const widths = [12, 12, 16, 16, 16, 24, 14, 12, 12, 12, 13, 16, 14, 16, 16, 14];
  worksheet.columns = columns.map((header, index) => ({
    header,
    key: `column${index + 1}`,
    width: widths[index] || 12
  }));
  const header = worksheet.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = { name: '宋体', size: 11, bold: true, color: { argb: 'FF000000' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
    cell.border = thinBorder();
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  rows.forEach((values) => {
    const row = worksheet.addRow(values);
    row.height = 22;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: '宋体', size: 11, color: { argb: 'FF000000' } };
      cell.border = thinBorder();
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      if (typeof cell.value === 'number') cell.numFmt = '#,##0.##';
    });
  });
  worksheet.autoFilter = {
    from: 'A1',
    to: `${xlsx.utils.encode_col(Math.max(0, columns.length - 1))}${Math.max(1, rows.length + 1)}`
  };
  return workbook.xlsx.writeBuffer();
}
