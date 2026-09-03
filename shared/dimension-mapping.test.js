import test from 'node:test';
import assert from 'node:assert/strict';
import { DIMENSION_SLOTS, INVENTORY_SUMMARY_LIBRARY_SLOTS } from './dimension-slot-config.js';
import { duplicateMappingColumns, mappingValidation, validMappingForColumns } from './dimension-mapping.js';

test('商品分类只保留真实业务字段', () => {
  const slot = DIMENSION_SLOTS.find(({ id }) => id === 'productCategory');
  const keys = slot.fields.map(([key]) => key);
  assert.equal(keys.includes('logisticsCode'), false);
  assert.equal(slot.fields.find(([key]) => key === 'productType')[1], '销售产品分类');
  assert.deepEqual(keys.filter((key) => key === 'materialCode'), ['materialCode']);
});

test('关闭推断时字段保持空白，由用户自定义选择', () => {
  const fields = [['supplier', '供应商'], ['supplierShortName', '供应商简称']];
  const mapping = validMappingForColumns({}, ['供应商'], fields, false);
  assert.equal(Object.values(mapping).filter(Boolean).length, 0);
  assert.deepEqual(duplicateMappingColumns(mapping, fields), []);
});

test('服务端校验可识别缺失和重复映射', () => {
  const fields = [['latestMaterialCode', '最新物料编码'], ['relatedMaterialCode', '关联物料编码']];
  const validation = mappingValidation(
    { latestMaterialCode: '物料编码', relatedMaterialCode: '物料编码' },
    fields,
    ['latestMaterialCode', 'relatedMaterialCode'],
    ['物料编码']
  );
  assert.deepEqual(validation.missingFields, []);
  assert.equal(validation.duplicateColumns.length, 1);
});

test('底表四个槽位均要求人工确认映射', () => {
  assert.equal(INVENTORY_SUMMARY_LIBRARY_SLOTS.length, 4);
  INVENTORY_SUMMARY_LIBRARY_SLOTS.forEach((slot) => {
    assert.equal(slot.manualFieldSelection, true);
    assert.equal(slot.autoMap, false);
    assert.equal(slot.reuseSavedMapping, false);
    assert.equal(slot.requireMappingConfirmation, true);
    assert.ok(slot.requiredFields.length > 0);
  });
});
