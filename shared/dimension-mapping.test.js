import test from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { parseInventorySummaryWorkbook } from '../server/inventory-summary.js';
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

test('库存、未交付和M+6槽位使用约定字段及必填项', () => {
  const slots = Object.fromEntries(INVENTORY_SUMMARY_LIBRARY_SLOTS.map((slot) => [slot.id, slot]));
  assert.deepEqual(slots.inventorySummaryFile18.fields.map(([key]) => key), ['warehouseName', 'businessUnit', 'materialCode', 'onHandQty', 'inTransitQty']);
  assert.deepEqual(slots.inventorySummaryFile18.requiredFields, ['warehouseName', 'businessUnit', 'materialCode', 'onHandQty']);
  assert.deepEqual(slots.inventorySummaryFile19.fields.map(([key]) => key), ['businessUnit', 'operator', 'materialCode', 'undeliveredQty', 'finishedQty']);
  assert.deepEqual(slots.inventorySummaryFile21.fields.map(([key]) => key), ['businessUnit', 'materialCode', 'sku', 'skuName', 'month1', 'month2', 'month3', 'month4', 'month5', 'month6']);
});

function workbookFile(rows) {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(rows), '数据');
  return { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) };
}

test('后端可按别名解析三个新槽位并过滤零数量行', () => {
  const inventory = parseInventorySummaryWorkbook(workbookFile([
    ['仓库名称', '事业部', '物料编码', '库存数量', '在途数量'],
    ['华南仓', '国内事业部', 'MAT-001', 12, 3],
    ['华东仓', '国内事业部', 'MAT-002', 0, 8]
  ]), 'inventorySummaryFile18');
  assert.deepEqual(inventory.rows, [{ warehouseName: '华南仓', businessUnit: '国内事业部', materialCode: 'MAT-001', onHandQty: 12, inTransitQty: 3 }]);
  assert.equal(inventory.mapping.__inventorySummary.filteredZeroQtyRows, 1);

  const undelivered = parseInventorySummaryWorkbook(workbookFile([
    ['事业部', '运营负责人', '物料编码', '未交货数量', '已完工未发货'],
    ['海外一部', '张三', 'MAT-003', 6, 2]
  ]), 'inventorySummaryFile19');
  assert.deepEqual(undelivered.rows[0], { businessUnit: '海外一部', operator: '张三', materialCode: 'MAT-003', undeliveredQty: 6, finishedQty: 2 });

  const forecast = parseInventorySummaryWorkbook(workbookFile([
    ['事业部', '物料编码', 'SKU', 'SKU名称', '8', '9', '10', '11', '12', '1'],
    ['海外二部', 'MAT-004', 'SKU-004', '测试产品', 1, 2, 3, 4, 5, 6]
  ]), 'inventorySummaryFile21');
  assert.deepEqual(forecast.rows[0], {
    businessUnit: '海外二部', materialCode: 'MAT-004', sku: 'SKU-004', skuName: '测试产品',
    month1: 1, month2: 2, month3: 3, month4: 4, month5: 5, month6: 6
  });
});

test('未交付为零但有完工未发、M1为零但后续有预测时仍保留', () => {
  const undelivered = parseInventorySummaryWorkbook(workbookFile([
    ['事业部', '物料编码', '未交付数量', '已完工未发货'],
    ['国内事业部', 'MAT-006', 0, 5]
  ]), 'inventorySummaryFile19');
  assert.equal(undelivered.rows.length, 1);
  assert.equal(undelivered.rows[0].finishedQty, 5);

  const forecast = parseInventorySummaryWorkbook(workbookFile([
    ['事业部', '物料编码', '8', '9', '10', '11', '12', '1'],
    ['国内事业部', 'MAT-006', 0, 12, 0, 0, 0, 0]
  ]), 'inventorySummaryFile21');
  assert.equal(forecast.rows.length, 1);
  assert.equal(forecast.rows[0].month2, 12);
});

test('库存解析结果保留源列供上传接口校验映射', () => {
  const slot = INVENTORY_SUMMARY_LIBRARY_SLOTS.find(({ id }) => id === 'inventorySummaryFile18');
  const mapping = {
    warehouseName: '仓库',
    businessUnit: '事业部',
    materialCode: '物料编码',
    onHandQty: '在库',
    inTransitQty: '在途'
  };
  const inventory = parseInventorySummaryWorkbook(workbookFile([
    Object.values(mapping),
    ['华南仓', '国内事业部', 'MAT-001', 12, 3]
  ]), slot.id, mapping);

  assert.deepEqual(inventory.columns, Object.values(mapping));
  assert.deepEqual(
    mappingValidation(mapping, slot.fields, slot.requiredFields, inventory.columns),
    { missingFields: [], duplicateColumns: [], unknownColumns: [] }
  );
});

test('后端拒绝缺少必填月份的M+6预测文件', () => {
  assert.throws(() => parseInventorySummaryWorkbook(workbookFile([
    ['事业部', '物料编码', '8', '9', '10', '11', '12'],
    ['海外二部', 'MAT-005', 1, 2, 3, 4, 5]
  ]), 'inventorySummaryFile21'), /缺少必填列：1/);
});
