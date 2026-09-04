const SLOT_MAPPING_STORAGE_PREFIX = 'bhchh_map_';

function availableStorage(storage) {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function slotMappingStorageKey(slotId) {
  return `${SLOT_MAPPING_STORAGE_PREFIX}${slotId}`;
}

export function loadSlotMapping(slotId, storage) {
  const target = availableStorage(storage);
  if (!target || !slotId) return null;
  try {
    const raw = target.getItem(slotMappingStorageKey(slotId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.mapping || typeof parsed.mapping !== 'object' || Array.isArray(parsed.mapping)) {
      return null;
    }
    const mapping = Object.fromEntries(
      Object.entries(parsed.mapping)
        .filter(([key, value]) => key && (typeof value === 'string' || typeof value === 'number'))
        .map(([key, value]) => [key, String(value)])
    );
    return { mapping, savedAt: Number(parsed.savedAt) || 0 };
  } catch {
    return null;
  }
}

export function saveSlotMapping(slotId, mapping = {}, storage, savedAt = Date.now()) {
  const target = availableStorage(storage);
  if (!target || !slotId) return null;
  const payload = {
    mapping: Object.fromEntries(
      Object.entries(mapping || {})
        .filter(([key, value]) => key && (typeof value === 'string' || typeof value === 'number'))
        .map(([key, value]) => [key, String(value)])
    ),
    savedAt
  };
  try {
    target.setItem(slotMappingStorageKey(slotId), JSON.stringify(payload));
    return payload;
  } catch {
    return null;
  }
}

export function matchRememberedSlotMapping(mapping = {}, columns = [], fields = []) {
  const availableColumns = new Set(columns);
  const matchedMapping = {};
  const missingColumns = {};
  fields.forEach(([key]) => {
    const rememberedColumn = typeof mapping?.[key] === 'string' || typeof mapping?.[key] === 'number'
      ? String(mapping[key])
      : '';
    if (!rememberedColumn) {
      matchedMapping[key] = '';
      return;
    }
    if (availableColumns.has(rememberedColumn)) {
      matchedMapping[key] = rememberedColumn;
      return;
    }
    matchedMapping[key] = '';
    missingColumns[key] = rememberedColumn;
  });
  return { mapping: matchedMapping, missingColumns };
}
