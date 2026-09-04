export const SUPPLY_PLAN_BUSINESS_UNIT_REPLACEMENTS = Object.freeze([
  Object.freeze({ source: '全球招商部', target: '全球招商事业部' })
]);

function normalizedText(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

export function normalizeSupplyPlanBusinessUnit(value) {
  const original = normalizedText(value);
  const baseName = normalizedText(original.split('*')[0]) || original;
  const replacement = SUPPLY_PLAN_BUSINESS_UNIT_REPLACEMENTS
    .find(({ source }) => source === baseName);
  return replacement?.target || baseName;
}
