export const SUPPLY_PLAN_PAGE_SIZE = 100;
export const SUPPLY_PLAN_ROW_TYPES = Object.freeze([
  '销售预测',
  '未交付',
  '在途',
  '在库',
  '预测剩余库存',
  '建议采购'
]);

const HORIZON_MONTH_OPTIONS = new Set([6, 9, 12, 15, 18, 21, 24]);
const DAY_MS = 24 * 60 * 60 * 1000;

function dateLabel(date) {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

export function buildSupplyPlanWeeks(months = 6, now = new Date()) {
  const horizonMonths = HORIZON_MONTH_OPTIONS.has(Number(months)) ? Number(months) : 6;
  const current = new Date(now);
  const currentDay = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
  const start = new Date(currentDay);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() || 7) - 1));
  const end = new Date(Date.UTC(currentDay.getUTCFullYear(), currentDay.getUTCMonth() + horizonMonths, currentDay.getUTCDate()));
  const weeks = [];
  for (let monday = start; monday < end; monday = new Date(monday.getTime() + 7 * DAY_MS)) {
    const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
    const thursday = new Date(monday);
    thursday.setUTCDate(thursday.getUTCDate() + 3);
    const isoYear = thursday.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const week = Math.ceil((((thursday - yearStart) / DAY_MS) + 1) / 7);
    weeks.push({
      key: `${isoYear}-W${String(week).padStart(2, '0')}`,
      label: `W${week}`,
      dateRange: `${dateLabel(monday)}-${dateLabel(sunday)}`,
      startDate: monday.toISOString().slice(0, 10),
      endDate: sunday.toISOString().slice(0, 10)
    });
  }
  return weeks;
}

export const SUPPLY_PLAN_FILTER_FIELDS = Object.freeze([
  { key: 'businessUnit', label: '事业部' },
  { key: 'productLine', label: '产品线' },
  { key: 'productSeries', label: '系列' },
  { key: 'actionConclusion', label: '动作结论' }
]);
const ACTION_CONCLUSION_ORDER = ['正常流转', '加急补货', '调整计划', '停采观察'];

function text(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

function headerText(value) {
  return text(value).replace(/\s+/g, '');
}

function numberValue(value) {
  const number = Number.parseFloat(text(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
}

export function normalizeSupplyPlanImportKey(value, keyType = 'sku') {
  const normalized = text(value);
  if (!normalized) return '';
  return keyType === 'materialCode'
    ? normalized.replace(/\.0$/, '')
    : normalized.toUpperCase();
}

export function supplyPlanRowKey(row) {
  return `${text(row?.businessUnit)}\u001f${normalizeSupplyPlanImportKey(row?.materialCode, 'materialCode')}`;
}

export function supplyPlanModelKey(row) {
  const productLine = text(row?.productLine) || '未匹配产品线';
  const productSeries = text(row?.productSeries) || '未匹配系列';
  const model = text(row?.model);
  const fallback = text(row?.sku) || normalizeSupplyPlanImportKey(row?.materialCode, 'materialCode') || '未匹配型号';
  return `${productLine}\u001f${productSeries}\u001f${model || fallback}`;
}

const SUPPLY_PLAN_SUM_FIELDS = Object.freeze([
  'onHandQty',
  'inTransitQty',
  'undeliveredQty',
  'inventoryQty',
  'forecastTotal',
  'dailyForecast',
  'safetyStockQty',
  'inventoryRemainingQty',
  'purchaseGap'
]);

export function groupSupplyPlanRows(rows = [], weekCount = Math.max(0, ...rows.map((row) => row?.weeklyForecast?.length || 0))) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = supplyPlanModelKey(row);
    const group = groups.get(key) || {
      key,
      productLine: text(row?.productLine) || '未匹配产品线',
      productSeries: text(row?.productSeries) || '未匹配系列',
      model: text(row?.model) || '未匹配型号',
      businessUnit: '全量汇总',
      materialCode: '',
      sku: '',
      materialName: '按型号汇总',
      weeklyForecast: Array.from({ length: weekCount }, () => 0),
      children: []
    };
    SUPPLY_PLAN_SUM_FIELDS.forEach((field) => {
      group[field] = numberValue(group[field]) + numberValue(row?.[field]);
    });
    group.weeklyForecast = group.weeklyForecast.map((value, index) => (
      value + numberValue(row?.weeklyForecast?.[index])
    ));
    group.children.push(row);
    groups.set(key, group);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      children: [...group.children].sort((left, right) => (
        text(left.businessUnit).localeCompare(text(right.businessUnit), 'zh-CN')
        || normalizeSupplyPlanImportKey(left.materialCode, 'materialCode').localeCompare(
          normalizeSupplyPlanImportKey(right.materialCode, 'materialCode'),
          'zh-CN',
          { numeric: true }
        )
      ))
    }))
    .sort((left, right) => (
      left.productLine.localeCompare(right.productLine, 'zh-CN')
      || left.productSeries.localeCompare(right.productSeries, 'zh-CN')
      || left.model.localeCompare(right.model, 'zh-CN', { numeric: true })
    ));
}

export function matchesSupplyPlanFilters(row, filters = {}, omit = '') {
  return SUPPLY_PLAN_FILTER_FIELDS.every(({ key }) => (
    key === omit || !text(filters[key]) || text(row?.[key]) === text(filters[key])
  ));
}

export function buildSupplyPlanFilterOptions(rows = [], filters = {}) {
  return Object.fromEntries(SUPPLY_PLAN_FILTER_FIELDS.map(({ key }) => {
    if (key === 'actionConclusion') return [key, ACTION_CONCLUSION_ORDER];
    const values = new Set();
    rows.forEach((row) => {
      if (!matchesSupplyPlanFilters(row, filters, key)) return;
      const value = text(row?.[key]);
      if (value) values.add(value);
    });
    return [key, [...values].sort((left, right) => left.localeCompare(right, 'zh-CN'))];
  }));
}

export function filterSupplyPlanRows(rows = [], filters = {}) {
  return rows.filter((row) => matchesSupplyPlanFilters(row, filters));
}

function importKeyType(header) {
  return header.includes('物料编码') ? 'materialCode' : 'sku';
}

export function parseSupplyPlanWorksheet(aoa, { mode = 'forecast', weekCount = 21 } = {}) {
  if (!Array.isArray(aoa) || aoa.length < 2) throw new Error('导入文件没有可读取的数据行');
  const headers = (aoa[0] || []).map(headerText);
  const keyIndex = headers.findIndex((header) => header.toUpperCase().includes('SKU') || header.includes('物料编码'));
  if (keyIndex < 0) throw new Error('导入文件需要 SKU 或物料编码列');
  const keyType = importKeyType(headers[keyIndex]);
  const safetyIndex = headers.findIndex((header) => header.includes('安全库存'));
  const weekIndexes = headers.reduce((indexes, header, index) => {
    if (/^W\d+$/i.test(header) || /第\d+周/.test(header)) indexes.push(index);
    return indexes;
  }, []);
  if (mode === 'forecast' && weekIndexes.length === 0) throw new Error('销售预测文件没有识别到周预测列');
  if (mode === 'safety' && safetyIndex < 0) throw new Error('安全库存文件没有识别到安全库存列');

  const entries = new Map();
  for (let rowIndex = 1; rowIndex < aoa.length; rowIndex += 1) {
    const row = aoa[rowIndex] || [];
    const key = normalizeSupplyPlanImportKey(row[keyIndex], keyType);
    if (!key) continue;
    const forecast = mode === 'forecast'
      ? Array.from({ length: weekCount }, (_, index) => numberValue(row[weekIndexes[index]]))
      : null;
    const safetyRaw = safetyIndex >= 0 ? text(row[safetyIndex]) : '';
    entries.set(key, {
      key,
      sourceRow: rowIndex + 1,
      forecast,
      safetyOverride: safetyRaw === '' ? null : numberValue(row[safetyIndex])
    });
  }

  return {
    mode,
    keyType,
    keyHeader: headers[keyIndex],
    entries: [...entries.values()],
    recognizedWeekColumns: Math.min(weekIndexes.length, weekCount),
    ignoredWeekColumns: Math.max(0, weekIndexes.length - weekCount),
    safetyColumnFound: safetyIndex >= 0
  };
}

export function applySupplyPlanImport(rows, parsed, currentForecasts = {}, currentSafetyOverrides = {}) {
  const rowKeysByImportKey = new Map();
  (rows || []).forEach((row) => {
    const importKey = normalizeSupplyPlanImportKey(
      parsed.keyType === 'materialCode' ? row.materialCode : row.sku,
      parsed.keyType
    );
    if (!importKey) return;
    const rowKeys = rowKeysByImportKey.get(importKey) || [];
    rowKeys.push(supplyPlanRowKey(row));
    rowKeysByImportKey.set(importKey, rowKeys);
  });

  const forecasts = { ...currentForecasts };
  const safetyOverrides = { ...currentSafetyOverrides };
  let matchedImportRows = 0;
  let updatedSkuRows = 0;
  let unmatchedImportRows = 0;
  parsed.entries.forEach((entry) => {
    const matchingRowKeys = rowKeysByImportKey.get(entry.key) || [];
    if (!matchingRowKeys.length) {
      unmatchedImportRows += 1;
      return;
    }
    matchedImportRows += 1;
    updatedSkuRows += matchingRowKeys.length;
    matchingRowKeys.forEach((rowKey) => {
      if (parsed.mode === 'forecast' && entry.forecast) forecasts[rowKey] = [...entry.forecast];
      if (entry.safetyOverride !== null) safetyOverrides[rowKey] = entry.safetyOverride;
    });
  });

  return {
    forecasts,
    safetyOverrides,
    stats: {
      importedRows: parsed.entries.length,
      matchedImportRows,
      unmatchedImportRows,
      updatedSkuRows,
      recognizedWeekColumns: parsed.recognizedWeekColumns,
      ignoredWeekColumns: parsed.ignoredWeekColumns
    }
  };
}

export function calculateSupplyPlanRow(row, forecast = row?.weeklyForecast || [], safetyOverride = null, weekCount = forecast.length) {
  const weeklyForecast = Array.from({ length: weekCount }, (_, index) => numberValue(forecast[index]));
  const forecastTotal = weeklyForecast.reduce((sum, value) => sum + value, 0);
  const dailyForecast = Math.round(numberValue(row?.forecastDailyQty) || (weekCount ? forecastTotal / (weekCount * 7) : 0));
  const calculatedSafety = dailyForecast * numberValue(row?.safetyDays);
  const safetyStockQty = safetyOverride === null || safetyOverride === undefined
    ? calculatedSafety
    : numberValue(safetyOverride);
  const purchaseGap = Math.max(
    0,
    safetyStockQty + numberValue(weeklyForecast[0])
      - numberValue(row?.onHandQty)
      - numberValue(row?.inTransitQty)
      - numberValue(row?.undeliveredQty)
  );
  const inventoryRemainingQty = numberValue(row?.inTransitQty)
    + numberValue(row?.onHandQty)
    - numberValue(weeklyForecast[0]);
  return {
    ...row,
    weeklyForecast,
    forecastTotal,
    dailyForecast,
    safetyStockQty,
    inventoryRemainingQty,
    purchaseGap
  };
}
