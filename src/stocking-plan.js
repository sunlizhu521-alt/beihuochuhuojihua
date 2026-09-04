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
  return text(value).replace(/\.0$/, '');
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
        undeliveredQty: 0,
        finishedQty: 0
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
    row.finishedQty += numberValue(source.finishedQty);
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

  const totalsByMaterial = new Map();
  rows.forEach((row) => {
    const totals = totalsByMaterial.get(row.materialCode) || { forecastQty: 0, stockQty: 0 };
    totals.forecastQty += row.forecastTotal;
    totals.stockQty += row.onHandQty + row.inTransitQty + row.undeliveredQty + row.finishedQty;
    totalsByMaterial.set(row.materialCode, totals);
  });

  return {
    weeks,
    rows: rows.map((row) => {
      const totals = totalsByMaterial.get(row.materialCode);
      return {
        ...row,
        suggestedPurchaseQty: Math.max(0, totals.forecastQty - totals.stockQty)
      };
    }).sort((left, right) => (
      left.materialCode.localeCompare(right.materialCode, 'zh-CN', { numeric: true })
      || left.businessUnit.localeCompare(right.businessUnit, 'zh-CN')
    ))
  };
}

export function groupStockingPlanRowsByMaterial(rows = []) {
  const groups = new Map();
  rows.forEach((row) => {
    const list = groups.get(row.materialCode) || [];
    list.push(row);
    groups.set(row.materialCode, list);
  });
  return [...groups.entries()].map(([materialCode, groupRows]) => ({ materialCode, rows: groupRows }));
}
