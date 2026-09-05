import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ROUTE_SETTINGS,
  ROUTE_SETTINGS_STORAGE_KEY,
  loadRouteSettings,
  normalizeRouteSettings,
  saveRouteSettings
} from './route-settings-storage.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
}

test('路由设置按固定 key 保存并可供两个页面读取', () => {
  const storage = memoryStorage();
  const input = structuredClone(DEFAULT_ROUTE_SETTINGS);
  input.channels.domestic.transportDays = 9;
  const saved = saveRouteSettings(input, storage);

  assert.equal(saved.channels.domestic.transportDays, 9);
  assert.equal(loadRouteSettings(storage).channels.domestic.transportDays, 9);
  assert.ok(JSON.parse(storage.getItem(ROUTE_SETTINGS_STORAGE_KEY)).savedAt > 0);
});

test('路由设置缺失或非法值回退到定稿默认值', () => {
  const normalized = normalizeRouteSettings({
    channels: { overseasUs: { transportDays: -1 }, domestic: { bookingDays: 'abc' } }
  });
  assert.equal(normalized.channels.overseasUs.transportDays, 40);
  assert.equal(normalized.channels.domestic.bookingDays, 3);
  assert.equal(normalized.channels.overseasEurope.safetyDays, 190);
});

test('路由输入清空时保留编辑态，便于录入新数值', () => {
  const normalized = normalizeRouteSettings({ channels: { domestic: { transportDays: '' } } });
  assert.equal(normalized.channels.domestic.transportDays, '');
});
