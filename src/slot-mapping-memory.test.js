import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadSlotMapping,
  matchRememberedSlotMapping,
  saveSlotMapping,
  slotMappingStorageKey
} from './slot-mapping-memory.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); }
  };
}

test('槽位映射按约定 key 独立保存并可覆盖', () => {
  const storage = memoryStorage();
  saveSlotMapping('productCategory', { materialCode: '物料编码' }, storage, 100);
  saveSlotMapping('inventorySummaryFile18', { materialCode: '商品编码' }, storage, 200);
  saveSlotMapping('productCategory', { materialCode: '新物料编码' }, storage, 300);

  assert.equal(slotMappingStorageKey('productCategory'), 'bhchh_map_productCategory');
  assert.deepEqual(loadSlotMapping('productCategory', storage), {
    mapping: { materialCode: '新物料编码' },
    savedAt: 300
  });
  assert.deepEqual(loadSlotMapping('inventorySummaryFile18', storage), {
    mapping: { materialCode: '商品编码' },
    savedAt: 200
  });
});

test('记忆映射严格按列名大小写匹配并标记缺失列', () => {
  const fields = [['materialCode', '物料编码'], ['sku', 'SKU'], ['materialName', '名称']];
  const result = matchRememberedSlotMapping(
    { materialCode: '物料编码', sku: 'sku', materialName: '旧名称' },
    ['物料编码', 'SKU', '名称'],
    fields
  );

  assert.deepEqual(result.mapping, { materialCode: '物料编码', sku: '', materialName: '' });
  assert.deepEqual(result.missingColumns, { sku: 'sku', materialName: '旧名称' });
});

test('损坏或不可用的浏览器记忆不会中断上传流程', () => {
  const brokenStorage = {
    getItem() { return '{broken'; },
    setItem() { throw new Error('quota'); }
  };
  assert.equal(loadSlotMapping('productCategory', brokenStorage), null);
  assert.equal(saveSlotMapping('productCategory', { materialCode: '物料编码' }, brokenStorage), null);
});
