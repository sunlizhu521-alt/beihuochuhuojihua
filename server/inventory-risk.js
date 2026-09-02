const DOMESTIC_BUSINESS_UNITS = new Set(['国内事业部', '销售部-工厂']);
const RISK_SOURCE_TYPES = new Set([
  'FBA库存', 'FBM库存', 'WFS库存', '国内在库', '京东在库',
  'FBA在途', 'FBM在途', 'WFS在途', '京东在途', '采购跟单', '库存风险', '供应计划分析'
]);

export const INVENTORY_RISK_CHANNELS = Object.freeze([
  { key: 'overseasUs', label: '海外-美国', salesRegion: '美国' },
  { key: 'overseasEurope', label: '海外-欧洲', salesRegion: '欧洲' },
  { key: 'domestic', label: '国内', salesRegion: '中国' }
]);
const CHANNEL_BY_SALES_REGION = new Map(INVENTORY_RISK_CHANNELS.map((channel) => [channel.salesRegion, channel]));
const B2B_SALES_REGIONS = new Set(['沙特', '印度', '马来西亚', '越南', '新加坡', '韩国']);
const IGNORED_SALES_REGIONS = new Set(['无法区分']);
const DEFAULT_CHANNEL_PARAMS = Object.freeze({
  onHandSellableDays: 10,
  dispatchToShelfDays: 10,
  transportDays: 10,
  bookingDays: 10,
  averageLeadTimeDays: 10,
  contractSigningDays: 10,
  restrictThresholdDays: 40,
  stopThresholdDays: 50
});

export const INVENTORY_RISK_DEFAULT_PARAMS = Object.freeze({
  forecastMonths: 6,
  historicalMonths: 6,
  channels: Object.freeze(Object.fromEntries(INVENTORY_RISK_CHANNELS.map(({ key }) => [key, Object.freeze({ ...DEFAULT_CHANNEL_PARAMS })])))
});

const SUPPLY_PLAN_CHANNELS = [
  { key: 'overseasUs', label: '海外-美国', salesRegion: '美国' },
  { key: 'overseasEurope', label: '海外-欧洲', salesRegion: '欧洲' },
  { key: 'domestic', label: '国内', salesRegion: '中国' }
];

const SUPPLY_PLAN_DEFAULT_CHANNEL_PARAMS = {
  overseasUs: {
    onHandSellableDays: 60,
    dispatchToShelfDays: 10,
    transportDays: 40,
    bookingDays: 10,
    averageLeadTimeDays: 45,
    contractSigningDays: 10,
    safetyDays: 175
  },
  overseasEurope: {
    onHandSellableDays: 60,
    dispatchToShelfDays: 10,
    transportDays: 55,
    bookingDays: 10,
    averageLeadTimeDays: 45,
    contractSigningDays: 10,
    safetyDays: 190
  },
  domestic: {
    onHandSellableDays: 30,
    dispatchToShelfDays: 7,
    transportDays: 7,
    bookingDays: 3,
    averageLeadTimeDays: 45,
    contractSigningDays: 10,
    safetyDays: 102
  }
};

function text(value) {
  return String(value ?? '').trim();
}

function headerKey(value) {
  return text(value).normalize('NFKC').replace(/[\s_()（）\[\]【】]/g, '').toLowerCase();
}

function numberValue(value) {
  const parsed = Number.parseFloat(text(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowValue(row, aliases) {
  const wanted = new Set(aliases.map(headerKey));
  const entry = Object.entries(row || {}).find(([key]) => wanted.has(headerKey(key)));
  return entry?.[1] ?? '';
}

function materialCodeValue(value) {
  return text(value).replace(/\.0$/, '');
}

function normalizedBusinessUnit(value) {
  return text(value).split(/[\*＊]/, 1)[0].trim();
}

function businessUnitRegion(value) {
  const businessUnit = normalizedBusinessUnit(value);
  if (!businessUnit || businessUnit === '未匹配') return '';
  return DOMESTIC_BUSINESS_UNITS.has(businessUnit) ? '国内' : '海外';
}

function riskChannel(value) {
  const salesRegion = text(value);
  if (CHANNEL_BY_SALES_REGION.has(salesRegion)) return { status: 'included', ...CHANNEL_BY_SALES_REGION.get(salesRegion) };
  if (B2B_SALES_REGIONS.has(salesRegion)) return { status: 'b2b', salesRegion };
  if (IGNORED_SALES_REGIONS.has(salesRegion)) return { status: 'ignored', salesRegion };
  return { status: 'missing', salesRegion };
}

function businessUnitMaterialKey(businessUnit, materialCode) {
  return `${businessUnit}\u001f${materialCode}`;
}

function monthIndex(month) {
  const match = text(month).match(/^(\d{4})-(\d{2})$/);
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : NaN;
}

function monthFromIndex(index) {
  if (!Number.isFinite(index)) return '';
  const year = Math.floor(index / 12);
  return `${year}-${String(index % 12 + 1).padStart(2, '0')}`;
}

function monthRange(startMonth, count) {
  const start = monthIndex(startMonth);
  return Array.from({ length: count }, (_, index) => monthFromIndex(start + index));
}

function currentChinaMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return year && month ? `${year}-${month}` : now.toISOString().slice(0, 7);
}

export function forecastMonth(value) {
  const normalized = text(value).normalize('NFKC').replace(/\s+/g, '');
  const match = normalized.match(/^(\d{4})(?:年|[-/.])(\d{1,2})(?:月)?$/);
  if (!match) return '';
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[1]}-${String(month).padStart(2, '0')}` : '';
}

function validYearMonth(yearValue, monthValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  if (!Number.isInteger(year) || year < 2000 || year > 2099 || !Number.isInteger(month) || month < 1 || month > 12) return '';
  return `${year}-${String(month).padStart(2, '0')}`;
}

function sourceFileMonth(value) {
  const normalized = text(value).normalize('NFKC');
  const dated = [...normalized.matchAll(/(?:^|[^\d])((?:19|20)?\d{2})[年./_-](\d{1,2})[月./_-](\d{1,2})(?:日)?(?=$|[^\d])/g)]
    .map((match) => validYearMonth(match[1].length === 2 ? 2000 + Number(match[1]) : match[1], match[2]))
    .filter(Boolean);
  if (dated.length) return dated.at(-1);
  const compact = [...normalized.matchAll(/(?:^|[^\d])((?:19|20)\d{2})(\d{2})(\d{2})(?=$|[^\d])/g)]
    .map((match) => validYearMonth(match[1], match[2]))
    .filter(Boolean);
  if (compact.length) return compact.at(-1);
  const yearMonths = [...normalized.matchAll(/(?:^|[^\d])((?:19|20)\d{2})[年./_-](\d{1,2})(?:月)?(?=$|[^\d])/g)]
    .map((match) => validYearMonth(match[1], match[2]))
    .filter(Boolean);
  return yearMonths.at(-1) || '';
}

function forecastAnchor(forecastSource, now) {
  const fileMonth = sourceFileMonth(forecastSource?.fileName);
  if (fileMonth) return { month: fileMonth, source: '文件名日期' };
  const updatedMonth = text(forecastSource?.updatedAt).match(/((?:19|20)\d{2})-(\d{1,2})/) || [];
  const normalizedUpdatedMonth = validYearMonth(updatedMonth[1], updatedMonth[2]);
  if (normalizedUpdatedMonth) return { month: normalizedUpdatedMonth, source: '槽位更新时间' };
  return { month: currentChinaMonth(now), source: '当前月份' };
}

function explicitForecastHeaderMonth(value) {
  const direct = forecastMonth(value);
  if (direct) return direct;
  const normalized = text(value).normalize('NFKC').replace(/\s+/g, '');
  const match = normalized.match(/^(\d{4})(?:年|[-/.])(\d{1,2})(?:月)?(?:预估|预测)销量$/);
  return match ? validYearMonth(match[1], match[2]) : '';
}

function monthOnlyForecastNumber(value) {
  const normalized = text(value).normalize('NFKC').replace(/\s+/g, '');
  const match = normalized.match(/^(\d{1,2})月(?:预估|预测)销量$/);
  const month = Number(match?.[1]);
  return month >= 1 && month <= 12 ? month : 0;
}

function orderedForecastHeaders(rows) {
  const seen = new Set();
  const headers = [];
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((header) => {
      if (seen.has(header)) return;
      seen.add(header);
      headers.push(header);
    });
  });
  return headers;
}

function inferMonthOnlyColumns(columns, anchorMonth) {
  if (!columns.length) return [];
  const anchor = monthIndex(anchorMonth);
  const anchorYear = Number(anchorMonth.slice(0, 4));
  const relative = [];
  let yearOffset = 0;
  let previousMonth = columns[0].monthNumber;
  columns.forEach((column, index) => {
    if (index > 0 && column.monthNumber < previousMonth) yearOffset += 1;
    relative.push({ ...column, yearOffset });
    previousMonth = column.monthNumber;
  });
  const candidates = [anchorYear - 1, anchorYear, anchorYear + 1].map((firstYear) => {
    const indexes = relative.map((column) => (firstYear + column.yearOffset) * 12 + column.monthNumber - 1);
    const distance = Math.min(...indexes.map((index) => Math.abs(index - anchor)));
    const startDistance = Math.abs(indexes[0] - anchor);
    return { firstYear, distance, startDistance };
  }).sort((left, right) => left.distance - right.distance || left.startDistance - right.startDistance);
  const firstYear = candidates[0].firstYear;
  return relative.map((column) => ({
    header: column.header,
    month: validYearMonth(firstYear + column.yearOffset, column.monthNumber),
    format: '无年份销量列'
  }));
}

function forecastColumnPlan(forecastRows, forecastSource, now) {
  const headers = orderedForecastHeaders(forecastRows);
  const anchor = forecastAnchor(forecastSource, now);
  const explicitColumns = headers
    .map((header) => ({ header, month: explicitForecastHeaderMonth(header), format: '带年份月份列' }))
    .filter((column) => column.month);
  const monthOnlyColumns = inferMonthOnlyColumns(headers
    .map((header) => ({ header, monthNumber: monthOnlyForecastNumber(header) }))
    .filter((column) => column.monthNumber), anchor.month);
  const headerFor = (aliases) => headers.find((header) => aliases.some((alias) => headerKey(alias) === headerKey(header))) || '';
  return {
    headers,
    columns: [...explicitColumns, ...monthOnlyColumns],
    anchor,
    recognizedFields: {
      businessUnit: headerFor(['事业部', '部门', '业务部门', '销售部门']),
      materialCode: headerFor(['物料编码', '品号', '商品编码', 'materialCode']),
      sku: headerFor(['SKU', 'sku', 'MSKU', '型号']),
      longMonth: headerFor(['月份', '预测月份', '日期', '销售月份']),
      longQuantity: headerFor(['预测数量', '销售预测', '预测销量', '数量'])
    }
  };
}

function numberParam(input, field, fallback, label = field) {
  const value = input?.[field] === '' || input?.[field] === undefined ? fallback : Number(input[field]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} 必须是非负数字`);
  return value;
}

function monthParam(input, field) {
  const value = numberParam(input, field, INVENTORY_RISK_DEFAULT_PARAMS[field], field);
  if (!Number.isInteger(value) || value < 1 || value > 24) throw new Error(`${field} 必须是1到24之间的整数`);
  return value;
}

export function normalizeInventoryRiskParams(input = {}) {
  const channels = Object.fromEntries(INVENTORY_RISK_CHANNELS.map(({ key, label }) => {
    const source = input?.channels?.[key] || {};
    const normalized = Object.fromEntries(Object.keys(DEFAULT_CHANNEL_PARAMS).map((field) => [
      field,
      numberParam(source, field, DEFAULT_CHANNEL_PARAMS[field], `${label}${field}`)
    ]));
    normalized.spotDays = normalized.onHandSellableDays
      + normalized.dispatchToShelfDays
      + normalized.transportDays
      + normalized.bookingDays;
    normalized.fullChainDays = normalized.spotDays
      + normalized.averageLeadTimeDays
      + normalized.contractSigningDays;
    return [key, normalized];
  }));
  return {
    forecastMonths: monthParam(input, 'forecastMonths'),
    historicalMonths: monthParam(input, 'historicalMonths'),
    channels
  };
}

export function normalizeSupplyPlanParams(input = {}) {
  const editableFields = [
    'onHandSellableDays',
    'dispatchToShelfDays',
    'transportDays',
    'bookingDays',
    'averageLeadTimeDays',
    'contractSigningDays'
  ];
  const channels = Object.fromEntries(SUPPLY_PLAN_CHANNELS.map(({ key, label }) => {
    const source = input?.channels?.[key] || {};
    const defaults = SUPPLY_PLAN_DEFAULT_CHANNEL_PARAMS[key];
    const normalized = Object.fromEntries(editableFields.map((field) => [
      field,
      numberParam(source, field, defaults[field], `${label}${field}`)
    ]));
    normalized.spotDays = normalized.onHandSellableDays
      + normalized.dispatchToShelfDays
      + normalized.transportDays
      + normalized.bookingDays;
    normalized.fullChainDays = normalized.spotDays
      + normalized.averageLeadTimeDays
      + normalized.contractSigningDays;
    normalized.safetyDays = numberParam(source, 'safetyDays', normalized.fullChainDays, `${label}safetyDays`);
    return [key, normalized];
  }));
  return { channels };
}

function uniqueSkuMap(rows) {
  const candidates = new Map();
  for (const row of rows) {
    const sku = headerKey(row.sku);
    const materialCode = materialCodeValue(row.materialCode);
    if (!sku || !materialCode || materialCode === '未匹配') continue;
    if (!candidates.has(sku)) candidates.set(sku, new Set());
    candidates.get(sku).add(materialCode);
  }
  return new Map([...candidates]
    .filter(([, values]) => values.size === 1)
    .map(([sku, values]) => [sku, [...values][0]]));
}

function materialBusinessUnits(rows) {
  const businessUnits = new Map();
  for (const row of rows) {
    const materialCode = materialCodeValue(row.materialCode);
    const businessUnit = normalizedBusinessUnit(row.businessUnit);
    if (!materialCode || materialCode === '未匹配' || !businessUnit || businessUnit === '未匹配') continue;
    if (!businessUnits.has(materialCode)) businessUnits.set(materialCode, new Set());
    businessUnits.get(materialCode).add(businessUnit);
  }
  return businessUnits;
}

function forecastMaterialCode(row, skuMap) {
  const direct = materialCodeValue(rowValue(row, ['物料编码', '品号', '商品编码', 'materialCode']));
  if (direct) return direct;
  const sku = headerKey(rowValue(row, ['SKU', 'sku', 'MSKU', '型号']));
  return skuMap.get(sku) || '';
}

function buildForecastMap(forecastRows, summaryRows, forecastSource, now) {
  const skuMap = uniqueSkuMap(summaryRows);
  const businessUnitsByMaterial = materialBusinessUnits(summaryRows);
  const forecast = new Map();
  const issues = [];
  const columnPlan = forecastColumnPlan(forecastRows, forecastSource, now);
  const reasonCounts = {
    totalRows: forecastRows.length,
    parsedRows: 0,
    missingMaterialCode: 0,
    missingBusinessUnit: 0,
    invalidLongMonth: 0,
    noValidMonthColumns: 0
  };
  const add = (businessUnit, materialCode, month, value) => {
    const key = businessUnitMaterialKey(businessUnit, materialCode);
    const target = forecast.get(key) || { months: new Map(), hasRecord: false };
    target.hasRecord = true;
    target.months.set(month, (target.months.get(month) || 0) + numberValue(value));
    forecast.set(key, target);
  };

  forecastRows.forEach((row, index) => {
    const materialCode = forecastMaterialCode(row, skuMap);
    let businessUnit = normalizedBusinessUnit(rowValue(row, ['事业部', '部门', '业务部门', '销售部门']));
    if ((!businessUnit || businessUnit === '未匹配') && materialCode && businessUnitsByMaterial.get(materialCode)?.size === 1) {
      businessUnit = [...businessUnitsByMaterial.get(materialCode)][0];
    }
    const region = businessUnitRegion(businessUnit);
    if (!materialCode || !businessUnit || businessUnit === '未匹配' || !region) {
      if (!materialCode) reasonCounts.missingMaterialCode += 1;
      if (!businessUnit || businessUnit === '未匹配' || !region) reasonCounts.missingBusinessUnit += 1;
      issues.push({ id: `forecast-${index}`, row: index + 2, materialCode: materialCode || '未匹配', issue: materialCode ? '销售预测事业部缺失或无法匹配到唯一事业部' : '销售预测物料编码或SKU未匹配' });
      return;
    }
    const longMonthValue = rowValue(row, ['月份', '预测月份', '日期', '销售月份']);
    const longMonth = forecastMonth(longMonthValue);
    if (longMonth) {
      add(businessUnit, materialCode, longMonth, rowValue(row, ['预测数量', '销售预测', '预测销量', '数量']));
      reasonCounts.parsedRows += 1;
      return;
    }
    let parsedMonths = 0;
    columnPlan.columns.forEach(({ header, month }) => {
      if (!Object.hasOwn(row || {}, header)) return;
      parsedMonths += 1;
      add(businessUnit, materialCode, month, row[header]);
    });
    if (!parsedMonths) {
      const issue = text(longMonthValue) ? '销售预测月份格式无法识别' : '销售预测未找到有效月份列';
      if (text(longMonthValue)) reasonCounts.invalidLongMonth += 1;
      else reasonCounts.noValidMonthColumns += 1;
      issues.push({ id: `forecast-${index}`, row: index + 2, materialCode, issue });
    } else {
      reasonCounts.parsedRows += 1;
    }
  });
  return {
    forecast,
    issues,
    parsing: {
      sourceFileName: text(forecastSource?.fileName),
      sourceUpdatedAt: text(forecastSource?.updatedAt),
      anchorMonth: columnPlan.anchor.month,
      anchorSource: columnPlan.anchor.source,
      headers: columnPlan.headers,
      monthColumns: columnPlan.columns,
      recognizedFields: columnPlan.recognizedFields,
      parsedKeyCount: forecast.size,
      reasonCounts
    }
  };
}

function addAggregate(map, row) {
  const businessUnit = normalizedBusinessUnit(row.businessUnit);
  const materialCode = materialCodeValue(row.materialCode);
  const channel = riskChannel(row.salesRegion);
  if (!businessUnit || businessUnit === '未匹配' || !materialCode || materialCode === '未匹配') return 'invalid-key';
  if (channel.status !== 'included') return channel.status;
  const key = businessUnitMaterialKey(businessUnit, materialCode);
  const current = map.get(key) || {
    businessUnit,
    inventorySegment: channel.key === 'domestic' ? '国内' : '海外',
    salesRegion: channel.salesRegion,
    channelKey: channel.key,
    channel: channel.label,
    materialCode,
    sku: row.sku || '未匹配',
    materialName: row.materialName || '未匹配',
    productLine: row.productLine || '未匹配',
    productSeries: row.productSeries || '未匹配',
    model: row.model || '未匹配',
    onHandQty: 0,
    inTransitQty: 0,
    undeliveredQty: 0,
    unfulfilledSupplierShortNames: new Set(),
    dataSources: new Set(),
    warehouseLocations: new Set(),
    sites: new Set(),
    salesByMonth: new Map()
  };
  current.onHandQty += numberValue(row.inventoryQty);
  current.inTransitQty += numberValue(row.transitQty);
  current.undeliveredQty += numberValue(row.unfulfilledQty);
  if (numberValue(row.unfulfilledQty) > 0) {
    const supplierValues = Array.isArray(row.unfulfilledSupplierShortNames)
      ? row.unfulfilledSupplierShortNames
      : String(row.unfulfilledSupplierShortName || '').split(/[&+、,，;；]/);
    supplierValues.map(text).filter((name) => name && name !== '未匹配').forEach((name) => current.unfulfilledSupplierShortNames.add(name));
  }
  (row.inventorySourceDetails || []).forEach((item) => {
    const sourceTable = text(item.sourceTable) || '未知来源';
    const locations = [];
    const sourceWarehouse = text(item.sourceWarehouseName);
    const storeName = text(item.storeName);
    const receivingWarehouse = text(item.receivingWarehouseName);
    const mappedWarehouse = text(item.mappedWarehouseName);
    current.warehouseLocations.add(text(item.warehouseLocation) || '未匹配');
    current.sites.add(text(item.site) || '未匹配');
    if (sourceWarehouse) locations.push(sourceWarehouse);
    else if (storeName) locations.push(`店铺：${storeName}`);
    if (receivingWarehouse && !locations.includes(receivingWarehouse)) locations.push(`收货：${receivingWarehouse}`);
    if (mappedWarehouse && !locations.includes(mappedWarehouse)) locations.push(`映射：${mappedWarehouse}`);
    current.dataSources.add(`${sourceTable}：${locations.join(' → ') || '无仓库字段'}`);
  });
  Object.entries(row.salesByMonth || {}).forEach(([month, qty]) => {
    current.salesByMonth.set(month, (current.salesByMonth.get(month) || 0) + numberValue(qty));
  });
  map.set(key, current);
  return 'included';
}

function addModelAggregate(map, row) {
  const businessUnit = normalizedBusinessUnit(row.businessUnit);
  const model = text(row.model);
  const key = `${businessUnit}\u001f${model}`;
  if (!businessUnit || businessUnit === '未匹配' || !model || model === '未匹配') return 'invalid-key';
  const channel = riskChannel(row.salesRegion);
  if (channel.status !== 'included') return channel.status;
  const current = map.get(key) || {
    businessUnit,
    inventorySegment: channel.key === 'domestic' ? '国内' : '海外',
    salesRegion: channel.salesRegion,
    channelKey: channel.key,
    channel: channel.label,
    materialCode: '',
    sku: '',
    materialName: '',
    productLine: row.productLine || '未匹配',
    productSeries: row.productSeries || '未匹配',
    model,
    onHandQty: 0,
    inTransitQty: 0,
    undeliveredQty: 0,
    unfulfilledSupplierShortNames: new Set(),
    dataSources: new Set(),
    warehouseLocations: new Set(),
    sites: new Set(),
    salesByMonth: new Map()
  };
  current.onHandQty += numberValue(row.inventoryQty);
  current.inTransitQty += numberValue(row.transitQty);
  current.undeliveredQty += numberValue(row.unfulfilledQty);
  if (numberValue(row.unfulfilledQty) > 0) {
    const supplierValues = Array.isArray(row.unfulfilledSupplierShortNames)
      ? row.unfulfilledSupplierShortNames
      : String(row.unfulfilledSupplierShortName || '').split(/[&+、,，;；]/);
    supplierValues.map(text).filter((name) => name && name !== '未匹配').forEach((name) => current.unfulfilledSupplierShortNames.add(name));
  }
  (row.inventorySourceDetails || []).forEach((item) => {
    const sourceTable = text(item.sourceTable) || '未知来源';
    const locations = [];
    const sourceWarehouse = text(item.sourceWarehouseName);
    const storeName = text(item.storeName);
    const receivingWarehouse = text(item.receivingWarehouseName);
    const mappedWarehouse = text(item.mappedWarehouseName);
    current.warehouseLocations.add(text(item.warehouseLocation) || '未匹配');
    current.sites.add(text(item.site) || '未匹配');
    if (sourceWarehouse) locations.push(sourceWarehouse);
    else if (storeName) locations.push(`店铺：${storeName}`);
    if (receivingWarehouse && !locations.includes(receivingWarehouse)) locations.push(`收货：${receivingWarehouse}`);
    if (mappedWarehouse && !locations.includes(mappedWarehouse)) locations.push(`映射：${mappedWarehouse}`);
    current.dataSources.add(`${sourceTable}：${locations.join(' → ') || '无仓库字段'}`);
  });
  Object.entries(row.salesByMonth || {}).forEach(([month, qty]) => {
    current.salesByMonth.set(month, (current.salesByMonth.get(month) || 0) + numberValue(qty));
  });
  map.set(key, current);
  return 'included';
}

export function buildSupplyPlanSummary({ inventoryModel = {}, params: input = {}, now = new Date() } = {}) {
  const params = normalizeSupplyPlanParams(input);
  const aggregate = new Map();
  const summaryRows = Array.isArray(inventoryModel.rows) ? inventoryModel.rows : [];
  summaryRows.forEach((row) => addAggregate(aggregate, row));

  const rows = [...aggregate.values()].flatMap((row) => {
    if (!(row.onHandQty > 0 || row.inTransitQty > 0 || row.undeliveredQty > 0)) return [];
    const channelSettings = params.channels[row.channelKey];
    if (!channelSettings) return [];
    return [{
      materialCode: row.materialCode,
      sku: row.sku,
      materialName: row.materialName,
      productLine: row.productLine,
      productSeries: row.productSeries,
      model: row.model,
      salesRegion: row.salesRegion,
      channelKey: row.channelKey,
      channel: row.channel,
      businessUnit: row.businessUnit,
      warehouseLocations: [...row.warehouseLocations].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
      onHandQty: row.onHandQty,
      inTransitQty: row.inTransitQty,
      undeliveredQty: row.undeliveredQty,
      inventoryQty: row.onHandQty + row.inTransitQty,
      onHandSellableDays: channelSettings.onHandSellableDays,
      dispatchToShelfDays: channelSettings.dispatchToShelfDays,
      transportDays: channelSettings.transportDays,
      bookingDays: channelSettings.bookingDays,
      spotDays: channelSettings.spotDays,
      averageLeadTimeDays: channelSettings.averageLeadTimeDays,
      contractSigningDays: channelSettings.contractSigningDays,
      fullChainDays: channelSettings.fullChainDays,
      safetyDays: channelSettings.safetyDays
    }];
  }).sort((left, right) => (
    left.businessUnit.localeCompare(right.businessUnit, 'zh-Hans-CN')
    || left.materialCode.localeCompare(right.materialCode, 'zh-Hans-CN', { numeric: true })
  ));

  return {
    ok: true,
    rows,
    generatedAt: new Date(now).toISOString()
  };
}

export function buildBeiHuoReviewAnalysis({
  inventoryModel = {},
  forecastRows = [],
  forecastSource = {},
  params: input = {},
  now = new Date(),
  mode = 'materialCode',
  stockupMaterialCodes = [],
  sourceVersion = ''
} = {}) {
  let params;
  try {
    params = normalizeInventoryRiskParams(input);
  } catch (error) {
    return { ok: false, status: 'invalid_params', error: error.message };
  }

  const stockupSet = new Set(stockupMaterialCodes.map(materialCodeValue).filter(Boolean));
  if (stockupSet.size === 0) {
    return {
      ok: true,
      status: 'empty',
      rows: [],
      sourceVersion,
      generatedAt: new Date(now).toISOString(),
      params,
      periods: {},
      summary: {},
      stockupInfo: { hasFile: false, materialCodeCount: 0 },
      diagnostics: {
        mappingIssues: [],
        forecastIssues: [],
        forecastParsing: null
      }
    };
  }

  if (!Array.isArray(forecastRows) || forecastRows.length === 0) {
    return { ok: false, status: 'missing_data', error: '销售预测文件未上传应用，或已选工作表没有数据' };
  }

  const summaryRows = Array.isArray(inventoryModel.rows) ? inventoryModel.rows : [];
  const forecastResult = buildForecastMap(forecastRows, summaryRows, forecastSource, now);
  if (forecastResult.forecast.size === 0) {
    return {
      ok: false,
      status: 'missing_data',
      error: '销售预测没有解析出有效的事业部、物料编码和月份数据',
      diagnostics: {
        forecastIssues: forecastResult.issues,
        forecastParsing: forecastResult.parsing,
        mappingIssues: []
      }
    };
  }

  const aggregate = new Map();
  const materialToModel = new Map();
  const modelStockupMaterial = new Map();
  const materialSummaryByCode = new Map();

  summaryRows.forEach((row) => {
    const materialCode = materialCodeValue(row.materialCode);
    if (!materialCode) return;
    if (!materialSummaryByCode.has(materialCode)) materialSummaryByCode.set(materialCode, row);
    const model = text(row.model);
    if (!model || model === '未匹配') return;
    if (!materialToModel.has(materialCode)) materialToModel.set(materialCode, new Set());
    materialToModel.get(materialCode).add(model);
  });

  if (mode === 'model') {
    summaryRows.forEach((row) => {
      const materialCode = materialCodeValue(row.materialCode);
      if (!stockupSet.has(materialCode)) return;
      for (const model of materialToModel.get(materialCode) || []) {
        const list = modelStockupMaterial.get(model) || new Set();
        list.add(materialCode);
        modelStockupMaterial.set(model, list);
      }
    });

    const stockupModels = new Set(modelStockupMaterial.keys());
    const forecastByModel = new Map();

    for (const [forecastKey, forecastRow] of forecastResult.forecast.entries()) {
      const [businessUnit, materialCode] = forecastKey.split('\u001f');
      const models = materialToModel.get(materialCode);
      if (!models?.size) continue;
      for (const model of models) {
        const targetKey = businessUnitMaterialKey(businessUnit, model);
        const target = forecastByModel.get(targetKey) || { months: new Map(), hasRecord: false };
        target.hasRecord = true;
        for (const [month, qty] of forecastRow.months.entries()) {
          target.months.set(month, (target.months.get(month) || 0) + numberValue(qty));
        }
        forecastByModel.set(targetKey, target);
      }
    }

    forecastResult.modelForecast = forecastByModel;

    summaryRows.forEach((row) => {
      const normalizedModel = text(row.model);
      if (!stockupModels.has(normalizedModel)) return;
      const status = addModelAggregate(aggregate, row);
      if (status !== 'included') return;
      const current = aggregate.get(businessUnitMaterialKey(normalizedBusinessUnit(row.businessUnit), normalizedModel));
      if (current) {
        const materialList = [...(modelStockupMaterial.get(normalizedModel) || new Set())]
          .sort((left, right) => text(left).localeCompare(text(right), 'zh-Hans-CN', { numeric: true }));
        current.stockupMaterialCodes = materialList;
        const representative = materialList[0] || '';
        const referenceRow = materialSummaryByCode.get(representative);
        current.materialCode = materialList.join('+') || row.materialCode || '未匹配';
        current.sku = referenceRow?.sku || row.sku || '未匹配';
        current.materialName = referenceRow?.materialName || row.materialName || '未匹配';
        current.productLine = referenceRow?.productLine || row.productLine || '未匹配';
        current.productSeries = referenceRow?.productSeries || row.productSeries || '未匹配';
      }
    });
  } else {
    summaryRows.forEach((row) => {
      const materialCode = materialCodeValue(row.materialCode);
      if (stockupSet.has(materialCode)) addAggregate(aggregate, row);
    });
  }

  const allSalesMonths = [...new Set([...aggregate.values()].flatMap((row) => [...row.salesByMonth.keys()]))].sort();
  const historicalEndMonth = allSalesMonths.at(-1) || '';
  const historicalMonths = historicalEndMonth
    ? monthRange(monthFromIndex(monthIndex(historicalEndMonth) - params.historicalMonths + 1), params.historicalMonths)
    : [];
  const forecastStartMonth = currentChinaMonth(now);
  const forecastMonths = monthRange(forecastStartMonth, params.forecastMonths);

  const rows = [...aggregate.values()].flatMap((row) => {
    if (!(row.onHandQty > 0 || row.inTransitQty > 0 || row.undeliveredQty > 0)) return [];
    const channelSettings = params.channels[row.channelKey];
    if (!channelSettings) return [];

    const forecastRowsByMode = mode === 'model' ? (forecastResult.modelForecast || new Map()) : forecastResult.forecast;
    const forecastKey = businessUnitMaterialKey(row.businessUnit, mode === 'model' ? row.model : row.materialCode);
    const forecast = forecastRowsByMode.get(forecastKey);

    const forecastTotal = forecastMonths.reduce((sum, month) => sum + numberValue(forecast?.months?.get(month)), 0);
    const forecastMonthlyAverage = forecastTotal / params.forecastMonths;
    const historicalTotal = historicalMonths.reduce((sum, month) => sum + numberValue(row.salesByMonth.get(month)), 0);
    const historicalMonthlyAverage = historicalTotal / params.historicalMonths;
    const dailyForecast = forecastMonthlyAverage / 30;
    const dailyHistorical = historicalMonthlyAverage / 30;
    const transitTurnoverDays = dailyForecast > 0 ? (row.onHandQty + row.inTransitQty) / dailyForecast : 999;
    const fullChainCoverageDays = dailyForecast > 0
      ? (row.onHandQty + row.inTransitQty + row.undeliveredQty) / dailyForecast + channelSettings.averageLeadTimeDays
      : 999;
    const forecastSellableDays = dailyForecast > 0
      ? (row.onHandQty + row.inTransitQty + row.undeliveredQty) / dailyForecast
      : 999;
    const historicalSellableDays = dailyHistorical > 0
      ? (row.onHandQty + row.inTransitQty + row.undeliveredQty) / dailyHistorical
      : 999;

    const warehouseLocations = [...row.warehouseLocations];
    const sites = [...row.sites];
    return [{
      id: forecastKey,
      businessUnit: row.businessUnit,
      productLine: row.productLine,
      productSeries: row.productSeries,
      model: row.model,
      materialCode: mode === 'model' ? (row.materialCode || '未匹配') : row.materialCode,
      sku: row.sku || '未匹配',
      materialName: row.materialName || '未匹配',
      onHandQty: row.onHandQty,
      inTransitQty: row.inTransitQty,
      undeliveredQty: row.undeliveredQty,
      forecastMonthlyAverage,
      historicalMonthlyAverage,
      transitTurnoverDays,
      fullChainCoverageDays,
      forecastSellableDays,
      historicalSellableDays,
      channelKey: row.channelKey,
      channel: row.channel,
      warehouseLocations: warehouseLocations.length ? warehouseLocations : ['未匹配'],
      warehouseLocation: warehouseLocations.join('、') || '未匹配',
      sites: sites.length ? sites : ['未匹配'],
      site: sites.join('、') || '未匹配',
      unfulfilledSupplierShortName: [...row.unfulfilledSupplierShortNames].join('&') || '未匹配'
    }];
  }).sort((left, right) => {
    if (left.businessUnit !== right.businessUnit) {
      return left.businessUnit.localeCompare(right.businessUnit, 'zh-Hans-CN');
    }
    if (mode === 'model') {
      return text(left.model).localeCompare(text(right.model), 'zh-Hans-CN', { numeric: true });
    }
    return text(left.materialCode).localeCompare(text(right.materialCode), 'zh-Hans-CN', { numeric: true });
  });

  return {
    ok: true,
    status: 'ready',
    sourceVersion,
    generatedAt: new Date(now).toISOString(),
    params,
    periods: {
      forecastStartMonth,
      forecastEndMonth: forecastMonths.at(-1) || '',
      forecastMonths,
      historicalStartMonth: historicalMonths[0] || '',
      historicalEndMonth,
      historicalMonths
    },
    summary: {},
    rows,
    stockupInfo: {
      hasFile: true,
      materialCodeCount: stockupSet.size
    },
    diagnostics: {
      mappingIssues: [],
      forecastIssues: forecastResult.issues,
      forecastParsing: forecastResult.parsing
    }
  };
}

function actionFor(transitDays, chainDays, settings) {
  if (chainDays > settings.stopThresholdDays) return '停止采购';
  if (transitDays > settings.restrictThresholdDays) return '限制采购';
  return '正常';
}

export function buildInventoryRiskAnalysis({ inventoryModel = {}, forecastRows = [], forecastSource = {}, params: input = {}, now = new Date(), sourceVersion = '' } = {}) {
  let params;
  try {
    params = normalizeInventoryRiskParams(input);
  } catch (error) {
    return { ok: false, status: 'invalid_params', error: error.message };
  }
  if (!Array.isArray(forecastRows) || forecastRows.length === 0) {
    return { ok: false, status: 'missing_data', error: '销售预测文件未上传应用，或已选工作表没有数据' };
  }

  const summaryRows = Array.isArray(inventoryModel.rows) ? inventoryModel.rows : [];
  const forecastResult = buildForecastMap(forecastRows, summaryRows, forecastSource, now);
  if (forecastResult.forecast.size === 0) {
    return {
      ok: false,
      status: 'missing_data',
      error: '销售预测没有解析出有效的事业部、物料编码和月份数据',
      diagnostics: {
        forecastIssues: forecastResult.issues,
        forecastParsing: forecastResult.parsing
      }
    };
  }

  const aggregate = new Map();
  const channelStats = { includedCount: 0, b2bExcludedCount: 0, channelMissingCount: 0 };
  summaryRows.forEach((row) => {
    const status = addAggregate(aggregate, row);
    if (status === 'included') channelStats.includedCount += 1;
    else if (status === 'b2b') channelStats.b2bExcludedCount += 1;
    else if (status === 'missing') channelStats.channelMissingCount += 1;
  });
  const allSalesMonths = [...new Set([...aggregate.values()].flatMap((row) => [...row.salesByMonth.keys()]))].sort();
  const historicalEndMonth = allSalesMonths.at(-1) || '';
  const historicalMonths = historicalEndMonth
    ? monthRange(monthFromIndex(monthIndex(historicalEndMonth) - params.historicalMonths + 1), params.historicalMonths)
    : [];
  const forecastStartMonth = currentChinaMonth(now);
  const forecastMonths = monthRange(forecastStartMonth, params.forecastMonths);
  const restricted = [];
  const stopped = [];
  const normal = [];

  for (const [key, row] of aggregate) {
    if (!(row.onHandQty > 0 || row.inTransitQty > 0 || row.undeliveredQty > 0)) continue;
    const forecast = forecastResult.forecast.get(key);
    const availableForecastMonths = forecastMonths.filter((month) => forecast?.months.has(month));
    const forecastTotal = forecastMonths.reduce((sum, month) => sum + numberValue(forecast?.months.get(month)), 0);
    const forecastMonthlyAverage = forecastTotal / params.forecastMonths;
    const historicalTotal = historicalMonths.reduce((sum, month) => sum + numberValue(row.salesByMonth.get(month)), 0);
    const historicalMonthlyAverage = historicalTotal / params.historicalMonths;
    const forecastStatus = !forecast?.hasRecord || availableForecastMonths.length === 0
      ? '无销售预测'
      : forecastTotal > 0 ? '已匹配' : '销售预测为0';
    const forecastAvailability = !forecast?.hasRecord || availableForecastMonths.length === 0
      ? '无预测销售'
      : '有预测销售';
    const dailyForecast = forecastMonthlyAverage / 30;
    const transitTurnoverDays = dailyForecast > 0
      ? (row.onHandQty + row.inTransitQty) / dailyForecast
      : 999;
    const channelSettings = params.channels[row.channelKey];
    const fullChainCoverageDays = dailyForecast > 0
      ? (row.onHandQty + row.inTransitQty + row.undeliveredQty) / dailyForecast + channelSettings.averageLeadTimeDays
      : 999;
    const action = actionFor(transitTurnoverDays, fullChainCoverageDays, channelSettings);
    const warehouseLocations = [...row.warehouseLocations];
    const sites = [...row.sites];
    const resultRow = {
      id: key,
      materialCode: row.materialCode,
      sku: row.sku,
      materialName: row.materialName,
      productLine: row.productLine,
      productSeries: row.productSeries,
      model: row.model,
      inventorySegment: row.inventorySegment,
      salesRegion: row.salesRegion,
      channelKey: row.channelKey,
      channel: row.channel,
      businessUnit: row.businessUnit,
      businessUnits: row.businessUnit,
      warehouseLocations: warehouseLocations.length ? warehouseLocations : ['未匹配'],
      warehouseLocation: warehouseLocations.join('、') || '未匹配',
      sites: sites.length ? sites : ['未匹配'],
      site: sites.join('、') || '未匹配',
      dataSource: [...row.dataSources].join('；') || '无仓库数据',
      onHandQty: row.onHandQty,
      inTransitQty: row.inTransitQty,
      inventoryQty: row.onHandQty + row.inTransitQty,
      undeliveredQty: row.undeliveredQty,
      unfulfilledSupplierShortName: [...row.unfulfilledSupplierShortNames].join('&') || '未匹配',
      totalInventoryQty: row.onHandQty + row.inTransitQty + row.undeliveredQty,
      forecastMonthlyAverage,
      historicalMonthlyAverage,
      transitTurnoverDays,
      fullChainCoverageDays,
      onHandSellableDays: channelSettings.onHandSellableDays,
      dispatchToShelfDays: channelSettings.dispatchToShelfDays,
      transportDays: channelSettings.transportDays,
      bookingDays: channelSettings.bookingDays,
      spotDays: channelSettings.spotDays,
      averageLeadTimeDays: channelSettings.averageLeadTimeDays,
      contractSigningDays: channelSettings.contractSigningDays,
      fullChainDays: channelSettings.fullChainDays,
      restrictThresholdDays: channelSettings.restrictThresholdDays,
      stopThresholdDays: channelSettings.stopThresholdDays,
      forecastStatus,
      forecastAvailability,
      action
    };
    if (action === '停止采购') stopped.push(resultRow);
    else if (action === '限制采购') restricted.push(resultRow);
    else normal.push(resultRow);
  }

  const sorter = (left, right) => right.fullChainCoverageDays - left.fullChainCoverageDays
    || right.transitTurnoverDays - left.transitTurnoverDays
    || left.businessUnit.localeCompare(right.businessUnit, 'zh-Hans-CN')
    || left.materialCode.localeCompare(right.materialCode, 'zh-Hans-CN', { numeric: true });
  restricted.sort(sorter);
  stopped.sort(sorter);
  normal.sort(sorter);
  const rows = [...stopped, ...restricted, ...normal];
  const mappingIssues = (inventoryModel.anomalies || [])
    .filter((row) => RISK_SOURCE_TYPES.has(row.sourceType) && Math.abs(numberValue(row.qty)) > 0)
    .map((row) => ({
      id: row.id,
      sourceType: row.sourceType,
      materialCode: row.materialCode || '未匹配',
      sku: row.sku || '未匹配',
      businessUnit: row.businessUnit || '未匹配',
      qty: numberValue(row.qty),
      issue: row.issue
    }));

  return {
    ok: true,
    status: 'ready',
    sourceVersion,
    generatedAt: new Date().toISOString(),
    params,
    periods: {
      forecastStartMonth,
      forecastEndMonth: forecastMonths.at(-1) || '',
      forecastMonths,
      historicalStartMonth: historicalMonths[0] || '',
      historicalEndMonth,
      historicalMonths
    },
    summary: {
      restrictedCount: restricted.length,
      stoppedCount: stopped.length,
      normalCount: normal.length,
      ...channelStats,
      mappingIssueCount: mappingIssues.length,
      mappingIssueQty: mappingIssues.reduce((sum, row) => sum + Math.abs(row.qty), 0),
      forecastIssueCount: forecastResult.issues.length
    },
    restricted,
    stopped,
    normal,
    rows,
    diagnostics: {
      mappingIssues,
      forecastIssues: forecastResult.issues,
      forecastParsing: forecastResult.parsing
    }
  };
}

export function inventoryRiskCacheKey(sourceVersion, input = {}, now = new Date()) {
  return [
    'inventory-risk-v7',
    currentChinaMonth(now),
    sourceVersion,
    JSON.stringify(normalizeInventoryRiskParams(input))
  ].join('|');
}
