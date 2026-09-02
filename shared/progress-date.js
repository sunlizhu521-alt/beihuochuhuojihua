function isoDate(yearValue, monthValue, dayValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizeProgressDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value ?? '').trim();
  if (!text) return '';

  const yearFirst = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:[ T].*)?$/);
  if (yearFirst) return isoDate(yearFirst[1], yearFirst[2], yearFirst[3]);

  // 金蝶和历史手工表中会出现 Excel/美式短日期，例如 7/31/26。
  const monthFirst = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:[ T].*)?$/);
  if (monthFirst) {
    const shortYear = Number(monthFirst[3]);
    const year = monthFirst[3].length === 2 ? (shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear) : shortYear;
    return isoDate(year, monthFirst[1], monthFirst[2]);
  }

  const excelSerial = Number(text);
  if (/^\d+(?:\.\d+)?$/.test(text) && excelSerial >= 20_000 && excelSerial <= 80_000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(excelSerial) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  return '';
}
