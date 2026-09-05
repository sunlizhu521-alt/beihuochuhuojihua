export const ROUTE_SETTINGS_STORAGE_KEY = 'bhchh_route_settings';
export const ROUTE_SETTINGS_EVENT = 'bhchh-route-settings-change';

export const DEFAULT_ROUTE_SETTINGS = Object.freeze({
  channels: Object.freeze({
    overseasUs: Object.freeze({
      onHandSellableDays: 60,
      dispatchToShelfDays: 10,
      transportDays: 40,
      bookingDays: 10,
      averageLeadTimeDays: 45,
      contractSigningDays: 10,
      safetyDays: 175
    }),
    overseasEurope: Object.freeze({
      onHandSellableDays: 60,
      dispatchToShelfDays: 10,
      transportDays: 55,
      bookingDays: 10,
      averageLeadTimeDays: 45,
      contractSigningDays: 10,
      safetyDays: 190
    }),
    domestic: Object.freeze({
      onHandSellableDays: 30,
      dispatchToShelfDays: 7,
      transportDays: 7,
      bookingDays: 3,
      averageLeadTimeDays: 45,
      contractSigningDays: 10,
      safetyDays: 102
    })
  })
});

const EDITABLE_FIELDS = [
  'onHandSellableDays',
  'dispatchToShelfDays',
  'transportDays',
  'bookingDays',
  'averageLeadTimeDays',
  'contractSigningDays',
  'safetyDays'
];

function storageOrNull(storage) {
  if (storage) return storage;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeRouteSettings(value = {}) {
  const channels = Object.fromEntries(Object.entries(DEFAULT_ROUTE_SETTINGS.channels).map(([channelKey, defaults]) => {
    const source = value?.channels?.[channelKey] || {};
    return [channelKey, Object.fromEntries(EDITABLE_FIELDS.map((field) => {
      if (source[field] === '') return [field, ''];
      const parsed = Number(source[field]);
      return [field, Number.isFinite(parsed) && parsed >= 0 ? parsed : defaults[field]];
    }))];
  }));
  return { channels };
}

export function loadRouteSettings(storage) {
  const target = storageOrNull(storage);
  if (!target) return null;
  try {
    const saved = JSON.parse(target.getItem(ROUTE_SETTINGS_STORAGE_KEY) || 'null');
    const params = saved?.params || saved;
    return params?.channels ? normalizeRouteSettings(params) : null;
  } catch {
    return null;
  }
}

export function saveRouteSettings(params, storage) {
  const normalized = normalizeRouteSettings(params);
  const target = storageOrNull(storage);
  if (target) {
    try {
      target.setItem(ROUTE_SETTINGS_STORAGE_KEY, JSON.stringify({ params: normalized, savedAt: Date.now() }));
    } catch {
      // 浏览器禁用本地存储时仍保留当前页面内的设置。
    }
  }
  if (!storage && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ROUTE_SETTINGS_EVENT, { detail: normalized }));
  }
  return normalized;
}
