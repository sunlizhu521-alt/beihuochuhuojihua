export const SUPPLY_PLAN_PAGE_SIZE = 50;
export const SUPPLY_PLAN_ROW_TYPES = Object.freeze([
  '销售预测',
  '未交付量',
  '在途量',
  '在库量',
  '采购数量',
  '出货数量'
]);

function dateLabel(date) {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

export function buildSupplyPlanWeeks() {
  const start = Date.UTC(2026, 7, 10);
  return Array.from({ length: 21 }, (_, index) => {
    const monday = new Date(start + index * 7 * 24 * 60 * 60 * 1000);
    const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
    return {
      key: `W${32 + index}`,
      label: `W${32 + index}`,
      dateRange: `${dateLabel(monday)}-${dateLabel(sunday)}`,
      startDate: monday.toISOString().slice(0, 10),
      endDate: sunday.toISOString().slice(0, 10)
    };
  });
}

export const SUPPLY_PLAN_WEEKS = Object.freeze(buildSupplyPlanWeeks());

export const SUPPLY_PLAN_FILTER_FIELDS = Object.freeze([
  { key: 'businessUnit', label: '事业部' },
  { key: 'productLine', label: '产品线' },
  { key: 'productSeries', label: '系列' }
]);

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

export function matchesSupplyPlanFilters(row, filters = {}, omit = '') {
  return SUPPLY_PLAN_FILTER_FIELDS.every(({ key }) => (
    key === omit || !text(filters[key]) || text(row?.[key]) === text(filters[key])
  ));
}

export function buildSupplyPlanFilterOptions(rows = [], filters = {}) {
  return Object.fromEntries(SUPPLY_PLAN_FILTER_FIELDS.map(({ key }) => {
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

export function parseSupplyPlanWorksheet(aoa, { mode = 'forecast', weekCount = SUPPLY_PLAN_WEEKS.length } = {}) {
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

export function calculateSupplyPlanRow(row, forecast = [], safetyOverride = null, weekCount = SUPPLY_PLAN_WEEKS.length) {
  const weeklyForecast = Array.from({ length: weekCount }, (_, index) => numberValue(forecast[index]));
  const forecastTotal = weeklyForecast.reduce((sum, value) => sum + value, 0);
  const dailyForecast = Math.round(forecastTotal / (weekCount * 7));
  const calculatedSafety = dailyForecast * numberValue(row?.safetyDays);
  const safetyStockQty = safetyOverride === null || safetyOverride === undefined
    ? calculatedSafety
    : numberValue(safetyOverride);
  const purchaseGap = Math.max(
    0,
    safetyStockQty + forecastTotal - numberValue(row?.onHandQty) - numberValue(row?.inTransitQty)
  );
  return {
    ...row,
    weeklyForecast,
    forecastTotal,
    dailyForecast,
    safetyStockQty,
    purchaseGap
  };
}
