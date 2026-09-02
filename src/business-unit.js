export function purchaseTrackingBusinessUnit(value) {
  const normalizedUnits = String(value ?? '')
    .split(/[、,，+]/)
    .map((unit) => unit.trim().split(/[*\uff0a]/, 1)[0].trim())
    .filter(Boolean);
  return [...new Set(normalizedUnits)].join('、');
}
