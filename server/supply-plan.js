const HORIZON_MONTH_OPTIONS = new Set([6, 9, 12, 15, 18, 21, 24]);
const DAY_MS = 24 * 60 * 60 * 1000;

function text(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

function numberValue(value) {
  const parsed = Number.parseFloat(text(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function materialCodeValue(value) {
  return text(value).replace(/\.0$/, '');
}

function businessUnitMaterialKey(businessUnit, materialCode) {
  return `${text(businessUnit)}\u001f${materialCodeValue(materialCode)}`;
}

function modelKeyValue(productLine, productSeries, model, fallback) {
  return [productLine, productSeries, model || `__${fallback}`].map(text).join('\u001f');
}

function utcDate(value = new Date()) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoWeekParts(value) {
  const date = utcDate(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((date - yearStart) / DAY_MS) + 1) / 7);
  return { year: isoYear, week };
}

function isoWeekMonday(value) {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() || 7) - 1));
  return date;
}

function dateLabel(date) {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function forecastValue(row, index) {
  return numberValue(row?.[`forecastM${index}`] ?? row?.[`month${index}`]);
}

function sourceRows(source, slotId) {
  const value = source?.[slotId];
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.rows) ? value.rows : [];
}

function integerAllocations(total, dayCounts) {
  const roundedTotal = Math.max(0, Math.round(numberValue(total)));
  if (!roundedTotal || !dayCounts.length) return dayCounts.map(() => 0);
  const totalDays = dayCounts.reduce((sum, days) => sum + days, 0);
  const shares = dayCounts.map((days, index) => {
    const exact = roundedTotal * days / totalDays;
    return { index, value: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remainder = roundedTotal - shares.reduce((sum, item) => sum + item.value, 0);
  [...shares].sort((left, right) => right.fraction - left.fraction || left.index - right.index)
    .forEach((item) => {
      if (remainder <= 0) return;
      shares[item.index].value += 1;
      remainder -= 1;
    });
  return shares.map((item) => item.value);
}

export function normalizeHorizonMonths(value) {
  const months = Number(value);
  return HORIZON_MONTH_OPTIONS.has(months) ? months : 6;
}

export function buildSupplyPlanWeeks(months = 6, now = new Date()) {
  const horizonMonths = normalizeHorizonMonths(months);
  const start = isoWeekMonday(now);
  const current = utcDate(now);
  const end = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + horizonMonths, current.getUTCDate()));
  const weeks = [];
  for (let monday = start; monday < end; monday = new Date(monday.getTime() + 7 * DAY_MS)) {
    const sunday = new Date(monday.getTime() + 6 * DAY_MS);
    const { year, week } = isoWeekParts(monday);
    weeks.push({
      key: `${year}-W${String(week).padStart(2, '0')}`,
      label: `W${week}`,
      year,
      week,
      dateRange: `${dateLabel(monday)}-${dateLabel(sunday)}`,
      startDate: monday.toISOString().slice(0, 10),
      endDate: sunday.toISOString().slice(0, 10)
    });
  }
  return weeks;
}

export function splitForecastToWeeks(forecastRows = [], now = new Date()) {
  const result = [];
  const current = utcDate(now);
  forecastRows.forEach((row) => {
    const businessUnit = text(row?.businessUnit);
    const materialCode = materialCodeValue(row?.materialCode);
    const sku = text(row?.sku);
    const skuName = text(row?.skuName || row?.materialName);
    if (!businessUnit || !materialCode) return;
    for (let index = 1; index <= 6; index += 1) {
      const monthValue = forecastValue(row, index);
      if (!monthValue) continue;
      const monthStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + index - 1, 1));
      const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
      const byWeek = new Map();
      for (let day = 1; day <= monthEnd.getUTCDate(); day += 1) {
        const date = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day));
        const { year, week } = isoWeekParts(date);
        const key = `${year}-W${String(week).padStart(2, '0')}`;
        const currentWeek = byWeek.get(key) || { key, year, week, days: 0 };
        currentWeek.days += 1;
        byWeek.set(key, currentWeek);
      }
      const monthWeeks = [...byWeek.values()];
      const allocations = integerAllocations(monthValue, monthWeeks.map((item) => item.days));
      monthWeeks.forEach((item, weekIndex) => {
        const forecastQty = allocations[weekIndex];
        if (!forecastQty) return;
        result.push({ businessUnit, materialCode, sku, skuName, year: item.year, week: item.week, weekKey: item.key, forecastQty });
      });
    }
  });
  return result;
}

export function supplyPlanChannel(siteValue = '') {
  const site = text(siteValue).toUpperCase();
  if (/美国|加拿大|CANADA|\bUS\b|\bCA\b/.test(site)) return { key: 'overseasUs', label: '海外-美国' };
  if (/欧洲|\bUK\b|\bDE\b|\bFR\b|\bIT\b|\bES\b|\bPL\b/.test(site)) return { key: 'overseasEurope', label: '海外-欧洲' };
  return { key: 'domestic', label: '国内' };
}

export function supplyPlanModelKey(row = {}) {
  return text(row.modelKey) || modelKeyValue(
    row.productLine || '未匹配产品线',
    row.productSeries || '未匹配系列',
    row.model === '未匹配型号' ? '' : row.model,
    row.sku || row.materialCode || '未匹配型号'
  );
}

const SUPPLY_PLAN_ACTIONS = {
  正常流转: { color: '#4caf50', severity: 0 },
  停采观察: { color: '#9e9e9e', severity: 1 },
  调整计划: { color: '#ff9800', severity: 2 },
  加急补货: { color: '#f44336', severity: 3 }
};

function roundedMetric(value) {
  return Math.round((numberValue(value) + Number.EPSILON) * 100) / 100;
}

function weekForecastQuantity(item, index) {
  return numberValue(item.weekForecasts?.[index]?.forecastQty ?? item.weeklyForecast?.[index]);
}

export function getActionConclusion(item = {}) {
  const currentWeekForecast = weekForecastQuantity(item, 0);
  const fourWeekForecast = Array.from({ length: 4 }, (_, index) => weekForecastQuantity(item, index));
  const forecastDaily = currentWeekForecast > 0
    ? currentWeekForecast / 7
    : fourWeekForecast.reduce((sum, value) => sum + value, 0) / 28;
  const stockCoverDays = forecastDaily > 0 ? numberValue(item.onHandQty) / forecastDaily : 999;
  const inventoryRemaining = numberValue(item.inTransitQty) + numberValue(item.onHandQty) - currentWeekForecast;
  const rawDaysUntilShortage = Math.max(0, numberValue(item.totalLeadTimeDays) - stockCoverDays);
  const daysUntilShortage = inventoryRemaining < 0 ? 0 : rawDaysUntilShortage;
  const suggestedPurchase = numberValue(item.suggestedPurchase ?? item.purchaseGap);
  const safetyStock = numberValue(item.safetyStock ?? item.safetyStockQty);
  const hasNoForecast4Weeks = fourWeekForecast.every((value) => value === 0);
  let conclusion = '正常流转';

  if (suggestedPurchase <= 0 && numberValue(item.onHandQty) > safetyStock * 2 && hasNoForecast4Weeks) {
    conclusion = '停采观察';
  } else if (inventoryRemaining < 0 || (suggestedPurchase > 0 && daysUntilShortage <= 14)) {
    conclusion = '加急补货';
  } else if (suggestedPurchase > 0 && daysUntilShortage <= 45) {
    conclusion = '调整计划';
  }

  return {
    forecastDaily: roundedMetric(forecastDaily),
    stockCoverDays: roundedMetric(stockCoverDays),
    daysUntilShortage: roundedMetric(daysUntilShortage),
    conclusion,
    color: SUPPLY_PLAN_ACTIONS[conclusion].color
  };
}

export function aggregateSupplyPlanAction(rows = []) {
  return rows.reduce((current, row) => {
    const action = SUPPLY_PLAN_ACTIONS[row.actionConclusion] || SUPPLY_PLAN_ACTIONS.正常流转;
    return action.severity > current.severity
      ? { conclusion: row.actionConclusion, color: row.actionColor || action.color, severity: action.severity }
      : current;
  }, { conclusion: '正常流转', color: SUPPLY_PLAN_ACTIONS.正常流转.color, severity: 0 });
}

function withSupplyPlanCalculations(row) {
  const weeklyForecast = Array.isArray(row.weeklyForecast) ? row.weeklyForecast.map(numberValue) : [];
  const forecastTotal = weeklyForecast.reduce((sum, value) => sum + value, 0);
  const dailyForecast = Math.round(numberValue(row.forecastDailyQty));
  const safetyStockQty = dailyForecast * numberValue(row.safetyDays);
  const currentWeekForecast = numberValue(weeklyForecast[0]);
  const calculated = {
    ...row,
    weeklyForecast,
    forecastTotal,
    dailyForecast,
    safetyStockQty,
    inventoryRemainingQty: numberValue(row.inTransitQty) + numberValue(row.onHandQty) - currentWeekForecast,
    purchaseGap: Math.max(
      0,
      safetyStockQty + currentWeekForecast
        - numberValue(row.onHandQty)
        - numberValue(row.inTransitQty)
        - numberValue(row.undeliveredQty)
    )
  };
  const action = getActionConclusion(calculated);
  return {
    ...calculated,
    forecastDaily: action.forecastDaily,
    stockCoverDays: action.stockCoverDays,
    daysUntilShortage: action.daysUntilShortage,
    actionConclusion: action.conclusion,
    actionColor: action.color
  };
}

export function buildSupplyPlanData({
  inventorySummaryData = {},
  dimensionData = {},
  supplyPlanSettings = {},
  months = 6,
  now = new Date()
} = {}) {
  const inventoryRows = sourceRows(inventorySummaryData, 'inventorySummaryFile18');
  const undeliveredRows = sourceRows(inventorySummaryData, 'inventorySummaryFile19');
  const forecastRows = sourceRows(inventorySummaryData, 'inventorySummaryFile21');
  const weeks = buildSupplyPlanWeeks(months, now);
  const weekKeys = new Set(weeks.map((week) => week.key));
  const grouped = new Map();
  const ensureItem = (row) => {
    const businessUnit = text(row?.businessUnit);
    const materialCode = materialCodeValue(row?.materialCode);
    if (!businessUnit || !materialCode) return null;
    const key = businessUnitMaterialKey(businessUnit, materialCode);
    if (!grouped.has(key)) {
      grouped.set(key, {
        businessUnit,
        materialCode,
        warehouses: new Set(),
        onHandQty: 0,
        inTransitQty: 0,
        undeliveredQty: 0,
        operator: '',
        sku: '',
        skuName: ''
      });
    }
    return grouped.get(key);
  };

  inventoryRows.forEach((row) => {
    const item = ensureItem(row);
    if (!item) return;
    if (text(row.warehouseName)) item.warehouses.add(text(row.warehouseName));
    item.onHandQty += numberValue(row.onHandQty);
    item.inTransitQty += numberValue(row.inTransitQty);
    item.sku ||= text(row.sku);
    item.skuName ||= text(row.skuName || row.materialName);
  });
  undeliveredRows.forEach((row) => {
    const item = ensureItem(row);
    if (!item) return;
    item.undeliveredQty += numberValue(row.undeliveredQty);
    item.operator ||= text(row.operator);
    item.sku ||= text(row.sku);
    item.skuName ||= text(row.skuName || row.materialName);
  });
  forecastRows.forEach((row) => {
    const item = ensureItem(row);
    if (!item) return;
    item.sku ||= text(row.sku);
    item.skuName ||= text(row.skuName || row.materialName);
  });

  const productMap = new Map((dimensionData.productCategory || [])
    .map((row) => [materialCodeValue(row.materialCode), row])
    .filter(([key]) => key));
  const feedbackMap = new Map((dimensionData.businessUnitFeedback || [])
    .map((row) => [businessUnitMaterialKey(row.businessUnit, row.materialCode), row])
    .filter(([key]) => !key.startsWith('\u001f')));
  const warehouseMap = new Map((dimensionData.warehouseName || [])
    .map((row) => [text(row.warehouseName), row])
    .filter(([key]) => key));

  const weeklyByItem = new Map();
  splitForecastToWeeks(forecastRows, now).forEach((row) => {
    if (!weekKeys.has(row.weekKey)) return;
    const key = businessUnitMaterialKey(row.businessUnit, row.materialCode);
    const current = weeklyByItem.get(key) || new Map();
    current.set(row.weekKey, (current.get(row.weekKey) || 0) + numberValue(row.forecastQty));
    weeklyByItem.set(key, current);
  });
  const forecastDailyByItem = new Map();
  forecastRows.forEach((row) => {
    const key = businessUnitMaterialKey(row.businessUnit, row.materialCode);
    if (!grouped.has(key)) return;
    let total = 0;
    let days = 0;
    for (let index = 1; index <= 6; index += 1) {
      const monthStart = new Date(Date.UTC(utcDate(now).getUTCFullYear(), utcDate(now).getUTCMonth() + index - 1, 1));
      total += forecastValue(row, index);
      days += new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
    }
    const current = forecastDailyByItem.get(key) || { total: 0, days: 0 };
    current.total += total;
    current.days = Math.max(current.days, days);
    forecastDailyByItem.set(key, current);
  });

  const rows = [...grouped.entries()].map(([key, item]) => {
    const product = productMap.get(item.materialCode) || {};
    const feedback = feedbackMap.get(key) || {};
    const warehouses = [...item.warehouses];
    const warehouse = warehouseMap.get(warehouses[0]) || {};
    const warehouseSite = text(warehouse.marketplace || warehouse.salesChannel);
    const channel = supplyPlanChannel([warehouseSite, ...warehouses].filter(Boolean).join(' '));
    const channelSettings = supplyPlanSettings?.channels?.[channel.key] || {};
    const forecastDaily = forecastDailyByItem.get(key) || { total: 0, days: 0 };
    const weekly = weeklyByItem.get(key) || new Map();
    const weeklyForecast = weeks.map((week) => numberValue(weekly.get(week.key)));
    const productLine = text(product.productLine) || '未匹配产品线';
    const productSeries = text(product.productSeries) || '未匹配系列';
    const model = text(product.model);
    const modelKey = modelKeyValue(productLine, productSeries, model, item.sku || item.materialCode);
    return withSupplyPlanCalculations({
      businessUnit: item.businessUnit,
      materialCode: item.materialCode,
      sku: item.sku || text(product.sku),
      skuName: item.skuName || text(product.materialName),
      materialName: item.skuName || text(product.materialName),
      productLine,
      productSeries,
      model: model || '未匹配型号',
      modelKey,
      modelId: modelKey,
      salesRegion: text(product.salesRegion),
      pretaxPrice: numberValue(product.pretaxPrice),
      productLifecycle: text(feedback.productLifecycle || feedback.unifiedStage),
      productPositioning: text(feedback.productPositioning || feedback.unifiedPositioning),
      warehouseCategory: text(warehouse.level1WarehouseCategory),
      warehouseSite,
      warehouses,
      channelKey: channel.key,
      channel: channel.label,
      onHandQty: item.onHandQty,
      inTransitQty: item.inTransitQty,
      undeliveredQty: item.undeliveredQty,
      operator: item.operator,
      safetyDays: numberValue(channelSettings.safetyDays ?? channelSettings.fullChainDays),
      totalLeadTimeDays: numberValue(channelSettings.fullChainDays),
      forecastDailyQty: forecastDaily.days ? forecastDaily.total / forecastDaily.days : 0,
      weekForecasts: weeks.map((week, index) => ({ ...week, forecastQty: weeklyForecast[index] })),
      weeklyForecast
    });
  }).sort((left, right) => (
    left.productLine.localeCompare(right.productLine, 'zh-CN')
    || left.productSeries.localeCompare(right.productSeries, 'zh-CN')
    || left.model.localeCompare(right.model, 'zh-CN', { numeric: true })
    || left.businessUnit.localeCompare(right.businessUnit, 'zh-CN')
    || left.materialCode.localeCompare(right.materialCode, 'zh-CN', { numeric: true })
  ));

  return {
    ok: true,
    horizonMonths: normalizeHorizonMonths(months),
    weeks,
    rows,
    generatedAt: new Date(now).toISOString(),
    sourceSummary: {
      inventoryRows: inventoryRows.length,
      undeliveredRows: undeliveredRows.length,
      forecastRows: forecastRows.length
    }
  };
}

const MODEL_SUM_FIELDS = [
  'onHandQty',
  'inTransitQty',
  'undeliveredQty',
  'forecastTotal',
  'dailyForecast',
  'safetyStockQty',
  'inventoryRemainingQty',
  'purchaseGap'
];

const FILTER_FIELDS = ['businessUnit', 'productLine', 'productSeries', 'actionConclusion'];
const ACTION_CONCLUSION_ORDER = ['正常流转', '加急补货', '调整计划', '停采观察'];

function matchesFilters(row, filters = {}, omittedField = '') {
  return FILTER_FIELDS.every((field) => (
    field === omittedField || !text(filters[field]) || text(row[field]) === text(filters[field])
  ));
}

function filterOptions(rows, filters) {
  return Object.fromEntries(FILTER_FIELDS.map((field) => [field, field === 'actionConclusion'
    ? ACTION_CONCLUSION_ORDER
    : [...new Set(rows
    .filter((row) => matchesFilters(row, filters, field))
    .map((row) => text(row[field]))
    .filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN'))]));
}

export function groupSupplyPlanModels(rows = [], weekCount = 0) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = supplyPlanModelKey(row);
    const group = groups.get(key) || {
      modelKey: key,
      modelId: key,
      productLine: row.productLine,
      productSeries: row.productSeries,
      model: row.model,
      businessUnit: '全量汇总',
      materialCode: '',
      sku: '',
      skuName: '按型号汇总',
      childCount: 0,
      weeklyForecast: Array.from({ length: weekCount }, () => 0)
    };
    MODEL_SUM_FIELDS.forEach((field) => {
      group[field] = numberValue(group[field]) + numberValue(row[field]);
    });
    group.weeklyForecast = group.weeklyForecast.map((value, index) => (
      value + numberValue(row.weeklyForecast?.[index])
    ));
    group.childCount += 1;
    const action = aggregateSupplyPlanAction([group, row]);
    group.actionConclusion = action.conclusion;
    group.actionColor = action.color;
    groups.set(key, group);
  });
  return [...groups.values()].sort((left, right) => (
    left.productLine.localeCompare(right.productLine, 'zh-CN')
    || left.productSeries.localeCompare(right.productSeries, 'zh-CN')
    || left.model.localeCompare(right.model, 'zh-CN', { numeric: true })
  ));
}

export function paginateSupplyPlanData(payload, {
  page = 1,
  pageSize = 100,
  filters = {}
} = {}) {
  const normalizedPageSize = Math.min(100, Math.max(1, Math.trunc(numberValue(pageSize)) || 100));
  const filteredRows = payload.rows.filter((row) => matchesFilters(row, filters));
  const models = groupSupplyPlanModels(filteredRows, payload.weeks.length);
  const totalItems = models.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
  const normalizedPage = Math.min(totalPages, Math.max(1, Math.trunc(numberValue(page)) || 1));
  const start = (normalizedPage - 1) * normalizedPageSize;
  return {
    ...payload,
    rows: models.slice(start, start + normalizedPageSize),
    filterOptions: filterOptions(payload.rows, filters),
    pagination: {
      page: normalizedPage,
      pageSize: normalizedPageSize,
      totalItems,
      totalPages,
      totalChildItems: filteredRows.length
    }
  };
}

export function supplyPlanModelDetail(payload, {
  modelKey = '',
  model = '',
  filters = {}
} = {}) {
  let resolvedKey = text(modelKey);
  if (!resolvedKey && text(model)) {
    const keys = [...new Set(payload.rows
      .filter((row) => text(row.model) === text(model))
      .map(supplyPlanModelKey))];
    if (keys.length > 1) throw new Error('存在跨产品线或系列的同名型号，请使用 modelKey 查询');
    resolvedKey = keys[0] || '';
  }
  if (!resolvedKey) throw new Error('型号参数不能为空');
  const rows = payload.rows.filter((row) => (
    supplyPlanModelKey(row) === resolvedKey && matchesFilters(row, filters)
  ));
  if (!rows.length) throw new Error('未找到对应型号的供应计划明细');
  return {
    ok: true,
    modelKey: resolvedKey,
    horizonMonths: payload.horizonMonths,
    weeks: payload.weeks,
    rows
  };
}

const BEIHUO_PUSH_ACTIONS = {
  urgent: { conclusion: '加急补货', targetPool: '紧急补货' },
  normal: { conclusion: '调整计划', targetPool: '常规补货' },
  pause: { conclusion: '停采观察', targetPool: '暂停采购' }
};

export function prepareSupplyPlanBeihuoPush(payload = {}, { modelIds = [], actionType = '' } = {}) {
  const action = BEIHUO_PUSH_ACTIONS[text(actionType)];
  if (!action) throw new Error('actionType 必须是 urgent、normal 或 pause');
  if (!Array.isArray(modelIds) || !modelIds.length) throw new Error('请至少选择一个型号');
  const selectedIds = new Set(modelIds.map(text).filter(Boolean));
  const selectedRows = (payload.rows || []).filter((row) => selectedIds.has(text(row.modelId || supplyPlanModelKey(row))));
  if (!selectedRows.length) throw new Error('未找到选中的型号');
  const items = selectedRows.filter((row) => row.actionConclusion === action.conclusion).map((row) => ({
    modelId: row.modelId || supplyPlanModelKey(row),
    model: row.model,
    businessUnit: row.businessUnit,
    materialCode: row.materialCode,
    sku: row.sku,
    actionConclusion: row.actionConclusion,
    suggestedPurchaseQty: numberValue(row.purchaseGap)
  }));
  if (!items.length) throw new Error(`所选型号没有“${action.conclusion}”明细`);
  const models = new Map();
  items.forEach((item) => {
    const current = models.get(item.modelId) || {
      modelId: item.modelId,
      model: item.model,
      suggestedPurchaseQty: 0,
      itemCount: 0
    };
    current.suggestedPurchaseQty += item.suggestedPurchaseQty;
    current.itemCount += 1;
    models.set(item.modelId, current);
  });
  return {
    ok: true,
    status: 'reserved',
    connected: false,
    pushed: false,
    actionType,
    actionConclusion: action.conclusion,
    targetPool: action.targetPool,
    models: [...models.values()],
    items,
    message: '备货计划接口已预留，当前仅生成待推送数据，尚未写入外部系统。'
  };
}
