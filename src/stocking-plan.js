import { buildSupplyPlanWeeks } from './supply-plan.js';
import { normalizeSupplyPlanBusinessUnit } from '../shared/supply-plan-business-unit.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const STOCKING_PLAN_MONTH_FIELDS = Object.freeze(
  Array.from({ length: 6 }, (_, index) => `month${index + 1}`)
);

function text(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

function numberValue(value) {
  const parsed = Number.parseFloat(text(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function materialCodeValue(value) {
  const normalized = text(value).replace(/\.0$/, '');
  return ['/', '-', '--', 'N/A', 'NA'].includes(normalized.toUpperCase()) ? '' : normalized;
}

function rowKey(businessUnit, materialCode) {
  return `${normalizeSupplyPlanBusinessUnit(businessUnit)}\u001f${materialCodeValue(materialCode)}`;
}

function isoWeekKey(date) {
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() || 7) - 1));
  const thursday = new Date(monday);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((thursday - yearStart) / DAY_MS) + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
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

export function splitStockingPlanMonthsToWeeks(monthValues = [], now = new Date()) {
  const current = new Date(now);
  const totalsByWeek = new Map();
  STOCKING_PLAN_MONTH_FIELDS.forEach((_field, index) => {
    const total = numberValue(monthValues[index]);
    if (!total) return;
    const monthStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + index, 1));
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
    const dayCounts = new Map();
    for (let day = 1; day <= monthEnd.getUTCDate(); day += 1) {
      const key = isoWeekKey(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day)));
      dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
    }
    const entries = [...dayCounts.entries()];
    const allocations = integerAllocations(total, entries.map(([, days]) => days));
    entries.forEach(([key], weekIndex) => {
      totalsByWeek.set(key, (totalsByWeek.get(key) || 0) + allocations[weekIndex]);
    });
  });
  return totalsByWeek;
}

export function buildStockingPlanRows({
  inventoryRows = [],
  undeliveredRows = [],
  forecastRows = [],
  productRows = []
} = {}, now = new Date()) {
  const weeks = buildSupplyPlanWeeks(6, now);
  const rowsByKey = new Map();
  const ensureRow = (source) => {
    const businessUnit = normalizeSupplyPlanBusinessUnit(source?.businessUnit);
    const materialCode = materialCodeValue(source?.materialCode);
    if (!businessUnit || !materialCode) return null;
    const key = rowKey(businessUnit, materialCode);
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        rowKey: key,
        businessUnit,
        materialCode,
        sku: '',
        productName: '',
        productLine: '',
        productSeries: '',
        model: '',
        monthForecasts: Array.from({ length: 6 }, () => 0),
        onHandQty: 0,
        inTransitQty: 0,
        undeliveredQty: 0
      });
    }
    return rowsByKey.get(key);
  };

  inventoryRows.forEach((source) => {
    const row = ensureRow(source);
    if (!row) return;
    row.onHandQty += numberValue(source.onHandQty);
    row.inTransitQty += numberValue(source.inTransitQty);
    row.sku ||= text(source.sku);
    row.productName ||= text(source.skuName || source.materialName);
  });
  undeliveredRows.forEach((source) => {
    const row = ensureRow(source);
    if (!row) return;
    row.undeliveredQty += numberValue(source.undeliveredQty);
    row.sku ||= text(source.sku);
    row.productName ||= text(source.skuName || source.materialName);
  });
  forecastRows.forEach((source) => {
    const row = ensureRow(source);
    if (!row) return;
    STOCKING_PLAN_MONTH_FIELDS.forEach((field, index) => {
      row.monthForecasts[index] += numberValue(source[field]);
    });
    row.sku ||= text(source.sku);
    row.productName ||= text(source.skuName || source.materialName);
  });

  const productMap = new Map();
  productRows.forEach((product) => {
    const materialCode = materialCodeValue(product.materialCode);
    if (materialCode && !productMap.has(materialCode)) productMap.set(materialCode, product);
  });

  const rows = [...rowsByKey.values()].map((row) => {
    const product = productMap.get(row.materialCode) || {};
    const weeklyByKey = splitStockingPlanMonthsToWeeks(row.monthForecasts, now);
    return {
      ...row,
      sku: text(product.sku) || row.sku,
      productName: text(product.materialName || product.skuName) || row.productName,
      productLine: text(product.productLine),
      productSeries: text(product.productSeries),
      model: text(product.model),
      forecastTotal: row.monthForecasts.reduce((sum, value) => sum + numberValue(value), 0),
      weeklyForecast: weeks.map((week) => numberValue(weeklyByKey.get(week.key)))
    };
  });

  return {
    weeks,
    rows: rows.sort((left, right) => (
      left.materialCode.localeCompare(right.materialCode, 'zh-CN', { numeric: true })
      || left.businessUnit.localeCompare(right.businessUnit, 'zh-CN')
    ))
  };
}

export function groupStockingPlanRowsByMaterial(rows = []) {
  const groups = new Map();
  rows.forEach((row) => {
    const groupKey = `${row.model || ''}\u001f${row.materialCode}`;
    const list = groups.get(groupKey) || [];
    list.push(row);
    groups.set(groupKey, list);
  });
  return [...groups.entries()].map(([groupKey, children]) => {
    const first = children[0];
    const monthForecasts = STOCKING_PLAN_MONTH_FIELDS.map((_field, index) => (
      children.reduce((sum, row) => sum + numberValue(row.monthForecasts[index]), 0)
    ));
    const weeklyForecast = (first.weeklyForecast || []).map((_value, index) => (
      children.reduce((sum, row) => sum + numberValue(row.weeklyForecast[index]), 0)
    ));
    const onHandQty = children.reduce((sum, row) => sum + numberValue(row.onHandQty), 0);
    const inTransitQty = children.reduce((sum, row) => sum + numberValue(row.inTransitQty), 0);
    const undeliveredQty = children.reduce((sum, row) => sum + numberValue(row.undeliveredQty), 0);
    const forecastTotal = monthForecasts.reduce((sum, value) => sum + value, 0);
    const firstValue = (field) => children.find((row) => text(row[field]))?.[field] || '';
    return {
      key: groupKey,
      materialCode: first.materialCode,
      model: firstValue('model'),
      parent: {
        rowKey: `parent\u001f${groupKey}`,
        businessUnit: '全部',
        productLine: firstValue('productLine'),
        productSeries: firstValue('productSeries'),
        model: firstValue('model'),
        materialCode: first.materialCode,
        sku: firstValue('sku'),
        productName: firstValue('productName'),
        monthForecasts,
        weeklyForecast,
        onHandQty,
        inTransitQty,
        undeliveredQty,
        suggestedPurchaseQty: Math.max(0, forecastTotal - onHandQty - inTransitQty - undeliveredQty)
      },
      children
    };
  }).sort((left, right) => (
    left.model.localeCompare(right.model, 'zh-CN', { numeric: true })
    || left.materialCode.localeCompare(right.materialCode, 'zh-CN', { numeric: true })
  ));
}
