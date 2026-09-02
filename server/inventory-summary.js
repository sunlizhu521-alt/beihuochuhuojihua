import xlsx from 'xlsx';

const INVENTORY_SLOT_IDS = new Set([
  ...Array.from({ length: 14 }, (_, index) => `inventorySummaryFile${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) => `inventorySummaryFile${index + 17}`)
]);
const UNIQUE_SHEET_SLOT_IDS = new Set([
  'inventorySummaryFile1',
  'inventorySummaryFile2',
  'inventorySummaryFile3',
  'inventorySummaryFile4',
  'inventorySummaryFile6',
  'inventorySummaryFile7',
  'inventorySummaryFile8',
  'inventorySummaryFile9',
  'inventorySummaryFile10',
  'inventorySummaryFile11',
  'inventorySummaryFile12',
  'inventorySummaryFile13',
  'inventorySummaryFile14',
  'inventorySummaryFile17'
]);
const FBA_TRANSIT_STATUSES = new Set([
  'RECEIVING',
  'READY_TO_SHIP',
  'CLOSED',
  'IN_TRANSIT',
  'WORKING',
  'SHIPPED',
  'DELIVERED'
]);
const FBM_TRANSIT_WAREHOUSES = new Set([
  '102-US-海外二部-海上在途',
  '101-US-海外一部-海上在途',
  '101-G-海外一部-海上在途',
  '102-Q-海外二部-海上在途',
  '102-G-海外二部-海上在途',
  '104-US-全球招商部-海上在途',
  '106-G-国内事业部-海上在途',
  '101-G海外一部供应商仓跨境医疗器械'
].map(matchKey));
const FBM_TRANSIT_DOCUMENT_STATUSES = new Set(['待收货', '待配货'].map(matchKey));

const FIELD_ALIASES = {
  subject: ['主体', '使用组织', '库存组织'],
  storeName: ['店铺', '店铺名称'],
  marketplace: ['站点', '国家', '国家/地区', '销售平台'],
  sku: ['SKU', 'sku', 'MSKU', 'Seller SKU', '卖家SKU', '商品SKU'],
  identifier: ['识别码', '物料编码', '品号'],
  warehouseName: ['仓库名称', '仓库名', '仓库', '收货仓库', '发货仓库（单据）', '发货仓库(单据)'],
  receivingWarehouseName: ['收货仓库'],
  inventoryAttribute: ['库存属性', '库存筛选'],
  endingInventoryQty: [
    '期末库存(含移仓)-数量',
    '期末库存（含移仓）-数量',
    '期末库存(含移仓)数量',
    '期末库存（含移仓）数量'
  ],
  actualTotalQty: ['实际总量'],
  totalInventoryQty: ['总库存数量', '总库存(数量)', '总库存（数量）'],
  shipmentStatus: ['货件状态'],
  dispatchQty: ['发货数量'],
  shippedQty: ['已发货'],
  signedQty: ['签收量'],
  stockupQty: ['备货数量'],
  receivedQty: ['收货数量'],
  documentStatus: ['单据状态'],
  domesticStockQty: ['库存量(主单位)', '库存量（主单位）'],
  jdId: ['SKU', 'sku', '京东ID', '京东id', 'ID', 'id'],
  jdRdc: ['RDC'],
  jdStockQty: ['全国现货库存', '现货库存'],
  jdTransitQty: ['在途数量'],
  wfsTransitQty: ['在途数量', '在途量', '运输中数量', '入库中数量', '数量'],
  date: ['日期'],
  businessUnit: ['事业部'],
  materialCode: ['物料编码', '品号'],
  salesQty: ['销售数量'],
  salesAmount: ['销售金额'],
  lingxingWarehouseName: ['领星FBA仓库', '领星FBA仓', '领星仓库名称', '领星仓库', '仓库'],
  kingdeeWarehouseName: ['金蝶仓库名称', '金蝶仓库', '金蝶名称'],
  lingxingSku: ['*SKU', 'SKU', '领星SKU', '领星MSKU', 'MSKU'],
  month: ['下单月份'],
  remainingQty: ['备货剩余数量', '未交付数量'],
  finishedQty: ['完工未发产品'],
  unpreparedQty: ['已下单未备料未生产'],
  preparedNotStartedQty: ['已备料未生产'],
  inProductionQty: ['生产中产品'],
  deliveryStatus: ['是否需正常交货'],
  supplierShortName: ['供应商简称', '未交付供应商简称'],
  unfulfilledReason: ['未履约原因'],
  reasonDetail: ['原因详情'],
  remark: ['备注']
};

const SLOT_SCHEMAS = {
  inventorySummaryFile1: {
    required: ['sku', 'warehouseName', 'inventoryAttribute', 'endingInventoryQty'],
    fields: ['storeName', 'marketplace', 'sku', 'warehouseName', 'inventoryAttribute', 'endingInventoryQty']
  },
  inventorySummaryFile2: {
    required: ['identifier', 'warehouseName', 'actualTotalQty'],
    fields: ['storeName', 'marketplace', 'identifier', 'warehouseName', 'actualTotalQty']
  },
  inventorySummaryFile3: {
    required: ['sku', 'warehouseName', 'totalInventoryQty'],
    fields: ['storeName', 'marketplace', 'sku', 'warehouseName', 'totalInventoryQty']
  },
  inventorySummaryFile4: {
    required: ['storeName', 'sku', 'shipmentStatus', 'dispatchQty', 'shippedQty', 'signedQty'],
    fields: ['storeName', 'marketplace', 'sku', 'shipmentStatus', 'dispatchQty', 'shippedQty', 'signedQty']
  },
  inventorySummaryFile5: {
    required: ['sku', 'warehouseName', 'receivingWarehouseName', 'documentStatus', 'stockupQty', 'receivedQty'],
    fields: ['storeName', 'marketplace', 'sku', 'warehouseName', 'receivingWarehouseName', 'documentStatus', 'stockupQty', 'receivedQty']
  },
  inventorySummaryFile6: {
    required: ['subject', 'warehouseName', 'materialCode', 'domesticStockQty'],
    fields: ['subject', 'warehouseName', 'materialCode', 'domesticStockQty']
  },
  inventorySummaryFile7: {
    required: ['jdId', 'jdStockQty'],
    fields: ['jdId', 'jdRdc', 'jdStockQty']
  },
  inventorySummaryFile8: {
    required: ['date', 'businessUnit', 'materialCode', 'salesQty', 'salesAmount'],
    fields: ['date', 'businessUnit', 'materialCode', 'salesQty', 'salesAmount']
  },
  inventorySummaryFile9: {
    required: ['subject', 'lingxingWarehouseName', 'kingdeeWarehouseName'],
    fields: ['subject', 'lingxingWarehouseName', 'kingdeeWarehouseName']
  },
  inventorySummaryFile10: {
    required: ['lingxingSku', 'identifier'],
    fields: ['lingxingSku', 'identifier', 'remark']
  },
  inventorySummaryFile11: {
    required: ['jdId', 'materialCode'],
    fields: ['jdId', 'materialCode']
  },
  inventorySummaryFile12: {
    required: [
      'month',
      'businessUnit',
      'materialCode',
      'remainingQty',
      'finishedQty',
      'unpreparedQty',
      'preparedNotStartedQty',
      'inProductionQty',
      'deliveryStatus',
      'unfulfilledReason',
      'reasonDetail',
      'remark'
    ],
    fields: [
      'month',
      'businessUnit',
      'materialCode',
      'remainingQty',
      'finishedQty',
      'unpreparedQty',
      'preparedNotStartedQty',
      'inProductionQty',
      'deliveryStatus',
      'supplierShortName',
      'unfulfilledReason',
      'reasonDetail',
      'remark'
    ]
  },
  inventorySummaryFile13: {
    required: ['subject', 'storeName', 'kingdeeWarehouseName'],
    fields: ['subject', 'storeName', 'kingdeeWarehouseName']
  },
  inventorySummaryFile14: {
    required: ['materialCode', 'jdTransitQty'],
    fields: ['materialCode', 'jdTransitQty']
  },
  inventorySummaryFile17: {
    required: ['sku', 'warehouseName', 'wfsTransitQty'],
    fields: ['sku', 'warehouseName', 'wfsTransitQty']
  }
};

function text(value) {
  return String(value ?? '').trim();
}

function matchKey(value) {
  return text(value).replace(/\.0$/, '').replace(/\s+/g, '').toLowerCase();
}

function headerKey(value) {
  return text(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function safeNumber(value) {
  const raw = text(value).replace(/,/g, '').replace(/\s+/g, '');
  if (!raw || raw === '-' || raw === '--') return { value: 0, valid: false };
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? { value: parsed, valid: true } : { value: 0, valid: false };
}

const IGNORED_FBM_WAREHOUSES = new Set([
  '默认仓库',
  'US-FBA移除中转虚拟仓',
  '虚拟仓库--仅用于测试'
].map(matchKey));
const IGNORED_DOMESTIC_WAREHOUSE_KEYWORDS = [
  '京东总仓',
  '发出商品仓'
].map(matchKey);
const SALES_FACTORY_DOMESTIC_WAREHOUSES = new Set([
  '028-R/瑞朗德销售部/瑞朗德仓/国内医疗器械',
  '028-M/瑞朗德销售部/瑞朗德仓/国内医疗器械'
].map(matchKey));
const INVENTORY_QUANTITY_FIELDS = {
  inventorySummaryFile1: 'endingInventoryQty',
  inventorySummaryFile2: 'actualTotalQty',
  inventorySummaryFile3: 'totalInventoryQty',
  inventorySummaryFile6: 'domesticStockQty',
  inventorySummaryFile7: 'jdStockQty',
  inventorySummaryFile17: 'wfsTransitQty'
};
const SUMMARY_ROW_LABELS = new Set([
  '合计',
  '总计',
  '小计',
  '汇总',
  'total',
  'grand total'
].map(matchKey));
const FACT_SUMMARY_IDENTITY_FIELDS = {
  inventorySummaryFile1: ['sku'],
  inventorySummaryFile2: ['identifier'],
  inventorySummaryFile3: ['sku'],
  inventorySummaryFile4: ['sku', 'storeName'],
  inventorySummaryFile5: ['sku', 'warehouseName'],
  inventorySummaryFile6: ['subject', 'warehouseName', 'materialCode'],
  inventorySummaryFile7: ['jdId'],
  inventorySummaryFile8: ['materialCode'],
  inventorySummaryFile12: ['materialCode'],
  inventorySummaryFile14: ['materialCode'],
  inventorySummaryFile17: ['sku']
};
const INVENTORY_SOURCE_TYPES = new Set([
  'FBA库存',
  'FBM库存',
  'WFS库存',
  '国内在库',
  '京东在库',
  'FBA在途',
  'FBM在途',
  'WFS在途',
  '京东在途',
  '库存风险',
  '供应计划分析'
]);
const INVENTORY_SOURCE_TABLE_LABELS = {
  FBA库存: 'FBA库存报表',
  FBM库存: 'FBM库存报表',
  WFS库存: 'WFS库存报表',
  国内在库: '国内在库报表',
  京东在库: '京东在库报表',
  FBA在途: 'FBA在途报表',
  FBM在途: 'FBM在途报表',
  WFS在途: 'WFS在途报表',
  京东在途: '京东在途'
};

const INVENTORY_MANUAL_FIELDS = ['businessUnit', 'materialCode', 'quantity'];
const INVENTORY_UNSELLABLE_MANUAL_FIELDS = ['businessUnit', 'materialCode', 'inventoryQty', 'transitQty'];
const INVENTORY_MANUAL_RECONCILIATION_SOURCES = [
  { sourceType: 'FBA库存', label: 'FBA在库', group: '在库', systemSlotId: 'inventorySummaryFile1', manualSlotId: 'inventoryManualFile1' },
  { sourceType: 'FBM库存', label: 'FBM在库', group: '在库', systemSlotId: 'inventorySummaryFile2', manualSlotId: 'inventoryManualFile2' },
  { sourceType: 'WFS库存', label: 'WFS在库', group: '在库', systemSlotId: 'inventorySummaryFile3', manualSlotId: 'inventoryManualFile3' },
  { sourceType: '国内在库', label: '国内在库', group: '在库', systemSlotId: 'inventorySummaryFile6', manualSlotId: 'inventoryManualFile6' },
  { sourceType: '京东在库', label: '京东在库', group: '在库', systemSlotId: 'inventorySummaryFile7', manualSlotId: 'inventoryManualFile7' },
  { sourceType: 'FBA在途', label: 'FBA在途', group: '在途', systemSlotId: 'inventorySummaryFile4', manualSlotId: 'inventoryManualFile4' },
  { sourceType: 'FBM在途', label: 'FBM在途', group: '在途', systemSlotId: 'inventorySummaryFile5', manualSlotId: 'inventoryManualFile5' },
  { sourceType: 'WFS在途', label: 'WFS在途', group: '在途', systemSlotId: 'inventorySummaryFile17', manualSlotId: 'inventoryManualFile17' },
  { sourceType: '京东在途', label: '京东在途', group: '在途', systemSlotId: 'inventorySummaryFile14', manualSlotId: 'inventoryManualFile14' }
];
const INVENTORY_MANUAL_RECONCILIATION_CATEGORIES = ['全部', '成品+配件', '成品', '配件', '不可售'];
const QUANTITY_RECONCILIATION_SOURCES = [
  { sourceType: 'FBA库存', label: 'FBA在库', slotId: 'inventorySummaryFile1', group: '在库', field: 'fbaInventoryQty' },
  { sourceType: 'FBM库存', label: 'FBM在库', slotId: 'inventorySummaryFile2', group: '在库', field: 'fbmInventoryQty' },
  { sourceType: 'WFS库存', label: 'WFS在库', slotId: 'inventorySummaryFile3', group: '在库', field: 'wfsInventoryQty' },
  { sourceType: '国内在库', label: '国内在库', slotId: 'inventorySummaryFile6', group: '在库', field: 'domesticMainInventoryQty' },
  { sourceType: '京东在库', label: '京东在库', slotId: 'inventorySummaryFile7', group: '在库', field: 'jdInventoryQty' },
  { sourceType: 'FBA在途', label: 'FBA在途', slotId: 'inventorySummaryFile4', group: '在途', field: 'fbaTransitQty' },
  { sourceType: 'FBM在途', label: 'FBM在途', slotId: 'inventorySummaryFile5', group: '在途', field: 'fbmTransitQty' },
  { sourceType: 'WFS在途', label: 'WFS在途', slotId: 'inventorySummaryFile17', group: '在途', field: 'wfsTransitQty' },
  { sourceType: '京东在途', label: '京东在途', slotId: 'inventorySummaryFile14', group: '在途', field: 'jdTransitQty' },
  { sourceType: '采购跟单', label: '采购未交付', slotId: 'inventorySummaryFile12', group: '未交付', field: 'unfulfilledQty' }
];
const QUANTITY_RECONCILIATION_SOURCE_MAP = new Map(
  QUANTITY_RECONCILIATION_SOURCES.map((config) => [config.sourceType, config])
);
const QUANTITY_RECONCILIATION_GROUP_FIELDS = {
  在库: 'inventoryQty',
  在途: 'transitQty',
  未交付: 'unfulfilledQty'
};
const ZERO_QUANTITY_DIAGNOSTIC_SOURCE_TYPES = new Set(['京东在途', '供应计划分析']);
const JD_INVENTORY_SUBJECT = '浙江迈德斯特医疗器械科技有限公司';
const INVENTORY_SUBJECT_FIELDS = new Set([
  'fbaInventoryQty', 'fbaInventoryValue',
  'fbmInventoryQty', 'fbmInventoryValue',
  'wfsInventoryQty', 'wfsInventoryValue',
  'domesticMainInventoryQty', 'domesticMainInventoryValue',
  'jdInventoryQty', 'jdInventoryValue',
  'fbaTransitQty', 'fbaTransitValue',
  'fbmTransitQty', 'fbmTransitValue',
  'wfsTransitQty', 'wfsTransitValue',
  'jdTransitQty', 'jdTransitValue'
]);
const INVENTORY_STOCK_FIELDS = new Set([
  'fbaInventoryQty', 'fbaInventoryValue',
  'fbmInventoryQty', 'fbmInventoryValue',
  'wfsInventoryQty', 'wfsInventoryValue',
  'domesticMainInventoryQty', 'domesticMainInventoryValue',
  'jdInventoryQty', 'jdInventoryValue'
]);

function isIgnoredFbmWarehouse(value) {
  return IGNORED_FBM_WAREHOUSES.has(matchKey(value));
}

function isAllowedFbmTransitWarehouse(value) {
  return FBM_TRANSIT_WAREHOUSES.has(matchKey(value));
}

function isAllowedFbmTransitDocumentStatus(value) {
  return FBM_TRANSIT_DOCUMENT_STATUSES.has(matchKey(value));
}

function isIgnoredDomesticWarehouse(value) {
  const warehouse = matchKey(value);
  return warehouse && IGNORED_DOMESTIC_WAREHOUSE_KEYWORDS.some((keyword) => warehouse.includes(keyword));
}

function isSalesFactoryDomesticWarehouse(value) {
  return SALES_FACTORY_DOMESTIC_WAREHOUSES.has(matchKey(value));
}

function baseInventoryProductType(product) {
  return matchKey(product?.productLine) === matchKey('其他/配件') ? '配件' : '成品';
}

function normalizedWarehouse(value) {
  return text(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

const FORCED_UNSELLABLE_WAREHOUSE_NAMES = new Set([
  '888-G-采购成品仓虚拟仓-跨境医疗器械',
  '888-US-采购成品仓虚拟仓-跨境医疗器械'
].map(normalizedWarehouse));
const FORCED_UNSELLABLE_WAREHOUSE_KEYWORDS = [
  '配件仓',
  '塑件车间仓库',
  '综合线组装仓库'
].map(normalizedWarehouse);
const FORCED_FINISHED_WAREHOUSE_NAMES = new Set([
  '001-M/国内事业部/瑞朗德仓/京东商家云仓'
].map(normalizedWarehouse));

function hasWarehouseCodePrefix(value, prefixes = ['333', '555', '777']) {
  const warehouse = normalizedWarehouse(value);
  return prefixes.some((prefix) => new RegExp(`^${prefix}(?:[-/\\\\])`).test(warehouse));
}

function isForcedUnsellableWarehouse(value) {
  const warehouse = normalizedWarehouse(value);
  return hasWarehouseCodePrefix(warehouse)
    || warehouse.includes('023')
    || warehouse.includes('(杭州)电子成品仓')
    || FORCED_UNSELLABLE_WAREHOUSE_NAMES.has(warehouse)
    || FORCED_UNSELLABLE_WAREHOUSE_KEYWORDS.some((keyword) => warehouse.includes(keyword));
}

function isUnsellableWarehouse(value) {
  const warehouse = normalizedWarehouse(value);
  if (isForcedUnsellableWarehouse(warehouse)) return true;
  return warehouse.replace(/[()（）]/g, '').includes('退货');
}

function isReturnFinishedSku(product) {
  const sku = text(product?.sku).normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  return sku.startsWith('RE') || sku.startsWith('K1');
}

function unsellableInventoryType(matchesWarehouse) {
  return matchesWarehouse ? '不可售' : '';
}

function inventoryFactProductType(product, ...warehouses) {
  if (warehouses.some((warehouse) => FORCED_FINISHED_WAREHOUSE_NAMES.has(normalizedWarehouse(warehouse)))) return '成品';
  if (warehouses.some(isForcedUnsellableWarehouse)) return '不可售';
  if (warehouses.some(isUnsellableWarehouse)) return isReturnFinishedSku(product) ? '成品' : '不可售';
  return baseInventoryProductType(product);
}

function hasZeroInventoryQuantity(row, slotId) {
  const field = INVENTORY_QUANTITY_FIELDS[slotId];
  if (!field) return false;
  const quantity = safeNumber(row?.[field]);
  return quantity.valid && quantity.value === 0;
}

function isSummaryRow(row, slotId) {
  const fields = FACT_SUMMARY_IDENTITY_FIELDS[slotId] || [];
  return fields.some((field) => SUMMARY_ROW_LABELS.has(matchKey(row?.[field])));
}

function normalizeMonth(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = xlsx.SSF.parse_date_code(value);
    if (date?.y && date?.m) return `${date.y}-${String(date.m).padStart(2, '0')}`;
  }
  const raw = text(value).replace(/[年月./]/g, '-').replace(/日/g, '');
  const match = raw.match(/(\d{4})\D+(\d{1,2})/);
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`;
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  return '';
}

function denseCell(sheet, rowIndex, columnIndex) {
  if (sheet['!data']) return sheet['!data'][rowIndex]?.[columnIndex];
  if (Array.isArray(sheet[rowIndex])) return sheet[rowIndex][columnIndex];
  return sheet[xlsx.utils.encode_cell({ r: rowIndex, c: columnIndex })];
}

function setDenseCell(sheet, rowIndex, columnIndex, cell) {
  if (sheet['!data']) {
    if (!sheet['!data'][rowIndex]) sheet['!data'][rowIndex] = [];
    sheet['!data'][rowIndex][columnIndex] = cell;
    return;
  }
  if (Array.isArray(sheet[rowIndex]) || Object.keys(sheet).some((key) => /^\d+$/.test(key))) {
    if (!Array.isArray(sheet[rowIndex])) sheet[rowIndex] = [];
    sheet[rowIndex][columnIndex] = cell;
    return;
  }
  sheet[xlsx.utils.encode_cell({ r: rowIndex, c: columnIndex })] = cell;
}

function expandMergedCells(sheet) {
  (sheet?.['!merges'] || []).forEach((range) => {
    const source = denseCell(sheet, range.s.r, range.s.c);
    if (!source) return;
    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
      for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
        setDenseCell(sheet, rowIndex, columnIndex, { ...source });
      }
    }
  });
}

function headerAliases(schema) {
  return new Set(schema.fields.flatMap((field) => FIELD_ALIASES[field] || []).map(headerKey));
}

function worksheetRows(sheet, schema, additionalHeaders = []) {
  const aoa = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: false });
  if (!aoa.length) return { rows: [], columns: [] };
  const aliases = headerAliases(schema);
  additionalHeaders.map(headerKey).filter(Boolean).forEach((header) => aliases.add(header));
  const headerIndex = aoa.slice(0, 30)
    .map((row, index) => ({
      index,
      score: row.reduce((score, cell) => score + (aliases.has(headerKey(cell)) ? 1 : 0), 0)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.index ?? 0;
  const columns = aoa[headerIndex].map((value) => text(value));
  const rows = aoa.slice(headerIndex + 1).map((values) => {
    const row = {};
    columns.forEach((column, index) => {
      if (column) row[column] = values[index] ?? '';
    });
    return row;
  }).filter((row) => Object.values(row).some((value) => text(value)));
  return { rows, columns };
}

function mappedColumn(field, mapping, columns, slotId, strictMapping = false, inferUnmappedFields = false) {
  const configured = text(mapping?.[field]);
  if (strictMapping) {
    if (configured) return columns.includes(configured) ? configured : '';
    if (!inferUnmappedFields) return '';
  }
  if (slotId === 'inventorySummaryFile1' && field === 'endingInventoryQty') {
    const canonicalAliases = new Set(FIELD_ALIASES.endingInventoryQty.map(headerKey));
    const canonicalColumn = columns.find((column) => canonicalAliases.has(headerKey(column)));
    return canonicalColumn || '';
  }
  if (slotId === 'inventorySummaryFile5' && field === 'warehouseName') {
    const canonicalAliases = new Set(['发货仓库（单据）', '发货仓库(单据)'].map(headerKey));
    const canonicalColumn = columns.find((column) => canonicalAliases.has(headerKey(column)));
    return canonicalColumn || '';
  }
  if (configured && columns.includes(configured)) return configured;
  const aliases = new Set((FIELD_ALIASES[field] || []).map(headerKey));
  return columns.find((column) => aliases.has(headerKey(column))) || '';
}

export function isInventorySummarySlot(slotId) {
  return INVENTORY_SLOT_IDS.has(slotId);
}

function inventoryValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  error.publicMessage = message;
  return error;
}

export function parseInventorySummaryWorkbook(file, slotId, mapping = {}, options = {}) {
  const schema = SLOT_SCHEMAS[slotId];
  if (!schema) return null;
  if (!file?.buffer) throw inventoryValidationError('未收到上传文件');
  const workbook = xlsx.read(file.buffer, { type: 'buffer', cellDates: true, dense: true });
  if (UNIQUE_SHEET_SLOT_IDS.has(slotId) && workbook.SheetNames.length !== 1) {
    const singleSheetTitle = {
      inventorySummaryFile4: 'FBA在途报表',
      inventorySummaryFile14: '京东在途报表'
    }[slotId] || '该文件';
    throw inventoryValidationError(`${singleSheetTitle}应只包含一个工作表`);
  }
  const sheetName = slotId === 'inventorySummaryFile5'
    ? workbook.SheetNames.find((name) => text(name) === '备货单详情')
    : workbook.SheetNames[0];
  if (!sheetName) {
    throw inventoryValidationError(slotId === 'inventorySummaryFile5' ? 'FBM在途报表缺少“备货单详情”工作表' : '文件中没有可读取的工作表');
  }
  const sheet = workbook.Sheets[sheetName];
  if (slotId === 'inventorySummaryFile4') expandMergedCells(sheet);
  const parsed = worksheetRows(sheet, schema);
  const strictMapping = Boolean(options.strictMapping);
  const allowIncompleteMapping = Boolean(options.allowIncompleteMapping);
  const inferUnmappedFields = Boolean(options.inferUnmappedFields);
  const columnMap = Object.fromEntries(schema.fields.map((field) => [
    field,
    mappedColumn(field, mapping, parsed.columns, slotId, strictMapping, inferUnmappedFields)
  ]));
  if (allowIncompleteMapping && !Object.values(columnMap).some(Boolean)) {
    const headers = parsed.columns.filter(Boolean).slice(0, 12);
    throw inventoryValidationError(`手工表未识别到可用字段。识别到的表头：${headers.join('、') || '无'}`);
  }
  const missing = schema.required.filter((field) => !columnMap[field]);
  if (missing.length && !allowIncompleteMapping) {
    const labels = missing.map((field) => FIELD_ALIASES[field]?.[0] || field);
    throw inventoryValidationError(strictMapping
      ? `手工表必须手动选择必填字段：${labels.join('、')}`
      : `缺少必填列：${labels.join('、')}`);
  }
  const jdUsesRdcFormat = slotId === 'inventorySummaryFile7'
    && headerKey(columnMap.jdStockQty) === headerKey('现货库存');
  if (jdUsesRdcFormat && !columnMap.jdRdc) {
    throw inventoryValidationError('京东在库新格式使用“现货库存”时必须包含RDC列');
  }
  const mappedRows = parsed.rows.map((row) => Object.fromEntries(schema.fields.map((field) => [
    field,
    columnMap[field] ? row[columnMap[field]] ?? '' : ''
  ]))).filter((row) => schema.fields.some((field) => columnMap[field] && text(row[field])));
  if (slotId === 'inventorySummaryFile4') {
    const carryFields = ['storeName', 'marketplace', 'shipmentStatus', 'dispatchQty'];
    const previous = {};
    mappedRows.forEach((row) => {
      carryFields.forEach((field) => {
        if (text(row[field])) previous[field] = row[field];
        else if (previous[field] !== undefined) row[field] = previous[field];
      });
    });
  }
  if (jdUsesRdcFormat) {
    const rowsBySku = new Map();
    mappedRows.forEach((row) => {
      if (isSummaryRow(row, slotId)) return;
      const sku = text(row.jdId);
      if (!sku) return;
      const key = matchKey(sku);
      if (!rowsBySku.has(key)) rowsBySku.set(key, { sku, rows: [] });
      rowsBySku.get(key).rows.push(row);
    });
    const missingNational = [];
    const duplicateNational = [];
    rowsBySku.forEach(({ sku, rows: skuRows }) => {
      const nationalRows = skuRows.filter((row) => matchKey(row.jdRdc) === matchKey('全国'));
      if (nationalRows.length === 0) missingNational.push(sku);
      if (nationalRows.length > 1) duplicateNational.push(sku);
    });
    if (missingNational.length) {
      throw inventoryValidationError(`京东在库新格式存在SKU缺少RDC=全国行：${missingNational.slice(0, 10).join('、')}${missingNational.length > 10 ? '等' : ''}`);
    }
    if (duplicateNational.length) {
      throw inventoryValidationError(`京东在库新格式存在SKU的RDC=全国行重复：${duplicateNational.slice(0, 10).join('、')}${duplicateNational.length > 10 ? '等' : ''}`);
    }
  }
  let filteredZeroQtyRows = 0;
  let filteredJdRegionalRows = 0;
  let filteredIgnoredWarehouseRows = 0;
  let filteredFbmTransitWarehouseRows = 0;
  let filteredFbmTransitStatusRows = 0;
  let filteredSummaryRows = 0;
  const rows = mappedRows.filter((row) => {
    if (isSummaryRow(row, slotId)) {
      filteredSummaryRows += 1;
      return false;
    }
    if (slotId === 'inventorySummaryFile2' && isIgnoredFbmWarehouse(row.warehouseName)) {
      filteredIgnoredWarehouseRows += 1;
      return false;
    }
    if (slotId === 'inventorySummaryFile6' && isIgnoredDomesticWarehouse(row.warehouseName)) {
      filteredIgnoredWarehouseRows += 1;
      return false;
    }
    if (slotId === 'inventorySummaryFile5' && !isAllowedFbmTransitWarehouse(row.warehouseName)) {
      filteredFbmTransitWarehouseRows += 1;
      return false;
    }
    if (slotId === 'inventorySummaryFile5' && !isAllowedFbmTransitDocumentStatus(row.documentStatus)) {
      filteredFbmTransitStatusRows += 1;
      return false;
    }
    if (jdUsesRdcFormat && matchKey(row.jdRdc) !== matchKey('全国')) {
      filteredJdRegionalRows += 1;
      return false;
    }
    if (hasZeroInventoryQuantity(row, slotId)) {
      filteredZeroQtyRows += 1;
      return false;
    }
    return true;
  });
  const fbaScopeRows = slotId === 'inventorySummaryFile1'
    ? rows.filter((row) => matchKey(row.inventoryAttribute) === matchKey('全部'))
    : [];
  const fbaBlankSkuRows = fbaScopeRows.filter((row) => !text(row.sku));
  const jdScopeRows = slotId === 'inventorySummaryFile7'
    ? mappedRows.filter((row) => !isSummaryRow(row, slotId) && (!jdUsesRdcFormat || matchKey(row.jdRdc) === matchKey('全国')))
    : [];
  const quantityTotal = (items, field) => items.reduce((sum, row) => {
    const quantity = safeNumber(row[field]);
    return sum + (quantity.valid ? quantity.value : 0);
  }, 0);
  return {
    rows,
    sheetName,
    sheetNames: workbook.SheetNames,
    mapping: {
      ...mapping,
      ...columnMap,
      __inventorySummary: {
        parserType: 'inventorySummary',
        parserVersion: ['inventorySummaryFile7', 'inventorySummaryFile12'].includes(slotId) ? 5 : 4,
        sheetName,
        sourceRowCount: mappedRows.length,
        rowCount: rows.length,
        filteredZeroQtyRows,
        filteredJdRegionalRows,
        filteredIgnoredWarehouseRows,
        filteredFbmTransitWarehouseRows,
        filteredFbmTransitStatusRows,
        filteredSummaryRows,
        jdFormat: slotId === 'inventorySummaryFile7'
          ? (jdUsesRdcFormat ? 'RDC全国行+现货库存' : '旧版全国现货库存列')
          : '',
        jdScopeRows: jdScopeRows.length,
        jdScopeQuantity: quantityTotal(jdScopeRows, 'jdStockQty'),
        fbaScopeRows: fbaScopeRows.length,
        fbaScopeQuantity: quantityTotal(fbaScopeRows, 'endingInventoryQty'),
        fbaBlankSkuRows: fbaBlankSkuRows.length,
        fbaBlankSkuQuantity: quantityTotal(fbaBlankSkuRows, 'endingInventoryQty'),
        filteredFbaAttributeRows: slotId === 'inventorySummaryFile1' ? rows.length - fbaScopeRows.length : 0
      }
    }
  };
}

function exactLookup(rows, keyOf, valueOf) {
  const buckets = new Map();
  rows.forEach((row) => {
    const key = keyOf(row);
    if (!key) return;
    const value = valueOf(row);
    const signature = JSON.stringify(value);
    if (!buckets.has(key)) buckets.set(key, new Map());
    buckets.get(key).set(signature, value);
  });
  return {
    candidates(rawKey) {
      const key = matchKey(rawKey);
      const bucket = key ? buckets.get(key) : null;
      return bucket ? [...bucket.values()] : [];
    },
    resolve(rawKey) {
      const key = matchKey(rawKey);
      const bucket = key ? buckets.get(key) : null;
      if (!bucket?.size) return { status: 'missing', key };
      const values = [...bucket.values()];
      if (values.length > 1) return { status: 'conflict', key, values };
      return { status: 'ok', key, value: values[0] };
    }
  };
}

function combinedKey(...parts) {
  return parts.map(matchKey).join('|');
}

function aliasValue(row, aliases) {
  const sources = [row, row?.raw].filter((source, index, values) => (
    source && typeof source === 'object' && values.indexOf(source) === index
  ));
  for (const source of sources) {
    for (const alias of aliases) {
      const value = source[alias];
      if (text(value)) return value;
    }
    const keys = Object.keys(source);
    for (const alias of aliases) {
      const target = headerKey(alias);
      const key = keys.find((candidate) => headerKey(candidate) === target);
      if (key && text(source[key])) return source[key];
    }
  }
  return '';
}

function dimensionProduct(row) {
  return {
    materialCode: text(aliasValue(row, ['materialCode', '物料编码', '品号'])).replace(/\.0$/, ''),
    sku: text(aliasValue(row, ['sku', 'SKU'])),
    materialName: text(aliasValue(row, ['materialName', '物料名称', '金蝶名称', 'SKU名称'])),
    productLine: text(aliasValue(row, ['productLine', '销售产品线', '产品线'])),
    productSeries: text(aliasValue(row, ['productSeries', '销售系列', '系列'])),
    model: text(aliasValue(row, ['model', '型号', '产品型号', '款式', '规格型号', '规格'])),
    productType: text(aliasValue(row, ['productType', '销售产品分类', '产品类型', '商品类型'])),
    salesRegion: text(aliasValue(row, ['salesRegion', '销售区域'])),
    pretaxPrice: aliasValue(row, ['pretaxPrice', '不含税结算价'])
  };
}

export function parseInventoryManualWorkbook(file, mapping = {}, options = {}) {
  if (!file?.buffer) throw inventoryValidationError('未收到上传文件');
  const workbook = xlsx.read(file.buffer, { type: 'buffer', cellDates: true, dense: true });
  const requestedSheetName = text(options.sheetName);
  if (requestedSheetName && !workbook.SheetNames.includes(requestedSheetName)) {
    throw inventoryValidationError('手工表选择的工作表不存在，请重新选择');
  }
  const sheetName = requestedSheetName || workbook.SheetNames[0];
  if (!sheetName) throw inventoryValidationError('手工表中没有可读取的工作表');
  const isUnsellable = text(options.slotId) === 'inventoryManualFile8';
  const fields = isUnsellable ? INVENTORY_UNSELLABLE_MANUAL_FIELDS : INVENTORY_MANUAL_FIELDS;
  const requiredFields = isUnsellable
    ? ['businessUnit', 'materialCode', 'inventoryQty', 'transitQty']
    : ['businessUnit', 'materialCode', 'quantity'];
  const schema = { required: requiredFields, fields };
  const parsed = worksheetRows(
    workbook.Sheets[sheetName],
    schema,
    Object.values(mapping)
  );
  const columnMap = Object.fromEntries(fields.map((field) => {
    const configured = text(mapping?.[field]);
    return [field, configured && parsed.columns.includes(configured) ? configured : ''];
  }));
  const missingFields = requiredFields.filter((field) => !columnMap[field]);
  if (missingFields.length) {
    const labels = {
      businessUnit: '事业部',
      materialCode: '物料编码',
      quantity: '数量',
      inventoryQty: '在库量',
      transitQty: '在途量'
    };
    throw inventoryValidationError(`手工表请选择必选字段：${missingFields.map((field) => labels[field] || field).join('、')}`);
  }
  const rows = parsed.rows.map((row) => Object.fromEntries(fields.map((field) => {
    const value = columnMap[field] ? row[columnMap[field]] ?? '' : '';
    return [field, field === 'materialCode' ? text(value).replace(/\.0$/, '') : value];
  }))).filter((row) => fields.some((field) => text(row[field])));
  return {
    rows,
    sheetName,
    sheetNames: workbook.SheetNames,
    mapping: {
      ...columnMap,
      __inventoryManual: {
        parserType: 'inventoryManual',
        parserVersion: 2,
        schemaType: isUnsellable ? 'unsellable' : 'standard',
        sheetName,
        sourceRowCount: parsed.rows.length,
        rowCount: rows.length
      }
    }
  };
}

function warehouseSubject(row) {
  return text(aliasValue(row, ['subject', '主体', '使用组织', '库存组织']));
}

function warehouseName(row) {
  return text(aliasValue(row, ['warehouseName', '仓库名称', '金蝶仓库名称', '金蝶仓库', '金蝶名称']));
}

function warehouseSite(row) {
  return text(aliasValue(row, ['marketplace', 'site', '站点', '站点名称', '国家站点', '销售站点', '国家/地区']));
}

function warehouseLocation(row) {
  return text(aliasValue(row, ['warehouseLocation', 'warehousePosition', '仓位位置', '仓库位置', '仓位']));
}

function warehouseLevel1Category(row) {
  return text(aliasValue(row, ['level1WarehouseCategory', '一级仓库分类', '仓库一级分类', '一级分类', '仓库大类', '一级仓库类型']));
}

function warehouseLevel2Category(row) {
  const rawHColumnValue = row?.raw && typeof row.raw === 'object'
    ? Object.values(row.raw)[7]
    : '';
  if (text(rawHColumnValue)) return text(rawHColumnValue);
  return text(aliasValue(row, ['level2WarehouseCategory', '二级仓库分类', '仓库二级分类', '二级分类', '仓库小类', '二级仓库类型']));
}

function terminalWarehouseName(value) {
  const segments = text(value).split(/[\\/]/).map((segment) => text(segment)).filter(Boolean);
  return segments.at(-1) || '';
}

function isWfsWarehouseName(value) {
  return text(value).split(/[\\/]/).some((segment) => matchKey(segment) === matchKey('WFS仓'));
}

function warehouseBusinessUnit(row) {
  return text(aliasValue(row, ['businessUnit', '事业部']));
}

function warehouseMaterialUsesMaterialComposite(row) {
  const materialCode = text(aliasValue(row, ['materialCode', '物料编码', '品号'])).replace(/\.0$/, '');
  const composite = text(aliasValue(row, [
    'warehouseMaterialKey',
    '仓库名称&物料编码',
    '主体&仓库名称&物料编码'
  ]));
  if (!materialCode || !composite) return true;
  return matchKey(composite).endsWith(matchKey(materialCode));
}

function applyAbc(rows, metricKey, targetKey) {
  const byBusinessUnit = new Map();
  rows.forEach((row) => {
    const key = row.businessUnit || '未匹配';
    if (!byBusinessUnit.has(key)) byBusinessUnit.set(key, []);
    byBusinessUnit.get(key).push(row);
  });
  byBusinessUnit.forEach((items) => {
    const positive = items.filter((row) => Number(row[metricKey]) > 0)
      .sort((left, right) => right[metricKey] - left[metricKey] || left.id.localeCompare(right.id, 'zh-Hans-CN'));
    const total = positive.reduce((sum, row) => sum + row[metricKey], 0);
    let cumulative = 0;
    for (let index = 0; index < positive.length;) {
      const value = positive[index][metricKey];
      const tied = [];
      while (index < positive.length && Math.abs(positive[index][metricKey] - value) <= 0.000001) {
        tied.push(positive[index]);
        index += 1;
      }
      cumulative += tied.reduce((sum, row) => sum + row[metricKey], 0);
      const share = total > 0 ? cumulative / total : 1;
      const classification = share <= 0.8 ? 'A' : share <= 0.9 ? 'B' : 'C';
      tied.forEach((row) => {
        row[targetKey] = classification;
      });
    }
    items.filter((row) => Number(row[metricKey]) <= 0).forEach((row) => {
      row[targetKey] = 'C';
    });
  });
}

function emptySummaryRow(id, businessUnit, product, rawIdentifier) {
  return {
    id,
    matchKey: product.materialCode && businessUnit !== '未匹配' ? `${businessUnit}+${product.materialCode}` : '未匹配',
    businessUnit,
    productLine: product.productLine || '未匹配',
    productSeries: product.productSeries || '未匹配',
    model: product.model || '未匹配',
    productType: product.productType || '',
    baseProductType: baseInventoryProductType(product),
    salesRegion: product.salesRegion || '',
    materialCode: product.materialCode || '未匹配',
    sku: product.sku || '未匹配',
    materialName: product.materialName || '未匹配',
    rawIdentifier,
    pretaxPrice: product.pretaxPrice,
    mappingStatus: '完整',
    issues: new Set(),
    sourceTypes: new Set(),
    inventorySources: new Set(),
    inventorySubjects: new Set(),
    inventorySubjectBreakdown: {},
    inventorySegmentBreakdown: {},
    inventorySourceDetails: {},
    deliveryStatuses: new Set(),
    unfulfilledSupplierShortNames: new Set(),
    salesByMonth: {},
    salesAmountByMonth: {},
    purchaseByMonth: {},
    unfulfilledReasons: {},
    reasonDetails: {},
    remarks: {},
    salesQty: 0,
    salesAmount: 0,
    fbaInventoryQty: 0,
    fbaInventoryValue: 0,
    fbmInventoryQty: 0,
    fbmInventoryValue: 0,
    wfsInventoryQty: 0,
    wfsInventoryValue: 0,
    domesticMainInventoryQty: 0,
    domesticMainInventoryValue: 0,
    jdInventoryQty: 0,
    jdInventoryValue: 0,
    fbaTransitQty: 0,
    fbaTransitValue: 0,
    fbmTransitQty: 0,
    fbmTransitValue: 0,
    wfsTransitQty: 0,
    wfsTransitValue: 0,
    jdTransitQty: 0,
    jdTransitValue: 0,
    finishedNotShippedQty: 0,
    finishedNotShippedValue: 0,
    unpreparedQty: 0,
    unpreparedValue: 0,
    preparedNotStartedQty: 0,
    preparedNotStartedValue: 0,
    inProductionQty: 0,
    inProductionValue: 0,
    unfulfilledQty: 0,
    unfulfilledValue: 0,
    normalOrderQty: 0,
    normalOrderValue: 0,
    abnormalOrderQty: 0,
    abnormalOrderValue: 0
  };
}

function sumBucket(target, name, qty, value) {
  const key = text(name) || '未填写';
  const current = target[key] || { qty: 0, value: 0 };
  current.qty += qty;
  current.value += value;
  target[key] = current;
}

function splitSupplierShortNames(value) {
  return text(value).split(/[&+、,，;；]/).map(text).filter(Boolean);
}

function rowsRecord(getRecord, slotId) {
  const record = getRecord(slotId);
  const rows = Array.isArray(record?.rows) ? record.rows : [];
  return {
    rows: rows.filter((row) => !isSummaryRow(row, slotId)),
    updatedAt: text(record?.updatedAt)
  };
}

function normalizeQuantityDifference(value) {
  return Math.abs(Number(value || 0)) <= 0.000001 ? 0 : Number(Number(value).toFixed(6));
}

export function buildInventoryQuantityReconciliation({ source = {}, facts = [], totals = {} } = {}) {
  const factRows = Array.isArray(facts) ? facts : [...facts.values()];
  const sources = QUANTITY_RECONCILIATION_SOURCES.map((config) => {
    const sourceFacts = factRows.filter((fact) => fact.sourceType === config.sourceType);
    const expectedQuantity = sourceFacts.reduce((sum, fact) => sum + Number(fact.expectedQuantity || 0), 0);
    const countedQuantity = sourceFacts.reduce((sum, fact) => sum + Number(fact.countedQuantity || 0), 0);
    const dashboardQuantity = Number(totals[config.field] || 0);
    let factMissingQuantity = 0;
    let factOverlapQuantity = 0;
    sourceFacts.forEach((fact) => {
      if (Number(fact.countedTimes || 0) === 0) {
        factMissingQuantity += Math.abs(Number(fact.expectedQuantity || 0));
        return;
      }
      if (Math.sign(fact.countedQuantity) !== Math.sign(fact.expectedQuantity)
        && Math.abs(Number(fact.countedQuantity || 0)) > 0.000001
        && Math.abs(Number(fact.expectedQuantity || 0)) > 0.000001) {
        factMissingQuantity += Math.abs(Number(fact.expectedQuantity || 0));
        factOverlapQuantity += Math.abs(Number(fact.countedQuantity || 0));
        return;
      }
      const magnitudeDifference = Math.abs(Number(fact.countedQuantity || 0)) - Math.abs(Number(fact.expectedQuantity || 0));
      if (magnitudeDifference < -0.000001) factMissingQuantity += Math.abs(magnitudeDifference);
      if (magnitudeDifference > 0.000001) factOverlapQuantity += magnitudeDifference;
    });
    const aggregateDifference = dashboardQuantity - expectedQuantity;
    const aggregateMissingQuantity = aggregateDifference < -0.000001 ? Math.abs(aggregateDifference) : 0;
    const aggregateOverlapQuantity = aggregateDifference > 0.000001 ? aggregateDifference : 0;
    const missingQuantity = normalizeQuantityDifference(Math.max(factMissingQuantity, aggregateMissingQuantity));
    const overlapQuantity = normalizeQuantityDifference(Math.max(factOverlapQuantity, aggregateOverlapQuantity));
    const appliedAt = source[config.slotId]?.updatedAt || '';
    return {
      ...config,
      applied: Boolean(appliedAt),
      appliedAt,
      sourceRowCount: sourceFacts.length,
      countedRowCount: sourceFacts.filter((fact) => Number(fact.countedTimes || 0) > 0).length,
      expectedQuantity: normalizeQuantityDifference(expectedQuantity),
      countedQuantity: normalizeQuantityDifference(countedQuantity),
      dashboardQuantity: normalizeQuantityDifference(dashboardQuantity),
      differenceQuantity: normalizeQuantityDifference(dashboardQuantity - expectedQuantity),
      missingQuantity,
      overlapQuantity,
      status: !appliedAt ? '未应用' : missingQuantity > 0 ? '数量遗漏' : overlapQuantity > 0 ? '数量重叠' : '校准通过'
    };
  });
  const groups = Object.entries(QUANTITY_RECONCILIATION_GROUP_FIELDS).map(([group, field]) => {
    const groupSources = sources.filter((sourceRow) => sourceRow.group === group);
    const expectedQuantity = groupSources.reduce((sum, sourceRow) => sum + sourceRow.expectedQuantity, 0);
    const dashboardQuantity = Number(totals[field] || 0);
    const differenceQuantity = normalizeQuantityDifference(dashboardQuantity - expectedQuantity);
    const missingQuantity = differenceQuantity < 0 ? Math.abs(differenceQuantity) : 0;
    const overlapQuantity = differenceQuantity > 0 ? differenceQuantity : 0;
    return {
      group,
      expectedQuantity: normalizeQuantityDifference(expectedQuantity),
      dashboardQuantity: normalizeQuantityDifference(dashboardQuantity),
      differenceQuantity,
      missingQuantity,
      overlapQuantity,
      status: missingQuantity > 0 ? '数量遗漏' : overlapQuantity > 0 ? '数量重叠' : '校准通过'
    };
  });
  const sourceMissingQuantity = sources.reduce((sum, sourceRow) => sum + sourceRow.missingQuantity, 0);
  const sourceOverlapQuantity = sources.reduce((sum, sourceRow) => sum + sourceRow.overlapQuantity, 0);
  const groupMissingQuantity = Math.max(0, ...groups.map((groupRow) => groupRow.missingQuantity));
  const groupOverlapQuantity = Math.max(0, ...groups.map((groupRow) => groupRow.overlapQuantity));
  const missingQuantity = normalizeQuantityDifference(Math.max(sourceMissingQuantity, groupMissingQuantity));
  const overlapQuantity = normalizeQuantityDifference(Math.max(sourceOverlapQuantity, groupOverlapQuantity));
  const unappliedSourceCount = sources.filter((sourceRow) => !sourceRow.applied).length;
  return {
    status: missingQuantity > 0 || overlapQuantity > 0 || unappliedSourceCount > 0 ? 'warning' : 'ok',
    summary: {
      sourceCount: sources.length,
      checkedQuantity: normalizeQuantityDifference(sources.reduce((sum, sourceRow) => sum + Math.abs(sourceRow.expectedQuantity), 0)),
      missingQuantity,
      overlapQuantity,
      issueSourceCount: sources.filter((sourceRow) => sourceRow.status !== '校准通过').length,
      unappliedSourceCount
    },
    sources,
    groups
  };
}

function manualReconciliationQuantity(value) {
  const parsed = safeNumber(value);
  return parsed.valid ? Math.round((parsed.value + Number.EPSILON) * 10) / 10 : 0;
}

function manualReconciliationStatus(systemQty, manualQty) {
  const system = manualReconciliationQuantity(systemQty);
  const manual = manualReconciliationQuantity(manualQty);
  if (system === manual) return '无差异';
  return '有差异';
}

function buildInventoryManualReconciliation({
  systemFacts = [],
  manualSource = {},
  systemSource = {},
  productLookup,
  anomalies = [],
  quantityReconciliation,
  requestedCategories = INVENTORY_MANUAL_RECONCILIATION_CATEGORIES
} = {}) {
  const standardConfigs = INVENTORY_MANUAL_RECONCILIATION_SOURCES.map((config) => ({
    ...config,
    systemSlotIds: [config.systemSlotId]
  }));
  const unsellableConfigs = [
    {
      sourceType: '不可售',
      label: '不可售在库',
      group: '在库',
      systemSlotIds: ['inventorySummaryFile1', 'inventorySummaryFile2', 'inventorySummaryFile3', 'inventorySummaryFile6'],
      manualSlotId: 'inventoryManualFile8'
    },
    {
      sourceType: '不可售',
      label: '不可售在途',
      group: '在途',
      systemSlotIds: ['inventorySummaryFile5'],
      manualSlotId: 'inventoryManualFile8'
    }
  ];
  const categories = INVENTORY_MANUAL_RECONCILIATION_CATEGORIES;
  const computedCategories = categories.filter((category) => requestedCategories.includes(category));
  const categoryMatches = (fact, category) => (
    category === '全部'
      || (category === '成品+配件' && ['成品', '配件'].includes(fact.productType))
      || fact.productType === category
  );
  const manualFacts = [];
  const addManualFact = (row, sourceType, group, quantity, productType) => {
    const businessUnit = text(row.businessUnit) || '未匹配';
    const materialCode = text(row.materialCode).replace(/\.0$/, '') || '未匹配';
    manualFacts.push({
      sourceType,
      comparisonSourceType: sourceType,
      group,
      businessUnit,
      materialCode,
      productType,
      quantity: manualReconciliationQuantity(quantity),
      subject: text(row.subject),
      sourceWarehouseName: text(row.warehouseName),
      mappedWarehouseName: '',
      storeName: ''
    });
  };
  standardConfigs.forEach((config) => {
    (manualSource[config.manualSlotId]?.rows || []).forEach((row) => {
      const materialCode = text(row.materialCode).replace(/\.0$/, '');
      const productResult = productLookup.resolve(materialCode);
      const productType = productResult.status === 'ok' ? baseInventoryProductType(productResult.value) : '未匹配';
      addManualFact(row, config.sourceType, config.group, row.quantity, productType);
    });
  });
  (manualSource.inventoryManualFile8?.rows || []).forEach((row) => {
    addManualFact(row, '不可售', '在库', row.inventoryQty, '不可售');
    addManualFact(row, '不可售', '在途', row.transitQty, '不可售');
  });

  const normalizedSystemFacts = systemFacts.map((fact) => ({
    ...fact,
    comparisonSourceType: fact.productType === '不可售' ? '不可售' : fact.sourceType,
    quantity: manualReconciliationQuantity(fact.quantity)
  }));
  const factIndexKey = (fact) => combinedKey(
    fact.businessUnit,
    fact.materialCode,
    fact.comparisonSourceType,
    fact.group
  );
  const indexFacts = (facts) => facts.reduce((index, fact) => {
    const key = factIndexKey(fact);
    const bucket = index.get(key) || [];
    bucket.push(fact);
    index.set(key, bucket);
    return index;
  }, new Map());
  const systemFactIndex = indexFacts(normalizedSystemFacts);
  const manualFactIndex = indexFacts(manualFacts);
  const anomalyIndex = anomalies.reduce((index, item) => {
    const key = combinedKey(item.sourceType, item.businessUnit, item.materialCode);
    const bucket = index.get(key) || [];
    bucket.push(item.issue);
    index.set(key, bucket);
    return index;
  }, new Map());
  const keyIdentity = new Map();
  [...normalizedSystemFacts, ...manualFacts].forEach((fact) => {
    const key = combinedKey(fact.businessUnit, fact.materialCode);
    if (!keyIdentity.has(key)) keyIdentity.set(key, { businessUnit: fact.businessUnit, materialCode: fact.materialCode });
  });
  const allKeys = new Set(keyIdentity.keys());
  const internalSourceStatus = new Map(
    (quantityReconciliation?.sources || []).map((row) => [row.sourceType, row])
  );
  const sourceAvailable = (config) => {
    const missingSystem = config.systemSlotIds.filter((slotId) => !systemSource[slotId]?.updatedAt);
    if (missingSystem.length) return { available: false, status: '无法核对：系统底表未应用', missingSystem };
    if (!manualSource[config.manualSlotId]?.updatedAt) {
      return { available: false, status: '无法核对：手工表未应用', missingManual: [config.manualSlotId] };
    }
    return { available: true, status: '' };
  };
  const configsForCategory = (category) => (
    category === '不可售'
      ? unsellableConfigs
      : category === '全部'
        ? [...standardConfigs, ...unsellableConfigs]
        : standardConfigs
  );
  const detailText = (facts, field) => [...new Set(facts.map((fact) => text(fact[field])).filter(Boolean))].join(' & ');
  const groupFacts = (facts, keyForFact) => facts.reduce((index, fact) => {
    const warehouseKey = keyForFact(fact);
    const bucket = index.get(warehouseKey) || [];
    bucket.push(fact);
    index.set(warehouseKey, bucket);
    return index;
  }, new Map());
  const groupWarehouseFacts = (facts) => groupFacts(facts, (fact) => combinedKey(
    text(fact.mappedWarehouseName || fact.sourceWarehouseName) || '未匹配'
  ));
  const pairWarehouseFacts = (systemFacts, manualFacts) => {
    const systemByWarehouse = groupWarehouseFacts(systemFacts);
    const manualByWarehouse = groupWarehouseFacts(manualFacts);
    const warehouseKeys = new Set([...systemByWarehouse.keys(), ...manualByWarehouse.keys()]);
    return [...warehouseKeys].flatMap((warehouseKey) => {
      const systemWarehouseFacts = systemByWarehouse.get(warehouseKey) || [];
      const manualWarehouseFacts = manualByWarehouse.get(warehouseKey) || [];
      const systemSubjects = new Set(systemWarehouseFacts.map((fact) => matchKey(fact.subject)).filter(Boolean));
      const manualSubjects = new Set(manualWarehouseFacts.map((fact) => matchKey(fact.subject)).filter(Boolean));
      if (!systemSubjects.size || !manualSubjects.size) {
        return [{ warehouseKey, systemMatches: systemWarehouseFacts, manualMatches: manualWarehouseFacts }];
      }
      const bySubject = (facts) => groupFacts(facts, (fact) => combinedKey(text(fact.subject) || '未匹配'));
      const systemBySubject = bySubject(systemWarehouseFacts);
      const manualBySubject = bySubject(manualWarehouseFacts);
      const subjectKeys = new Set([...systemBySubject.keys(), ...manualBySubject.keys()]);
      return [...subjectKeys].map((subjectKey) => ({
        warehouseKey: combinedKey(warehouseKey, subjectKey),
        systemMatches: systemBySubject.get(subjectKey) || [],
        manualMatches: manualBySubject.get(subjectKey) || []
      }));
    });
  };

  const rows = [...allKeys].map((key) => {
    const { businessUnit, materialCode } = keyIdentity.get(key);
    const productResult = productLookup.resolve(materialCode);
    const product = productResult.status === 'ok' ? productResult.value : {};
    const categoryResults = Object.fromEntries(computedCategories.map((category) => {
      const sourceRows = configsForCategory(category).flatMap((config) => {
        const sourceKey = combinedKey(businessUnit, materialCode, config.sourceType, config.group);
        const systemMatches = (systemFactIndex.get(sourceKey) || []).filter((fact) => categoryMatches(fact, category));
        const manualMatches = (manualFactIndex.get(sourceKey) || []).filter((fact) => categoryMatches(fact, category));
        const availability = sourceAvailable(config);
        return pairWarehouseFacts(systemMatches, manualMatches).map(({ warehouseKey, systemMatches: systemWarehouseMatches, manualMatches: manualWarehouseMatches }) => {
          const systemQty = manualReconciliationQuantity(systemWarehouseMatches.reduce((sum, fact) => sum + fact.quantity, 0));
          const manualQty = manualReconciliationQuantity(manualWarehouseMatches.reduce((sum, fact) => sum + fact.quantity, 0));
          const differenceQty = manualReconciliationQuantity(systemQty - manualQty);
          let status = availability.status || manualReconciliationStatus(systemQty, manualQty);
          let reason = status;
          if (availability.available) {
            const internal = internalSourceStatus.get(config.sourceType);
            const matchingIssues = anomalyIndex.get(combinedKey(config.sourceType, businessUnit, materialCode)) || [];
            if (status === '无差异') reason = '无差异';
            else if (systemQty !== 0 && manualQty === 0) reason = '手工表缺少该仓库物料';
            else if (systemQty === 0 && manualQty !== 0 && matchingIssues.length) reason = `系统维度或过滤规则未计入：${[...new Set(matchingIssues)].join('；')}`;
            else if (systemQty === 0 && manualQty !== 0) reason = '系统底表未计入该仓库物料';
            else if (internal && internal.status === '数量遗漏') reason = '系统汇总遗漏';
            else if (internal && internal.status === '数量重叠') reason = '系统重复计入';
            else if (status === '有差异') reason = '仓库数量不一致';
            else reason = '待人工确认';
          }
          return {
            id: combinedKey(config.sourceType, config.group, warehouseKey),
            sourceType: config.sourceType,
            label: config.label,
            group: config.group,
            systemQty,
            manualQty,
            differenceQty,
            status,
            reason,
            systemSubject: detailText(systemWarehouseMatches, 'subject'),
            systemWarehouse: detailText(systemWarehouseMatches, 'sourceWarehouseName'),
            systemMappedWarehouse: detailText(systemWarehouseMatches, 'mappedWarehouseName'),
            manualSubject: detailText(manualWarehouseMatches, 'subject'),
            manualWarehouse: detailText(manualWarehouseMatches, 'sourceWarehouseName')
          };
        });
      }).filter((row) => row.systemQty !== 0 || row.manualQty !== 0);
      const groupResult = (group) => {
        const groupRows = sourceRows.filter((row) => row.group === group);
        const systemQty = manualReconciliationQuantity(groupRows.reduce((sum, row) => sum + row.systemQty, 0));
        const manualQty = manualReconciliationQuantity(groupRows.reduce((sum, row) => sum + row.manualQty, 0));
        const unavailable = groupRows.find((row) => row.status.startsWith('无法核对'));
        return {
          systemQty,
          manualQty,
          differenceQty: manualReconciliationQuantity(systemQty - manualQty),
          status: unavailable?.status || manualReconciliationStatus(systemQty, manualQty)
        };
      };
      const inventory = groupResult('在库');
      const transit = groupResult('在途');
      sourceRows.forEach((row) => {
        const metric = row.group === '在库' ? inventory : transit;
        if (metric.status !== '无差异') return;
        row.status = '无差异';
        row.reason = '无差异';
      });
      const hasData = sourceRows.some((row) => row.systemQty !== 0 || row.manualQty !== 0);
      let status = '无差异';
      if ([inventory.status, transit.status].some((value) => value.startsWith('无法核对'))) status = '无法核对';
      else if ([inventory.status, transit.status].some((value) => value === '有差异')) status = '有差异';
      const reason = [...new Set(sourceRows.filter((row) => row.status !== '无差异').map((row) => `${row.label}：${row.reason}`))].join('；') || '无差异';
      return [category, { inventory, transit, status, reason, sources: sourceRows, hasData }];
    }));
    return {
      id: key,
      businessUnit,
      materialCode,
      sku: text(product.sku) || '未匹配',
      materialName: text(product.materialName) || '未匹配',
      productLine: text(product.productLine) || '未匹配',
      productSeries: text(product.productSeries) || '未匹配',
      productType: productResult.status === 'ok' ? baseInventoryProductType(product) : '未匹配',
      categories: categoryResults
    };
  }).sort((left, right) => (
    left.businessUnit.localeCompare(right.businessUnit, 'zh-Hans-CN')
    || left.materialCode.localeCompare(right.materialCode, 'zh-Hans-CN')
  ));
  const summaryByCategory = Object.fromEntries(computedCategories.map((category) => {
    const categoryRows = rows.map((row) => row.categories[category]).filter((row) => row.hasData);
    return [category, {
      rowCount: rows.length,
      issueCount: categoryRows.filter((row) => row.status !== '无差异').length,
      matchedCount: categoryRows.filter((row) => row.status === '无差异').length,
      unavailableCount: categoryRows.filter((row) => row.status === '无法核对').length,
      systemInventoryQty: manualReconciliationQuantity(categoryRows.reduce((sum, row) => sum + row.inventory.systemQty, 0)),
      manualInventoryQty: manualReconciliationQuantity(categoryRows.reduce((sum, row) => sum + row.inventory.manualQty, 0)),
      systemTransitQty: manualReconciliationQuantity(categoryRows.reduce((sum, row) => sum + row.transit.systemQty, 0)),
      manualTransitQty: manualReconciliationQuantity(categoryRows.reduce((sum, row) => sum + row.transit.manualQty, 0))
    }];
  }));
  const unavailableFiles = [];
  [...standardConfigs, ...unsellableConfigs].forEach((config) => {
    const availability = sourceAvailable(config);
    if (availability.available) return;
    (availability.missingSystem || []).forEach((slotId) => unavailableFiles.push({ side: '系统', slotId, source: config.label, status: '系统底表未应用' }));
    (availability.missingManual || []).forEach((slotId) => unavailableFiles.push({ side: '手工', slotId, source: config.label, status: '手工表未应用' }));
  });
  return {
    categories,
    summaryByCategory,
    rows,
    unavailableFiles: unavailableFiles.filter((item, index, list) => (
      list.findIndex((candidate) => candidate.side === item.side && candidate.slotId === item.slotId) === index
    ))
  };
}

export function buildInventorySummaryModel({
  getRows,
  getRecord,
  includeManualReconciliation = true,
  manualReconciliationCategories = INVENTORY_MANUAL_RECONCILIATION_CATEGORIES
}) {
  const inventorySourceSlotNumbers = [...Array.from({ length: 14 }, (_, index) => index + 1), 17, 18, 19, 20];
  const source = Object.fromEntries(inventorySourceSlotNumbers.map((slotNumber) => {
    const slotId = `inventorySummaryFile${slotNumber}`;
    return [slotId, rowsRecord(getRecord, slotId)];
  }));
  const manualSource = includeManualReconciliation
    ? Object.fromEntries(Array.from({ length: 20 }, (_, index) => {
      const slotId = `inventoryManualFile${index + 1}`;
      return [slotId, rowsRecord(getRecord, slotId)];
    }))
    : {};
  const productRows = getRows('productCategory');
  const salesRegionConfigured = productRows.some((row) => text(aliasValue(row, ['salesRegion', '销售区域'])));
  const productLookup = exactLookup(
    productRows,
    (row) => matchKey(aliasValue(row, ['materialCode', '物料编码', '品号'])),
    dimensionProduct
  );
  const skuLookup = exactLookup(
    source.inventorySummaryFile10.rows,
    (row) => matchKey(row.lingxingSku),
    (row) => ({ materialCode: text(row.identifier || row.materialCode).replace(/\.0$/, '') })
  );
  const jdLookup = exactLookup(
    source.inventorySummaryFile11.rows,
    (row) => matchKey(row.jdId),
    (row) => ({ materialCode: text(row.materialCode).replace(/\.0$/, '') })
  );
  const fbaWarehouseLookup = exactLookup(
    source.inventorySummaryFile9.rows,
    (row) => matchKey(aliasValue(row, ['lingxingWarehouseName', '领星FBA仓库', '领星FBA仓', '领星仓库名称', '领星仓库', '仓库'])),
    (row) => ({
      subject: warehouseSubject(row),
      warehouseName: text(aliasValue(row, ['kingdeeWarehouseName', '金蝶仓库名称', '金蝶仓库', '金蝶名称']))
    })
  );
  const transitWarehouseLookup = exactLookup(
    source.inventorySummaryFile13.rows,
    (row) => matchKey(aliasValue(row, ['storeName', '店铺', '店铺名称'])),
    (row) => ({
      subject: warehouseSubject(row),
      warehouseName: text(aliasValue(row, ['kingdeeWarehouseName', '金蝶仓库名称', '金蝶仓库', '金蝶名称']))
    })
  );
  const warehouseSubjectLookup = exactLookup(
    getRows('spare1'),
    (row) => matchKey(warehouseName(row)),
    (row) => ({ subject: warehouseSubject(row) })
  );
  const warehouseSiteLookup = exactLookup(
    getRows('spare1'),
    (row) => matchKey(warehouseName(row)),
    (row) => ({ site: warehouseSite(row) })
  );
  const warehouseMetadataLookup = exactLookup(
    getRows('spare1'),
    (row) => matchKey(warehouseName(row)),
    (row) => ({
      site: warehouseSite(row),
      warehouseLocation: warehouseLocation(row),
      level1WarehouseCategory: warehouseLevel1Category(row),
      level2WarehouseCategory: warehouseLevel2Category(row)
    })
  );
  const warehouseMaterialLookup = exactLookup(
    getRows('warehouseMaterialMap'),
    (row) => combinedKey(warehouseSubject(row), warehouseName(row), aliasValue(row, ['materialCode', '物料编码', '品号'])),
    (row) => ({ businessUnit: warehouseBusinessUnit(row) })
  );
  const wfsWarehouseMaterialLookup = exactLookup(
    getRows('warehouseMaterialMap').filter((row) => (
      isWfsWarehouseName(warehouseName(row)) && warehouseMaterialUsesMaterialComposite(row)
    )),
    (row) => combinedKey(terminalWarehouseName(warehouseName(row)), aliasValue(row, ['materialCode', '物料编码', '品号'])),
    (row) => ({
      subject: warehouseSubject(row),
      warehouseName: warehouseName(row),
      businessUnit: warehouseBusinessUnit(row)
    })
  );
  const rowMap = new Map();
  const anomalies = [];
  const quantityFactLedger = new Map();
  const manualReconciliationSystemFacts = [];
  let sourceIndex = 0;
  let factIndex = 0;
  let quantityFactIndex = 0;

  const expectQuantity = (sourceType, quantity, sourceKey) => {
    if (!QUANTITY_RECONCILIATION_SOURCE_MAP.has(sourceType)) return '';
    const id = `${sourceType}-${quantityFactIndex += 1}`;
    quantityFactLedger.set(id, {
      id,
      sourceType,
      sourceKey: text(sourceKey),
      expectedQuantity: Number(quantity || 0),
      countedQuantity: 0,
      countedTimes: 0
    });
    return id;
  };

  const countQuantity = (reconciliationId, sourceType, quantities) => {
    if (!reconciliationId) return;
    const ledgerEntry = quantityFactLedger.get(reconciliationId);
    const config = QUANTITY_RECONCILIATION_SOURCE_MAP.get(sourceType);
    if (!ledgerEntry || !config) return;
    ledgerEntry.countedQuantity += Number(quantities[config.field] || 0);
    ledgerEntry.countedTimes += 1;
  };

  const diagnosticProduct = (materialCode) => {
    const result = productLookup.resolve(text(materialCode).replace(/\.0$/, ''));
    if (result.status !== 'ok') {
      return {
        sku: '未匹配',
        materialName: '未匹配',
        productLine: '未匹配',
        productSeries: '未匹配'
      };
    }
    return {
      sku: text(result.value.sku) || '未匹配',
      materialName: text(result.value.materialName) || '未匹配',
      productLine: text(result.value.productLine) || '未匹配',
      productSeries: text(result.value.productSeries) || '未匹配'
    };
  };

  const addAnomaly = (sourceType, sourceKey, issue, qty = 0, value = 0, context = {}) => {
    anomalies.push({
      ...diagnosticProduct(context.materialCode),
      ...context,
      id: `${sourceType}-${sourceIndex += 1}`,
      sourceType,
      sourceKey: text(sourceKey),
      issue,
      qty,
      value
    });
  };

  const resolveProduct = (materialCode, sourceType, sourceKey) => {
    const material = text(materialCode).replace(/\.0$/, '');
    const result = productLookup.resolve(material);
    if (result.status !== 'ok') {
      return { product: { materialCode: '', sku: '', materialName: '', productLine: '', productSeries: '', model: '', productType: '', salesRegion: '', pretaxPrice: 0 }, issue: `商品分类${result.status === 'conflict' ? '映射冲突' : '缺失'}` };
    }
    const price = safeNumber(result.value.pretaxPrice);
    if (!price.valid || !text(result.value.pretaxPrice)) {
      return { product: { ...result.value, materialCode: '', pretaxPrice: 0 }, issue: '不含税结算价缺失或无效' };
    }
    return { product: { ...result.value, pretaxPrice: price.value }, issue: '' };
  };

  const resolveSku = (sku) => {
    const result = skuLookup.resolve(sku);
    if (result.status !== 'ok' || !text(result.value?.materialCode)) {
      return { materialCode: '', issue: `SKU与物料编码${result.status === 'conflict' ? '映射冲突' : '缺失'}` };
    }
    return { materialCode: result.value.materialCode, issue: '' };
  };

  const resolveJd = (jdId) => {
    const result = jdLookup.resolve(jdId);
    if (result.status !== 'ok' || !text(result.value?.materialCode)) {
      return { materialCode: '', issue: `京东ID与品号${result.status === 'conflict' ? '映射冲突' : '缺失'}` };
    }
    return { materialCode: result.value.materialCode, issue: '' };
  };

  const resolveWarehouseBusinessUnit = (subject, warehouse, materialCode) => {
    const result = warehouseMaterialLookup.resolve(combinedKey(subject, warehouse, materialCode));
    if (result.status !== 'ok' || !text(result.value?.businessUnit)) {
      return {
        businessUnit: '',
        issue: `主体、仓库与物料${result.status === 'conflict' ? '映射冲突' : '映射缺失'}`,
        subject: text(subject),
        kingdeeWarehouseName: text(warehouse)
      };
    }
    return {
      businessUnit: result.value.businessUnit,
      issue: '',
      subject: text(subject),
      kingdeeWarehouseName: text(warehouse)
    };
  };

  const resolveWarehouseMetadata = (...warehouseNames) => {
    for (const name of warehouseNames.map(text).filter(Boolean)) {
      const candidates = warehouseMetadataLookup.candidates(name);
      if (!candidates.length) continue;
      const sites = [...new Set(candidates.map((item) => text(item.site)).filter(Boolean))];
      const warehouseLocations = [...new Set(candidates.map((item) => text(item.warehouseLocation)).filter(Boolean))];
      const level1WarehouseCategories = [...new Set(candidates.map((item) => text(item.level1WarehouseCategory)).filter(Boolean))];
      const level2WarehouseCategories = [...new Set(candidates.map((item) => text(item.level2WarehouseCategory)).filter(Boolean))];
      const metadata = {
        site: sites.length === 1 ? sites[0] : '',
        warehouseLocation: warehouseLocations.length === 1 ? warehouseLocations[0] : '',
        level1WarehouseCategory: level1WarehouseCategories.length === 1 ? level1WarehouseCategories[0] : '',
        level2WarehouseCategory: level2WarehouseCategories.length === 1 ? level2WarehouseCategories[0] : ''
      };
      if (metadata.site || metadata.warehouseLocation || metadata.level1WarehouseCategory || metadata.level2WarehouseCategory) return metadata;
    }
    return { site: '', warehouseLocation: '', level1WarehouseCategory: '', level2WarehouseCategory: '' };
  };

  const resolveGeneralWarehouse = (sourceWarehouse, materialCode) => {
    const subjectResult = warehouseSubjectLookup.resolve(sourceWarehouse);
    if (subjectResult.status !== 'ok' || !text(subjectResult.value?.subject)) {
      return {
        businessUnit: '',
        issue: `仓库主体${subjectResult.status === 'conflict' ? '映射冲突' : '映射缺失'}`,
        subject: '',
        sourceWarehouseName: text(sourceWarehouse),
        kingdeeWarehouseName: text(sourceWarehouse)
      };
    }
    return {
      ...resolveWarehouseBusinessUnit(subjectResult.value.subject, sourceWarehouse, materialCode),
      sourceWarehouseName: text(sourceWarehouse)
    };
  };

  const resolveSpecialWarehouse = (lookup, sourceWarehouse, materialCode) => {
    const warehouseResult = lookup.resolve(sourceWarehouse);
    if (warehouseResult.status !== 'ok' || !text(warehouseResult.value?.subject) || !text(warehouseResult.value?.warehouseName)) {
      return {
        businessUnit: '',
        issue: `仓库对照${warehouseResult.status === 'conflict' ? '映射冲突' : '映射缺失'}`,
        subject: '',
        sourceWarehouseName: text(sourceWarehouse),
        kingdeeWarehouseName: ''
      };
    }
    return {
      ...resolveWarehouseBusinessUnit(warehouseResult.value.subject, warehouseResult.value.warehouseName, materialCode),
      sourceWarehouseName: text(sourceWarehouse)
    };
  };

  const resolveWfsWarehouse = (sourceWarehouse, materialCode) => {
    const directCandidates = wfsWarehouseMaterialLookup.candidates(
      combinedKey(terminalWarehouseName(sourceWarehouse), materialCode)
    ).filter((candidate) => text(candidate.businessUnit));
    const directBusinessUnits = new Set(directCandidates.map((candidate) => matchKey(candidate.businessUnit)));
    if (directBusinessUnits.size === 1) {
      const candidate = directCandidates[0];
      return {
        businessUnit: candidate.businessUnit,
        issue: '',
        subject: candidate.subject,
        sourceWarehouseName: text(sourceWarehouse),
        kingdeeWarehouseName: candidate.warehouseName
      };
    }
    if (directBusinessUnits.size > 1) {
      return {
        businessUnit: '',
        issue: '主体、仓库与物料映射冲突',
        subject: '',
        sourceWarehouseName: text(sourceWarehouse),
        kingdeeWarehouseName: ''
      };
    }
    const candidates = fbaWarehouseLookup.candidates(sourceWarehouse);
    if (!candidates.length) {
      return {
        businessUnit: '',
        issue: '仓库对照映射缺失',
        subject: '',
        sourceWarehouseName: text(sourceWarehouse),
        kingdeeWarehouseName: ''
      };
    }
    const resolved = candidates.map((candidate) => ({
      candidate,
      result: resolveWarehouseBusinessUnit(candidate.subject, candidate.warehouseName, materialCode)
    }));
    const matches = resolved.filter(({ result }) => !result.issue && text(result.businessUnit));
    const businessUnits = new Set(matches.map(({ result }) => matchKey(result.businessUnit)));
    if (businessUnits.size === 1) {
      return {
        ...matches[0].result,
        sourceWarehouseName: text(sourceWarehouse)
      };
    }
    if (businessUnits.size > 1 || resolved.some(({ result }) => result.issue.includes('映射冲突'))) {
      return {
        businessUnit: '',
        issue: '主体、仓库与物料映射冲突',
        subject: '',
        sourceWarehouseName: text(sourceWarehouse),
        kingdeeWarehouseName: ''
      };
    }
    const fallback = resolved[0]?.result || {};
    return {
      ...fallback,
      sourceWarehouseName: text(sourceWarehouse)
    };
  };

  const issueImpact = (quantities) => {
    const pairs = [
      ['fbaInventoryQty', 'fbaInventoryValue'],
      ['fbmInventoryQty', 'fbmInventoryValue'],
      ['wfsInventoryQty', 'wfsInventoryValue'],
      ['domesticMainInventoryQty', 'domesticMainInventoryValue'],
      ['jdInventoryQty', 'jdInventoryValue'],
      ['fbaTransitQty', 'fbaTransitValue'],
      ['fbmTransitQty', 'fbmTransitValue'],
      ['wfsTransitQty', 'wfsTransitValue'],
      ['jdTransitQty', 'jdTransitValue'],
      ['unfulfilledQty', 'unfulfilledValue'],
      ['salesQty', 'salesAmount']
    ];
    const pair = pairs.find(([qtyField]) => Object.hasOwn(quantities, qtyField));
    return pair
      ? { qty: Number(quantities[pair[0]] || 0), value: Number(quantities[pair[1]] || 0) }
      : { qty: 0, value: 0 };
  };

  const addFact = ({
    sourceType,
    rawIdentifier,
    materialCode,
    businessUnit,
    issues = [],
    quantities = {},
    inventorySource = '',
    inventorySubject = '',
    inventoryWarehouseName = '',
    inventoryProductType = '',
    deliveryStatus = '',
    month = '',
    distribution = null,
    sourceContext = {},
    reconciliationId = ''
  }) => {
    const factId = `${sourceType}-${factIndex += 1}`;
    const productResult = resolveProduct(materialCode, sourceType, rawIdentifier);
    const rowIssues = [...issues, productResult.issue].filter(Boolean);
    const resolvedBusinessUnit = text(businessUnit) || '未匹配';
    const hasBusinessUnit = resolvedBusinessUnit !== '未匹配';
    const hasProduct = Boolean(productResult.product.materialCode);
    const key = hasBusinessUnit && hasProduct
      ? combinedKey(resolvedBusinessUnit, productResult.product.materialCode)
      : combinedKey('未匹配', resolvedBusinessUnit, sourceType, rawIdentifier || materialCode || sourceIndex);
    const row = rowMap.get(key) || emptySummaryRow(
      key,
      hasBusinessUnit ? resolvedBusinessUnit : '未匹配',
      hasProduct ? productResult.product : { ...productResult.product, materialCode: '' },
      text(rawIdentifier || materialCode)
    );
    let factProductType = baseInventoryProductType(productResult.product);
    if (rowIssues.length) {
      row.mappingStatus = '映射冲突';
      rowIssues.forEach((issue) => row.issues.add(issue));
    }
    row.sourceTypes.add(sourceType);
    if (inventorySource) row.inventorySources.add(inventorySource);
    if (Object.keys(quantities).some((field) => INVENTORY_SUBJECT_FIELDS.has(field))) {
      const subject = text(inventorySubject) || '未匹配';
      const hasStock = Object.keys(quantities).some((field) => INVENTORY_STOCK_FIELDS.has(field));
      const segmentType = text(inventoryProductType) || (hasStock
        ? inventoryFactProductType(
            productResult.product,
            inventoryWarehouseName,
            sourceContext.sourceWarehouseName,
            sourceContext.kingdeeWarehouseName
          )
        : baseInventoryProductType(productResult.product));
      factProductType = segmentType;
      row.inventorySubjects.add(subject);
      const subjectAmounts = row.inventorySubjectBreakdown[subject] || {};
      const segmentKey = combinedKey(subject, segmentType);
      const segmentAmounts = row.inventorySegmentBreakdown[segmentKey] || { subject, productType: segmentType };
      const sourceTable = INVENTORY_SOURCE_TABLE_LABELS[sourceType];
      if (sourceTable) {
        const warehouseMetadata = resolveWarehouseMetadata(
          sourceContext.kingdeeWarehouseName,
          inventoryWarehouseName,
          sourceContext.receivingWarehouseName,
          sourceContext.sourceWarehouseName
        );
        const sourceDetail = {
          sourceType,
          sourceTable,
          sourceWarehouseName: text(sourceContext.sourceWarehouseName),
          receivingWarehouseName: text(sourceContext.receivingWarehouseName),
          mappedWarehouseName: text(sourceContext.kingdeeWarehouseName),
          storeName: text(sourceContext.storeName),
          subject,
          productType: segmentType,
          warehouseLocation: text(warehouseMetadata.warehouseLocation),
          site: text(warehouseMetadata.site),
          level1WarehouseCategory: text(warehouseMetadata.level1WarehouseCategory),
          level2WarehouseCategory: text(warehouseMetadata.level2WarehouseCategory)
        };
        const detailKey = combinedKey(
          sourceDetail.sourceTable,
          sourceDetail.sourceWarehouseName,
          sourceDetail.receivingWarehouseName,
          sourceDetail.mappedWarehouseName,
          sourceDetail.storeName,
          sourceDetail.subject,
          sourceDetail.productType,
          sourceDetail.warehouseLocation,
          sourceDetail.site,
          sourceDetail.level1WarehouseCategory,
          sourceDetail.level2WarehouseCategory
        );
        const existingSourceDetail = row.inventorySourceDetails[detailKey] || sourceDetail;
        Object.entries(quantities).forEach(([field, amount]) => {
          if (!INVENTORY_SUBJECT_FIELDS.has(field)) return;
          existingSourceDetail[field] = (existingSourceDetail[field] || 0) + amount;
        });
        row.inventorySourceDetails[detailKey] = existingSourceDetail;
      }
      Object.entries(quantities).forEach(([field, amount]) => {
        if (!INVENTORY_SUBJECT_FIELDS.has(field)) return;
        subjectAmounts[field] = (subjectAmounts[field] || 0) + amount;
        segmentAmounts[field] = (segmentAmounts[field] || 0) + amount;
      });
      row.inventorySubjectBreakdown[subject] = subjectAmounts;
      row.inventorySegmentBreakdown[segmentKey] = segmentAmounts;
    }
    if (deliveryStatus) row.deliveryStatuses.add(deliveryStatus);
    Object.entries(quantities).forEach(([field, amount]) => {
      row[field] += amount;
    });
    countQuantity(reconciliationId, sourceType, quantities);
    const reconciliationConfig = QUANTITY_RECONCILIATION_SOURCE_MAP.get(sourceType);
    if (includeManualReconciliation && reconciliationConfig && ['在库', '在途'].includes(reconciliationConfig.group)) {
      manualReconciliationSystemFacts.push({
        sourceType,
        group: reconciliationConfig.group,
        businessUnit: resolvedBusinessUnit,
        materialCode: text(materialCode).replace(/\.0$/, '') || '未匹配',
        productType: factProductType,
        quantity: Number(quantities[reconciliationConfig.field] || 0),
        subject: text(inventorySubject || sourceContext.subject),
        sourceWarehouseName: text(sourceContext.sourceWarehouseName || sourceContext.receivingWarehouseName),
        mappedWarehouseName: text(sourceContext.kingdeeWarehouseName || inventoryWarehouseName),
        storeName: text(sourceContext.storeName),
        issues: rowIssues
      });
    }
    if (month && (quantities.salesQty || quantities.salesAmount)) {
      row.salesByMonth[month] = (row.salesByMonth[month] || 0) + quantities.salesQty;
      row.salesAmountByMonth[month] = (row.salesAmountByMonth[month] || 0) + quantities.salesAmount;
    }
    if (month && distribution?.purchase) {
      const target = row.purchaseByMonth[month] || { unfulfilledQty: 0, unfulfilledValue: 0 };
      target.unfulfilledQty += quantities.unfulfilledQty || 0;
      target.unfulfilledValue += quantities.unfulfilledValue || 0;
      row.purchaseByMonth[month] = target;
    }
    if (distribution?.purchase && Math.abs(Number(quantities.unfulfilledQty || 0)) > 0.000001) {
      splitSupplierShortNames(distribution.supplierShortName).forEach((name) => row.unfulfilledSupplierShortNames.add(name));
    }
    if (distribution) {
      sumBucket(row.unfulfilledReasons, distribution.reason, distribution.qty, distribution.value);
      sumBucket(row.reasonDetails, distribution.detail, distribution.qty, distribution.value);
      sumBucket(row.remarks, distribution.remark, distribution.qty, distribution.value);
    }
    rowMap.set(key, row);
    const impact = issueImpact(quantities);
    rowIssues.forEach((issue) => addAnomaly(
      sourceType,
      rawIdentifier || materialCode,
      issue,
      impact.qty,
      impact.value,
      {
        factId,
        materialCode: text(materialCode).replace(/\.0$/, ''),
        businessUnit: resolvedBusinessUnit,
        ...sourceContext
      }
    ));
  };

  const numeric = (value, sourceType, sourceKey, field) => {
    const parsed = safeNumber(value);
    if (!parsed.valid) addAnomaly(sourceType, sourceKey, `${field}不是有效数量`, 0, 0);
    return parsed.value;
  };

  const inventoryQuantity = (raw, slotId, sourceType, sourceKey, field) => {
    const quantityField = INVENTORY_QUANTITY_FIELDS[slotId];
    const parsed = safeNumber(raw?.[quantityField]);
    if (!parsed.valid) {
      addAnomaly(sourceType, sourceKey, `${field}不是有效数量`, 0, 0);
      return null;
    }
    return parsed.value === 0 ? null : parsed.value;
  };

  source.inventorySummaryFile1.rows.forEach((raw) => {
    if (text(raw.inventoryAttribute).toLowerCase() !== '全部'.toLowerCase()) return;
    const qty = inventoryQuantity(raw, 'inventorySummaryFile1', 'FBA库存', raw.sku, '期末库存(含移仓)-数量');
    if (qty === null) return;
    const reconciliationId = expectQuantity('FBA库存', qty, raw.sku);
    const skuResult = resolveSku(raw.sku);
    const warehouseResult = skuResult.materialCode ? resolveSpecialWarehouse(fbaWarehouseLookup, raw.warehouseName, skuResult.materialCode) : { businessUnit: '', issue: '' };
    const product = resolveProduct(skuResult.materialCode, 'FBA库存', raw.sku);
    addFact({
      sourceType: 'FBA库存',
      rawIdentifier: raw.sku,
      materialCode: skuResult.materialCode,
      businessUnit: warehouseResult.businessUnit,
      issues: [skuResult.issue, warehouseResult.issue],
      inventorySource: 'FBA库存',
      inventorySubject: warehouseResult.subject,
      inventoryWarehouseName: warehouseResult.kingdeeWarehouseName,
      reconciliationId,
      quantities: { fbaInventoryQty: qty, fbaInventoryValue: qty * product.product.pretaxPrice },
      sourceContext: {
        sourceSku: text(raw.sku),
        sourceWarehouseName: text(raw.warehouseName),
        subject: warehouseResult.subject || '',
        kingdeeWarehouseName: warehouseResult.kingdeeWarehouseName || ''
      }
    });
  });

  source.inventorySummaryFile2.rows.forEach((raw) => {
    if (isIgnoredFbmWarehouse(raw.warehouseName)) return;
    const qty = inventoryQuantity(raw, 'inventorySummaryFile2', 'FBM库存', raw.identifier, '实际总量');
    if (qty === null) return;
    const reconciliationId = expectQuantity('FBM库存', qty, raw.identifier);
    const materialCode = text(raw.identifier).replace(/\.0$/, '');
    const warehouseResult = resolveGeneralWarehouse(raw.warehouseName, materialCode);
    const product = resolveProduct(materialCode, 'FBM库存', raw.identifier);
    addFact({
      sourceType: 'FBM库存',
      rawIdentifier: raw.identifier,
      materialCode,
      businessUnit: warehouseResult.businessUnit,
      issues: [materialCode ? '' : '识别码为空', warehouseResult.issue],
      inventorySource: 'FBM库存',
      inventorySubject: warehouseResult.subject,
      inventoryWarehouseName: warehouseResult.kingdeeWarehouseName,
      reconciliationId,
      inventoryProductType: inventoryFactProductType(
        product.product,
        warehouseResult.kingdeeWarehouseName,
        raw.warehouseName
      ),
      quantities: { fbmInventoryQty: qty, fbmInventoryValue: qty * product.product.pretaxPrice },
      sourceContext: {
        sourceSku: text(raw.identifier),
        storeName: text(raw.storeName),
        marketplace: text(raw.marketplace),
        sourceWarehouseName: text(raw.warehouseName),
        subject: warehouseResult.subject || '',
        kingdeeWarehouseName: warehouseResult.kingdeeWarehouseName || ''
      }
    });
  });

  source.inventorySummaryFile3.rows.forEach((raw) => {
    const qty = inventoryQuantity(raw, 'inventorySummaryFile3', 'WFS库存', raw.sku, '总库存数量');
    if (qty === null) return;
    const reconciliationId = expectQuantity('WFS库存', qty, raw.sku);
    const skuResult = resolveSku(raw.sku);
    const warehouseResult = skuResult.materialCode ? resolveWfsWarehouse(raw.warehouseName, skuResult.materialCode) : { businessUnit: '', issue: '' };
    const product = resolveProduct(skuResult.materialCode, 'WFS库存', raw.sku);
    addFact({
      sourceType: 'WFS库存',
      rawIdentifier: raw.sku,
      materialCode: skuResult.materialCode,
      businessUnit: warehouseResult.businessUnit,
      issues: [skuResult.issue, warehouseResult.issue],
      inventorySource: 'WFS库存',
      inventorySubject: warehouseResult.subject,
      inventoryWarehouseName: warehouseResult.kingdeeWarehouseName,
      reconciliationId,
      quantities: { wfsInventoryQty: qty, wfsInventoryValue: qty * product.product.pretaxPrice },
      sourceContext: {
        sourceSku: text(raw.sku),
        sourceWarehouseName: text(raw.warehouseName),
        subject: warehouseResult.subject || '',
        kingdeeWarehouseName: warehouseResult.kingdeeWarehouseName || ''
      }
    });
  });

  source.inventorySummaryFile4.rows.forEach((raw) => {
    if (!FBA_TRANSIT_STATUSES.has(text(raw.shipmentStatus).toUpperCase())) return;
    const dispatchQty = numeric(raw.dispatchQty, 'FBA在途', raw.sku, '发货数量');
    if (Math.abs(dispatchQty) <= 0.000001) return;
    const shipped = numeric(raw.shippedQty, 'FBA在途', raw.sku, '已发货');
    const signed = numeric(raw.signedQty, 'FBA在途', raw.sku, '签收量');
    const qty = Math.max(shipped - signed, 0);
    if (Math.abs(qty) <= 0.000001) return;
    const reconciliationId = expectQuantity('FBA在途', qty, raw.sku);
    const skuResult = resolveSku(raw.sku);
    const warehouseResult = skuResult.materialCode ? resolveSpecialWarehouse(transitWarehouseLookup, raw.storeName, skuResult.materialCode) : { businessUnit: '', issue: '' };
    const product = resolveProduct(skuResult.materialCode, 'FBA在途', raw.sku);
    addFact({
      sourceType: 'FBA在途',
      rawIdentifier: raw.sku,
      materialCode: skuResult.materialCode,
      businessUnit: warehouseResult.businessUnit,
      issues: [skuResult.issue, warehouseResult.issue],
      inventorySubject: warehouseResult.subject,
      reconciliationId,
      quantities: { fbaTransitQty: qty, fbaTransitValue: qty * product.product.pretaxPrice },
      sourceContext: {
        sourceSku: text(raw.sku),
        storeName: text(raw.storeName),
        subject: warehouseResult.subject || '',
        kingdeeWarehouseName: warehouseResult.kingdeeWarehouseName || ''
      }
    });
  });

  source.inventorySummaryFile5.rows.forEach((raw) => {
    if (!isAllowedFbmTransitWarehouse(raw.warehouseName)) return;
    if (!isAllowedFbmTransitDocumentStatus(raw.documentStatus)) return;
    const qty = numeric(raw.stockupQty, 'FBM在途', raw.sku, '备货数量') - numeric(raw.receivedQty, 'FBM在途', raw.sku, '收货数量');
    if (Math.abs(qty) <= 0.000001) return;
    const reconciliationId = expectQuantity('FBM在途', qty, raw.sku);
    const skuResult = resolveSku(raw.sku);
    let warehouseResult = { businessUnit: '', issue: '' };
    if (skuResult.materialCode) {
      const receivingWarehouseResult = text(raw.receivingWarehouseName)
        ? resolveGeneralWarehouse(raw.receivingWarehouseName, skuResult.materialCode)
        : null;
      warehouseResult = receivingWarehouseResult?.businessUnit
        ? receivingWarehouseResult
        : resolveGeneralWarehouse(raw.warehouseName, skuResult.materialCode);
    }
    const product = resolveProduct(skuResult.materialCode, 'FBM在途', raw.sku);
    addFact({
      sourceType: 'FBM在途',
      rawIdentifier: raw.sku,
      materialCode: skuResult.materialCode,
      businessUnit: warehouseResult.businessUnit,
      issues: [skuResult.issue, warehouseResult.issue],
      inventorySubject: warehouseResult.subject,
      inventoryWarehouseName: text(raw.receivingWarehouseName),
      reconciliationId,
      inventoryProductType: unsellableInventoryType(
        hasWarehouseCodePrefix(raw.receivingWarehouseName, ['777'])
      ),
      quantities: { fbmTransitQty: qty, fbmTransitValue: qty * product.product.pretaxPrice },
      sourceContext: {
        sourceSku: text(raw.sku),
        sourceWarehouseName: text(raw.warehouseName),
        receivingWarehouseName: text(raw.receivingWarehouseName),
        subject: warehouseResult.subject || '',
        kingdeeWarehouseName: warehouseResult.kingdeeWarehouseName || ''
      }
    });
  });

  source.inventorySummaryFile17.rows.forEach((raw) => {
    const qty = inventoryQuantity(raw, 'inventorySummaryFile17', 'WFS在途', raw.sku, '在途数量');
    if (qty === null) return;
    const reconciliationId = expectQuantity('WFS在途', qty, raw.sku);
    const skuResult = resolveSku(raw.sku);
    const warehouseResult = skuResult.materialCode
      ? resolveWfsWarehouse(raw.warehouseName, skuResult.materialCode)
      : { businessUnit: '', issue: '' };
    const product = resolveProduct(skuResult.materialCode, 'WFS在途', raw.sku);
    addFact({
      sourceType: 'WFS在途',
      rawIdentifier: raw.sku,
      materialCode: skuResult.materialCode,
      businessUnit: warehouseResult.businessUnit,
      issues: [skuResult.issue, warehouseResult.issue],
      inventorySubject: warehouseResult.subject,
      inventoryWarehouseName: warehouseResult.kingdeeWarehouseName,
      reconciliationId,
      quantities: { wfsTransitQty: qty, wfsTransitValue: qty * product.product.pretaxPrice },
      sourceContext: {
        sourceSku: text(raw.sku),
        sourceWarehouseName: text(raw.warehouseName),
        subject: warehouseResult.subject || '',
        kingdeeWarehouseName: warehouseResult.kingdeeWarehouseName || ''
      }
    });
  });

  source.inventorySummaryFile6.rows.forEach((raw) => {
    if (isIgnoredDomesticWarehouse(raw.warehouseName)) return;
    const qty = inventoryQuantity(raw, 'inventorySummaryFile6', '国内在库', raw.materialCode, '库存量(主单位)');
    if (qty === null) return;
    const siteResult = warehouseSiteLookup.resolve(raw.warehouseName);
    if (siteResult.status !== 'ok' || matchKey(siteResult.value?.site) !== matchKey('中国')) return;
    const materialCode = text(raw.materialCode).replace(/\.0$/, '');
    const product = resolveProduct(materialCode, '国内在库', raw.materialCode);
    const warehouseResult = isSalesFactoryDomesticWarehouse(raw.warehouseName)
      ? {
          businessUnit: '销售部-工厂',
          issue: '',
          subject: text(raw.subject),
          kingdeeWarehouseName: text(raw.warehouseName)
        }
      : resolveWarehouseBusinessUnit(raw.subject, raw.warehouseName, materialCode);
    const directUnsellableWarehouse = isForcedUnsellableWarehouse(raw.warehouseName);
    const directUnsellableProduct = directUnsellableWarehouse;
    const inventoryBusinessUnit = warehouseResult.businessUnit;
    if (!inventoryBusinessUnit) {
      addAnomaly('国内在库', raw.materialCode, warehouseResult.issue || '事业部映射缺失', qty, 0, {
        factId: `国内在库-${factIndex += 1}`,
        materialCode,
        businessUnit: warehouseResult.businessUnit || '未匹配',
        subject: text(raw.subject),
        sourceWarehouseName: text(raw.warehouseName),
        kingdeeWarehouseName: text(raw.warehouseName)
      });
      return;
    }
    const reconciliationId = expectQuantity('国内在库', qty, raw.materialCode);
    addFact({
      sourceType: '国内在库',
      rawIdentifier: raw.materialCode,
      materialCode,
      businessUnit: inventoryBusinessUnit,
      issues: [directUnsellableProduct ? '' : warehouseResult.issue],
      inventorySource: '国内在库',
      inventorySubject: text(raw.subject),
      inventoryWarehouseName: text(raw.warehouseName),
      reconciliationId,
      inventoryProductType: inventoryFactProductType(
        product.product,
        warehouseResult.kingdeeWarehouseName,
        raw.warehouseName
      ),
      quantities: { domesticMainInventoryQty: qty, domesticMainInventoryValue: qty * product.product.pretaxPrice },
      sourceContext: {
        subject: text(raw.subject),
        sourceWarehouseName: text(raw.warehouseName),
        kingdeeWarehouseName: text(raw.warehouseName)
      }
    });
  });

  source.inventorySummaryFile7.rows.forEach((raw) => {
    const qty = inventoryQuantity(raw, 'inventorySummaryFile7', '京东在库', raw.jdId, '京东现货库存');
    if (qty === null) return;
    const reconciliationId = expectQuantity('京东在库', qty, raw.jdId);
    const jdResult = resolveJd(raw.jdId);
    const product = resolveProduct(jdResult.materialCode, '京东在库', raw.jdId);
    addFact({
      sourceType: '京东在库',
      rawIdentifier: raw.jdId,
      materialCode: jdResult.materialCode,
      businessUnit: '国内事业部',
      issues: [jdResult.issue],
      inventorySource: '京东在库',
      inventorySubject: JD_INVENTORY_SUBJECT,
      reconciliationId,
      quantities: { jdInventoryQty: qty, jdInventoryValue: qty * product.product.pretaxPrice },
      sourceContext: {
        sourceSku: text(raw.jdId),
        jdId: text(raw.jdId),
        sourceWarehouseName: text(raw.jdRdc) ? `RDC=${text(raw.jdRdc)}` : '全国现货库存'
      }
    });
  });

  source.inventorySummaryFile14.rows.forEach((raw) => {
    const materialCode = text(raw.materialCode).replace(/\.0$/, '');
    const quantity = safeNumber(raw.jdTransitQty);
    if (!quantity.valid) {
      addAnomaly('京东在途', materialCode, '在途数量不是有效数量', 0, 0, {
        materialCode,
        businessUnit: '国内事业部',
        subject: JD_INVENTORY_SUBJECT
      });
    }
    const qty = quantity.valid ? quantity.value : 0;
    const reconciliationId = expectQuantity('京东在途', qty, materialCode);
    const product = resolveProduct(materialCode, '京东在途', materialCode);
    addFact({
      sourceType: '京东在途',
      rawIdentifier: materialCode,
      materialCode,
      businessUnit: '国内事业部',
      issues: [materialCode ? '' : '物料编码为空'],
      inventorySubject: JD_INVENTORY_SUBJECT,
      reconciliationId,
      quantities: { jdTransitQty: qty, jdTransitValue: qty * product.product.pretaxPrice },
      sourceContext: {
        sourceSku: materialCode,
        subject: JD_INVENTORY_SUBJECT,
        sourceWarehouseName: '无仓库字段'
      }
    });
  });

  source.inventorySummaryFile8.rows.forEach((raw) => {
    const month = normalizeMonth(raw.date);
    const qty = numeric(raw.salesQty, '销售数据', raw.materialCode, '销售数量');
    const amount = numeric(raw.salesAmount, '销售数据', raw.materialCode, '销售金额');
    addFact({
      sourceType: '销售数据',
      rawIdentifier: raw.materialCode,
      materialCode: raw.materialCode,
      businessUnit: text(raw.businessUnit) || '未匹配',
      issues: [month ? '' : '销售日期无法识别'],
      month,
      quantities: { salesQty: qty, salesAmount: amount },
      sourceContext: { sourceSku: text(raw.materialCode) }
    });
  });

  source.inventorySummaryFile12.rows.forEach((raw) => {
    const month = normalizeMonth(raw.month);
    const status = text(raw.deliveryStatus);
    const recognized = status === '是' || status === '否';
    const qty = recognized ? numeric(raw.remainingQty, '采购跟单', raw.materialCode, '备货剩余数量') : 0;
    const reconciliationId = recognized ? expectQuantity('采购跟单', qty, raw.materialCode) : '';
    const product = resolveProduct(raw.materialCode, '采购跟单', raw.materialCode);
    const value = qty * product.product.pretaxPrice;
    const quantities = {
      finishedNotShippedQty: recognized ? numeric(raw.finishedQty, '采购跟单', raw.materialCode, '完工未发产品') : 0,
      unpreparedQty: recognized ? numeric(raw.unpreparedQty, '采购跟单', raw.materialCode, '已下单未备料未生产') : 0,
      preparedNotStartedQty: recognized ? numeric(raw.preparedNotStartedQty, '采购跟单', raw.materialCode, '已备料未生产') : 0,
      inProductionQty: recognized ? numeric(raw.inProductionQty, '采购跟单', raw.materialCode, '生产中产品') : 0,
      unfulfilledQty: qty,
      unfulfilledValue: value,
      normalOrderQty: status === '是' ? qty : 0,
      normalOrderValue: status === '是' ? value : 0,
      abnormalOrderQty: status === '否' ? qty : 0,
      abnormalOrderValue: status === '否' ? value : 0
    };
    quantities.finishedNotShippedValue = quantities.finishedNotShippedQty * product.product.pretaxPrice;
    quantities.unpreparedValue = quantities.unpreparedQty * product.product.pretaxPrice;
    quantities.preparedNotStartedValue = quantities.preparedNotStartedQty * product.product.pretaxPrice;
    quantities.inProductionValue = quantities.inProductionQty * product.product.pretaxPrice;
    addFact({
      sourceType: '采购跟单',
      rawIdentifier: raw.materialCode,
      materialCode: raw.materialCode,
      businessUnit: text(raw.businessUnit) || '未匹配',
      issues: [month ? '' : '下单月份无法识别'],
      deliveryStatus: recognized ? status : '无未交付',
      month,
      reconciliationId,
      quantities,
      distribution: {
        purchase: true,
        qty,
        value,
        reason: raw.unfulfilledReason,
        detail: raw.reasonDetail,
        remark: raw.remark,
        supplierShortName: raw.supplierShortName
      },
      sourceContext: { sourceSku: text(raw.materialCode) }
    });
  });

  const rows = [...rowMap.values()].map((row) => {
    const crossBorderInventoryQty = row.fbaInventoryQty + row.fbmInventoryQty + row.wfsInventoryQty;
    const crossBorderInventoryValue = row.fbaInventoryValue + row.fbmInventoryValue + row.wfsInventoryValue;
    const domesticInventoryQty = row.domesticMainInventoryQty + row.jdInventoryQty;
    const domesticInventoryValue = row.domesticMainInventoryValue + row.jdInventoryValue;
    const inventoryQty = crossBorderInventoryQty + domesticInventoryQty;
    const inventoryValue = crossBorderInventoryValue + domesticInventoryValue;
    const transitQty = row.fbaTransitQty + row.fbmTransitQty + row.wfsTransitQty + row.jdTransitQty;
    const transitValue = row.fbaTransitValue + row.fbmTransitValue + row.wfsTransitValue + row.jdTransitValue;
    const scaleQty = inventoryQty + transitQty + row.unfulfilledQty;
    const scaleValue = inventoryValue + transitValue + row.unfulfilledValue;
    const deliveryStatuses = [...row.deliveryStatuses];
    return {
      ...row,
      issues: [...row.issues],
      sourceTypes: [...row.sourceTypes],
      inventorySources: [...row.inventorySources],
      inventorySubjects: [...row.inventorySubjects].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
      inventorySubjectBreakdown: Object.entries(row.inventorySubjectBreakdown)
        .map(([subject, values]) => ({ subject, ...values }))
        .sort((left, right) => left.subject.localeCompare(right.subject, 'zh-Hans-CN')),
      inventorySegmentBreakdown: Object.values(row.inventorySegmentBreakdown)
        .sort((left, right) => (
          left.subject.localeCompare(right.subject, 'zh-Hans-CN')
          || left.productType.localeCompare(right.productType, 'zh-Hans-CN')
        )),
      inventorySourceDetails: Object.values(row.inventorySourceDetails)
        .sort((left, right) => (
          left.sourceTable.localeCompare(right.sourceTable, 'zh-Hans-CN')
          || left.sourceWarehouseName.localeCompare(right.sourceWarehouseName, 'zh-Hans-CN')
          || left.mappedWarehouseName.localeCompare(right.mappedWarehouseName, 'zh-Hans-CN')
        )),
      deliveryStatuses,
      unfulfilledSupplierShortNames: [...row.unfulfilledSupplierShortNames],
      unfulfilledSupplierShortName: [...row.unfulfilledSupplierShortNames].join('&') || '未匹配',
      deliveryStatus: deliveryStatuses.includes('是') && deliveryStatuses.includes('否')
        ? '是&否'
        : deliveryStatuses[0] || '无未交付',
      unfulfilledReasons: Object.entries(row.unfulfilledReasons).map(([name, values]) => ({ name, ...values })),
      reasonDetails: Object.entries(row.reasonDetails).map(([name, values]) => ({ name, ...values })),
      remarks: Object.entries(row.remarks).map(([name, values]) => ({ name, ...values })),
      crossBorderInventoryQty,
      crossBorderInventoryValue,
      domesticInventoryQty,
      domesticInventoryValue,
      inventoryQty,
      inventoryValue,
      transitQty,
      transitValue,
      scaleQty,
      scaleValue
    };
  });
  if (salesRegionConfigured) {
    const supportedSalesRegions = new Set(['美国', '欧洲', '中国', '沙特', '印度', '马来西亚', '越南', '新加坡', '韩国', '无法区分']);
    const salesRegionIssuesByMaterial = new Map();
    rows.forEach((row) => {
      const materialCode = text(row.materialCode);
      if (!materialCode || materialCode === '未匹配') return;
      const affectedQty = Math.abs(Number(row.inventoryQty || 0))
        + Math.abs(Number(row.transitQty || 0))
        + Math.abs(Number(row.unfulfilledQty || 0));
      const salesRegion = text(row.salesRegion);
      if (supportedSalesRegions.has(salesRegion)) return;
      const current = salesRegionIssuesByMaterial.get(materialCode) || {
        materialCode,
        sku: row.sku,
        materialName: row.materialName,
        productLine: row.productLine,
        productSeries: row.productSeries,
        businessUnit: '不适用',
        salesRegion: salesRegion || '未填写',
        qty: 0,
        value: 0
      };
      current.qty += affectedQty;
      current.value += Math.abs(Number(row.scaleValue || 0));
      salesRegionIssuesByMaterial.set(materialCode, current);
    });
    salesRegionIssuesByMaterial.forEach((issue) => {
      addAnomaly('供应计划分析', issue.materialCode, '销售区域缺失或无法识别', issue.qty, issue.value, issue);
    });
  }
  applyAbc(rows, 'salesQty', 'quantityAbc');
  applyAbc(rows, 'salesAmount', 'amountAbc');
  rows.sort((left, right) => (
    right.salesQty - left.salesQty
    || left.businessUnit.localeCompare(right.businessUnit, 'zh-Hans-CN')
    || left.materialCode.localeCompare(right.materialCode, 'zh-Hans-CN')
  ));

  const totals = rows.reduce((result, row) => {
    [
      'salesQty', 'salesAmount',
      'fbaInventoryQty', 'fbaInventoryValue',
      'fbmInventoryQty', 'fbmInventoryValue',
      'wfsInventoryQty', 'wfsInventoryValue',
      'crossBorderInventoryQty', 'crossBorderInventoryValue',
      'domesticMainInventoryQty', 'domesticMainInventoryValue',
      'jdInventoryQty', 'jdInventoryValue',
      'domesticInventoryQty', 'domesticInventoryValue',
      'inventoryQty', 'inventoryValue',
      'fbaTransitQty', 'fbaTransitValue',
      'fbmTransitQty', 'fbmTransitValue',
      'wfsTransitQty', 'wfsTransitValue',
      'jdTransitQty', 'jdTransitValue',
      'transitQty', 'transitValue',
      'finishedNotShippedQty', 'finishedNotShippedValue',
      'unpreparedQty', 'unpreparedValue',
      'preparedNotStartedQty', 'preparedNotStartedValue',
      'inProductionQty', 'inProductionValue',
      'unfulfilledQty', 'unfulfilledValue',
      'scaleQty', 'scaleValue'
    ].forEach((field) => {
      result[field] = (result[field] || 0) + Number(row[field] || 0);
    });
    return result;
  }, {});
  const quantityReconciliation = buildInventoryQuantityReconciliation({
    source,
    facts: quantityFactLedger,
    totals
  });
  const manualReconciliation = includeManualReconciliation
    ? buildInventoryManualReconciliation({
      systemFacts: manualReconciliationSystemFacts,
      manualSource,
      systemSource: source,
      productLookup,
      anomalies,
      quantityReconciliation,
      requestedCategories: manualReconciliationCategories
    })
    : null;
  const months = [...new Set(rows.flatMap((row) => Object.keys(row.salesByMonth)))].sort();
  const updatedAt = [...Object.values(source), ...Object.values(manualSource)].map((record) => record.updatedAt).filter(Boolean).sort().at(-1) || '';
  return {
    在制量: totals.unfulfilledQty || 0,
    在途量: totals.transitQty || 0,
    在库量: {
      国内: totals.domesticInventoryQty || 0,
      跨境: totals.crossBorderInventoryQty || 0,
      合计: totals.inventoryQty || 0
    },
    updatedAt,
    months,
    totals,
    quantityReconciliation,
    ...(manualReconciliation ? { manualReconciliation } : {}),
    anomalies,
    rows
  };
}

const INVENTORY_DIMENSION_TARGETS = {
  sku: {
    slotId: 'inventorySummaryFile10',
    title: 'Dim-领星SKU对应物料编码-产品管理',
    page: 'inventorySummaryLibrary',
    fields: ['SKU', '识别码（物料编码）']
  },
  jd: {
    slotId: 'inventorySummaryFile11',
    title: 'Dim-京东ID与品号匹配',
    page: 'inventorySummaryLibrary',
    fields: ['京东ID', '物料编码']
  },
  fbaWarehouse: {
    slotId: 'inventorySummaryFile9',
    title: 'Dim-领星FBA仓库&金蝶仓库',
    page: 'inventorySummaryLibrary',
    fields: ['主体', '领星FBA仓库', '金蝶仓库']
  },
  fbaTransitWarehouse: {
    slotId: 'inventorySummaryFile13',
    title: 'Dim-领星FBA在途&金蝶仓库',
    page: 'inventorySummaryLibrary',
    fields: ['店铺', '主体', '金蝶仓库']
  },
  warehouseSubject: {
    slotId: 'spare1',
    title: '仓库名称',
    page: 'dimensionLibrary',
    fields: ['使用组织（主体）', '仓库名称']
  },
  warehouseMaterial: {
    slotId: 'warehouseMaterialMap',
    title: '仓库与物料对照表',
    page: 'dimensionLibrary',
    fields: ['库存组织（主体）', '仓库名称', '物料编码', '事业部']
  },
  product: {
    slotId: 'productCategory',
    title: '商品分类',
    page: 'dimensionLibrary',
    fields: ['物料编码', 'SKU', '物料名称', '销售产品线', '销售系列', '销售区域', '不含税结算价']
  },
  fbmSource: {
    slotId: 'inventorySummaryFile2',
    title: 'FBM库存报表',
    page: 'inventorySummaryLibrary',
    fields: ['识别码']
  },
  jdTransitSource: {
    slotId: 'inventorySummaryFile14',
    title: '京东在途',
    page: 'inventorySummaryLibrary',
    fields: ['物料编码', '在途数量']
  }
};

function inventoryMaintenanceTarget(anomaly) {
  const issue = text(anomaly.issue);
  if (anomaly.sourceType === 'FBM库存' && issue === '识别码为空') {
    return INVENTORY_DIMENSION_TARGETS.fbmSource;
  }
  if (issue.startsWith('SKU与物料编码')) return INVENTORY_DIMENSION_TARGETS.sku;
  if (issue.startsWith('京东ID与品号')) return INVENTORY_DIMENSION_TARGETS.jd;
  if (issue.startsWith('仓库对照')) {
    return anomaly.sourceType === 'FBA在途'
      ? INVENTORY_DIMENSION_TARGETS.fbaTransitWarehouse
      : INVENTORY_DIMENSION_TARGETS.fbaWarehouse;
  }
  if (issue.startsWith('仓库主体')) return INVENTORY_DIMENSION_TARGETS.warehouseSubject;
  if (issue.startsWith('主体、仓库与物料')) return INVENTORY_DIMENSION_TARGETS.warehouseMaterial;
  if (anomaly.sourceType === '京东在途' && (issue === '在途数量不是有效数量' || issue === '物料编码为空')) {
    return INVENTORY_DIMENSION_TARGETS.jdTransitSource;
  }
  if ((issue.startsWith('商品分类') || issue.startsWith('不含税结算价') || issue.startsWith('销售区域')) && text(anomaly.materialCode)) {
    return INVENTORY_DIMENSION_TARGETS.product;
  }
  return null;
}

function inventoryMissingKey(anomaly, target) {
  const materialCode = text(anomaly.materialCode);
  const sourceSku = text(anomaly.sourceSku || anomaly.jdId || anomaly.sourceKey);
  const sourceWarehouse = text(anomaly.sourceWarehouseName || anomaly.storeName);
  if (target.slotId === 'inventorySummaryFile10') return sourceSku;
  if (target.slotId === 'inventorySummaryFile11') return text(anomaly.jdId || anomaly.sourceKey);
  if (target.slotId === 'inventorySummaryFile2') {
    return [anomaly.storeName, anomaly.marketplace, sourceWarehouse].map(text).filter(Boolean).join(' + ') || '识别码为空';
  }
  if (target.slotId === 'inventorySummaryFile9') return sourceWarehouse;
  if (target.slotId === 'inventorySummaryFile13') return text(anomaly.storeName || sourceWarehouse);
  if (target.slotId === 'spare1') return sourceWarehouse;
  if (target.slotId === 'warehouseMaterialMap') {
    return [anomaly.subject, anomaly.kingdeeWarehouseName || sourceWarehouse, materialCode].map(text).join(' + ');
  }
  return materialCode || sourceSku;
}

export function buildInventoryDimensionDiagnostics(model = {}) {
  const issues = (model.anomalies || []).filter((anomaly) => (
    !INVENTORY_SOURCE_TYPES.has(text(anomaly.sourceType))
    || ZERO_QUANTITY_DIAGNOSTIC_SOURCE_TYPES.has(text(anomaly.sourceType))
    || Math.abs(Number(anomaly.qty || 0)) > 0.000001
  )).flatMap((anomaly) => {
    const target = inventoryMaintenanceTarget(anomaly);
    if (!target) return [];
    const issueCode = text(anomaly.issue);
    const sourceFieldMissing = target.slotId === 'inventorySummaryFile2' && issueCode === '识别码为空';
    return [{
      id: `inventory-summary-${anomaly.id}-${target.slotId}`,
      factId: text(anomaly.factId || anomaly.id),
      sourceType: text(anomaly.sourceType),
      sourceKey: text(anomaly.sourceKey),
      issueCode,
      issueStatus: issueCode.includes('冲突') ? '映射冲突' : sourceFieldMissing ? '源字段缺失' : '维度缺失',
      targetSlotId: target.slotId,
      targetTitle: target.title,
      maintainPage: target.page,
      requiredFields: [...target.fields],
      maintenanceHint: `请在“${target.title}”补充：${target.fields.join('、')}`,
      missingKey: inventoryMissingKey(anomaly, target),
      subject: text(anomaly.subject),
      sourceWarehouseName: text(anomaly.sourceWarehouseName),
      kingdeeWarehouseName: text(anomaly.kingdeeWarehouseName),
      storeName: text(anomaly.storeName),
      marketplace: text(anomaly.marketplace),
      sourceSku: text(anomaly.sourceSku || anomaly.jdId || anomaly.sourceKey),
      sku: text(anomaly.sku) || '未匹配',
      materialCode: text(anomaly.materialCode),
      materialName: text(anomaly.materialName) || '未匹配',
      productLine: text(anomaly.productLine) || '未匹配',
      productSeries: text(anomaly.productSeries) || '未匹配',
      salesRegion: text(anomaly.salesRegion) || '未填写',
      businessUnit: text(anomaly.businessUnit) || '未匹配',
      qty: Number(anomaly.qty || 0),
      value: Number(anomaly.value || 0)
    }];
  });

  const taskMap = new Map();
  issues.forEach((row) => {
    const taskKey = [row.targetSlotId, row.issueCode].join('|');
    const task = taskMap.get(taskKey) || {
      id: taskKey,
      targetSlotId: row.targetSlotId,
      targetTitle: row.targetTitle,
      maintainPage: row.maintainPage,
      issueCode: row.issueCode,
      issueStatus: row.issueStatus,
      requiredFields: row.requiredFields,
      affectedRows: 0,
      affectedQty: 0,
      affectedValue: 0,
      sourceTypes: new Set(),
      missingKeys: new Set(),
      factIds: new Set()
    };
    task.sourceTypes.add(row.sourceType);
    if (row.missingKey) task.missingKeys.add(row.missingKey);
    if (!task.factIds.has(row.factId)) {
      task.factIds.add(row.factId);
      task.affectedRows += 1;
      task.affectedQty += row.qty;
      task.affectedValue += row.value;
    }
    taskMap.set(taskKey, task);
  });

  const tasks = [...taskMap.values()].map((task) => ({
    ...task,
    sourceTypes: [...task.sourceTypes].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    sampleKeys: [...task.missingKeys].slice(0, 8),
    factIds: undefined,
    missingKeys: undefined
  })).sort((left, right) => (
    right.affectedQty - left.affectedQty
    || left.targetTitle.localeCompare(right.targetTitle, 'zh-Hans-CN')
    || left.issueCode.localeCompare(right.issueCode, 'zh-Hans-CN')
  ));

  const affectedFacts = new Map();
  issues.forEach((row) => {
    if (!affectedFacts.has(row.factId)) affectedFacts.set(row.factId, row);
  });
  const affectedRows = [...affectedFacts.values()];
  return {
    issues,
    tasks,
    qualitySummary: {
      issueRows: issues.length,
      affectedFacts: affectedRows.length,
      affectedQty: affectedRows.reduce((sum, row) => sum + row.qty, 0),
      affectedValue: affectedRows.reduce((sum, row) => sum + row.value, 0),
      targetCount: new Set(issues.map((row) => row.targetSlotId)).size
    }
  };
}
