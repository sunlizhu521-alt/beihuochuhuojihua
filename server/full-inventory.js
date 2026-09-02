import xlsx from 'xlsx';
import { parseManualProgressRows } from './manual-progress.js';

export const FULL_INVENTORY_SHEETS = Object.freeze(['成品', '退货和配件']);

const GROUP_DEFINITIONS = Object.freeze([
  { key: 'finished', label: '成品', sheetName: '成品' },
  { key: 'returnAccessory', label: '退货和配件', sheetName: '退货和配件' }
]);

function text(value) {
  return String(value ?? '').trim();
}

function normalizedHeader(value) {
  return text(value).normalize('NFKC').toLowerCase().replace(/[\s_\-—:：/\\]+/g, '');
}

function uniqueColumns(values = []) {
  const seen = new Map();
  return values.map((value) => {
    const column = text(value);
    if (!column) return '';
    const count = seen.get(column) || 0;
    seen.set(column, count + 1);
    return count ? `${column}_${count + 1}` : column;
  });
}

function rowObject(columns, values = []) {
  const row = {};
  columns.forEach((column, index) => {
    if (column) row[column] = values[index] ?? '';
  });
  return row;
}

function rowValue(row, aliases = []) {
  const aliasKeys = new Set(aliases.map(normalizedHeader).filter(Boolean));
  for (const [column, value] of Object.entries(row || {})) {
    if (aliasKeys.has(normalizedHeader(column)) && text(value)) return value;
  }
  return '';
}

function safeNumber(value) {
  const parsed = Number(text(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function fullInventoryMaterialCode(value) {
  return text(value).normalize('NFKC').replace(/\s+/g, '').replace(/\.0$/, '');
}

function fullInventoryBusinessUnit(value) {
  return text(value).normalize('NFKC');
}

function monthValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
  }
  const raw = text(value).normalize('NFKC');
  const match = raw.match(/^(\d{4})[-/.年](\d{1,2})(?:[-/.月]|$)/);
  if (match) {
    const month = Number(match[2]);
    return month >= 1 && month <= 12 ? `${match[1]}-${String(month).padStart(2, '0')}` : '';
  }
  const compactMatch = raw.match(/^(\d{4})(\d{2})(?:\d{2})?$/);
  if (compactMatch) {
    const month = Number(compactMatch[2]);
    return month >= 1 && month <= 12 ? `${compactMatch[1]}-${compactMatch[2]}` : '';
  }
  const parsed = new Date(raw);
  if (!raw || Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
}

function groupKey(businessUnit, materialCode) {
  return `${fullInventoryBusinessUnit(businessUnit)}\u001f${fullInventoryMaterialCode(materialCode)}`;
}

export function parseFullInventoryWorkbook(file) {
  if (!file?.buffer) throw new Error('未收到上传文件');
  const workbook = xlsx.read(file.buffer, {
    type: 'buffer',
    cellDates: true,
    dense: true,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    WTF: false
  });
  const missingSheets = FULL_INVENTORY_SHEETS.filter((sheetName) => !workbook.SheetNames.includes(sheetName));
  if (missingSheets.length) {
    const error = new Error(`全量库存底表缺少工作表：${missingSheets.join('、')}`);
    error.status = 400;
    error.publicMessage = error.message;
    throw error;
  }

  const sheets = FULL_INVENTORY_SHEETS.map((sheetName) => {
    const aoa = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false
    });
    const columns = uniqueColumns(aoa[1] || []);
    let inheritedBusinessUnit = '';
    let inheritedWarehouse = '';
    const rows = aoa.slice(2).flatMap((values) => {
      const source = rowObject(columns, values);
      const directBusinessUnit = rowValue(source, ['事业部', '所属事业部']);
      if (text(directBusinessUnit)) {
        const nextBusinessUnit = fullInventoryBusinessUnit(directBusinessUnit);
        if (nextBusinessUnit !== inheritedBusinessUnit) inheritedWarehouse = '';
        inheritedBusinessUnit = nextBusinessUnit;
      }
      const directWarehouse = rowValue(source, ['仓库', '仓库名称', '仓库名', 'warehouse']);
      if (text(directWarehouse)) inheritedWarehouse = text(directWarehouse);
      const businessUnit = fullInventoryBusinessUnit(directBusinessUnit || inheritedBusinessUnit);
      const materialCode = fullInventoryMaterialCode(rowValue(source, ['物料编码', '品号', '物料编号', '物料代码']));
      if (!businessUnit || !materialCode) return [];
      return [{
        businessUnit,
        warehouse: text(directWarehouse || inheritedWarehouse),
        materialCode,
        sku: text(rowValue(source, ['SKU', '产品SKU'])),
        inventoryQty: safeNumber(rowValue(source, ['在库', '在库数量', '在库量'])),
        transitQty: safeNumber(rowValue(source, ['在途', '在途数量', '在途量'])),
        __sourceSheet: sheetName
      }];
    });
    return {
      sheetName,
      rows,
      columns: ['事业部', '仓库', '物料编码', 'SKU', '在库', '在途'],
      headerRow: 2
    };
  });

  return {
    sheetNames: workbook.SheetNames,
    sheetPreviews: [],
    sheets,
    rows: sheets.flatMap((sheet) => sheet.rows),
    selectedSheetNames: [...FULL_INVENTORY_SHEETS],
    mapping: {
      businessUnit: '事业部',
      materialCode: '物料编码',
      sku: 'SKU',
      inventoryQty: '在库',
      transitQty: '在途'
    }
  };
}

export function buildFullInventorySummary({
  inventoryRows = [],
  productRows = [],
  salesRows = [],
  undeliveredRows = [],
  updatedAt = ''
} = {}) {
  const productMap = new Map();
  productRows.forEach((row) => {
    const materialCode = fullInventoryMaterialCode(rowValue(row, ['materialCode', '物料编码', '品号', '物料代码']));
    if (!materialCode || productMap.has(materialCode)) return;
    productMap.set(materialCode, {
      productLine: text(rowValue(row, ['productLine', '销售产品线', '产品线'])),
      productSeries: text(rowValue(row, ['productSeries', '销售系列', '系列'])),
      sku: text(rowValue(row, ['sku', 'SKU']))
    });
  });

  const salesMap = new Map();
  const months = new Set();
  salesRows.forEach((row) => {
    const businessUnit = fullInventoryBusinessUnit(rowValue(row, ['businessUnit', '事业部']));
    const materialCode = fullInventoryMaterialCode(rowValue(row, ['materialCode', '物料编码', '品号', '物料代码']));
    const month = monthValue(rowValue(row, ['date', '日期', '销售日期', '月份']));
    if (!businessUnit || !materialCode || !month) return;
    months.add(month);
    const key = groupKey(businessUnit, materialCode);
    const byMonth = salesMap.get(key) || {};
    byMonth[month] = (byMonth[month] || 0) + safeNumber(rowValue(row, ['salesQty', '销售数量', '销量']));
    salesMap.set(key, byMonth);
  });

  const undeliveredMap = new Map();
  undeliveredRows.forEach((row) => {
    const businessUnit = fullInventoryBusinessUnit(rowValue(row, ['businessUnit', 'business_unit', '事业部']));
    const materialCode = fullInventoryMaterialCode(rowValue(row, ['materialCode', 'material_code', '物料编码']));
    if (!businessUnit || !materialCode) return;
    const key = groupKey(businessUnit, materialCode);
    undeliveredMap.set(key, (undeliveredMap.get(key) || 0) + safeNumber(rowValue(row, ['undeliveredQty', 'undelivered_qty', '未交付数量'])));
  });

  const aggregateBySheet = new Map(GROUP_DEFINITIONS.map((group) => [group.sheetName, new Map()]));
  inventoryRows.forEach((row) => {
    const sourceSheet = text(row.__sourceSheet);
    const aggregate = aggregateBySheet.get(sourceSheet);
    if (!aggregate) return;
    const businessUnit = fullInventoryBusinessUnit(rowValue(row, ['businessUnit', '事业部']));
    const materialCode = fullInventoryMaterialCode(rowValue(row, ['materialCode', '物料编码', '品号', '物料代码']));
    if (!businessUnit || !materialCode) return;
    const warehouse = text(rowValue(row, ['warehouse', '仓库', '仓库名称']));
    const key = `${groupKey(businessUnit, materialCode)}\u001f${warehouse}`;
    const current = aggregate.get(key) || {
      businessUnit,
      warehouse,
      materialCode,
      sku: '',
      inventoryQty: 0,
      transitQty: 0
    };
    current.sku ||= text(rowValue(row, ['sku', 'SKU', '产品SKU']));
    current.inventoryQty += safeNumber(rowValue(row, ['inventoryQty', '在库', '在库数量']));
    current.transitQty += safeNumber(rowValue(row, ['transitQty', '在途', '在途数量']));
    aggregate.set(key, current);
  });

  const groups = GROUP_DEFINITIONS.map((group) => {
    const rows = [...aggregateBySheet.get(group.sheetName).values()].map((row) => {
      const key = groupKey(row.businessUnit, row.materialCode);
      const dimension = productMap.get(row.materialCode) || {};
      const salesByMonth = salesMap.get(key) || {};
      return {
        businessUnit: row.businessUnit,
        warehouse: row.warehouse,
        materialCode: row.materialCode,
        sku: row.sku,
        productLine: dimension.productLine || '',
        productSeries: dimension.productSeries || '',
        inventoryQty: row.inventoryQty,
        transitQty: row.transitQty,
        undeliveredQty: undeliveredMap.get(key) || 0,
        salesByMonth: Object.fromEntries(Object.entries(salesByMonth).sort(([left], [right]) => left.localeCompare(right)))
      };
    }).sort((left, right) => (
      left.businessUnit.localeCompare(right.businessUnit, 'zh-CN')
      || left.materialCode.localeCompare(right.materialCode, 'zh-CN', { numeric: true })
      || (left.warehouse || '').localeCompare(right.warehouse || '', 'zh-CN')
    ));
    return { key: group.key, label: group.label, rows };
  });

  const undeliveredGroupRows = [...undeliveredMap.entries()]
    .map(([key, undeliveredQty]) => {
      const [businessUnit, materialCode] = key.split('\u001f');
      const dimension = productMap.get(materialCode) || {};
      const salesByMonth = salesMap.get(key) || {};
      return {
        businessUnit,
        materialCode,
        sku: dimension.sku || '',
        productLine: dimension.productLine || '',
        productSeries: dimension.productSeries || '',
        inventoryQty: 0,
        transitQty: 0,
        undeliveredQty,
        salesByMonth: Object.fromEntries(Object.entries(salesByMonth).sort(([left], [right]) => left.localeCompare(right)))
      };
    })
    .filter((row) => row.undeliveredQty > 0)
    .sort((left, right) => (
      left.businessUnit.localeCompare(right.businessUnit, 'zh-CN')
      || left.materialCode.localeCompare(right.materialCode, 'zh-CN', { numeric: true })
    ));
  groups.push({ key: 'undelivered', label: '未交付', rows: undeliveredGroupRows });

  return {
    updatedAt: text(updatedAt),
    months: [...months].sort(),
    groups
  };
}

export function inspectFullInventoryWorkbook(file) {
  const parsed = parseFullInventoryWorkbook(file);
  return {
    sheetNames: parsed.sheetNames,
    columns: ['事业部', '仓库', '物料编码', 'SKU', '在库', '在途'],
    previewRows: parsed.rows.slice(0, 8),
    rowCount: parsed.rows.length,
    totalRowCount: parsed.rows.length,
    recognizedSheets: FULL_INVENTORY_SHEETS.length,
    sheetPreviews: parsed.sheets.map((sheet) => ({
      sheetName: sheet.sheetName,
      columns: sheet.columns,
      rowCount: sheet.rows.length
    }))
  };
}

export function parseOrderFulfillmentWorkbook(file) {
  if (!file?.buffer) throw new Error('未收到上传文件');
  const workbook = xlsx.read(file.buffer, {
    type: 'buffer',
    cellDates: true,
    dense: true,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    WTF: false
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('订单履约表缺少工作表');
  const aoa = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false
  });
  const columns = uniqueColumns(aoa[1] || []);
  const rawRows = aoa.slice(2)
    .map((values) => rowObject(columns, values))
    .filter((row) => text(row['物料编码']) || text(row['采购订单号']) || text(row['SKU']));
  const parsed = parseManualProgressRows(rawRows, { headerRow: 2 });
  const rows = parsed.rows.map(({ raw: _raw, ...row }) => row);
  return {
    sheetNames: workbook.SheetNames,
    sheetPreviews: [],
    sheets: [{ sheetName, rows, columns, headerRow: 2 }],
    rows,
    selectedSheetNames: [sheetName],
    mapping: { materialCode: '物料编码', orderNo: '采购订单号' }
  };
}

export function inspectOrderFulfillmentWorkbook(file) {
  const parsed = parseOrderFulfillmentWorkbook(file);
  return {
    sheetNames: parsed.sheetNames,
    columns: ['采购组', '采购下单人', '下单月份', '事业部', '采购订单号', '供应商简称', '产品线', '系列', '物料编码', 'SKU', '物料名称', '未交付数量', '已下单未备料未生产', '已备料未生产', '生产中产品', '完工未发产品', '已发货数量', '合同约定交期', '生产中交付时间', '未生产预计交付时间', '是否正常履约', '未履约原因'],
    previewRows: parsed.rows.slice(0, 8),
    rowCount: parsed.rows.length,
    totalRowCount: parsed.rows.length,
    recognizedSheets: 1,
    sheetPreviews: parsed.sheets.map((sheet) => ({
      sheetName: sheet.sheetName,
      columns: sheet.columns,
      rowCount: sheet.rows.length
    }))
  };
}
