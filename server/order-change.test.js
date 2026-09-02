import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOrderChangeIndex,
  classifyOrderChange,
  isInternalTransactionSupplier,
  orderTypeForSupplier,
  originalOrderNoFromRemark
} from './order-change.js';

function orderRow(values = {}) {
  return {
    batch_id: 'current-batch',
    order_no: 'CGDD020000',
    supplier: '供应商甲',
    material_code: 'M-001',
    quantity: 100,
    purchase_date: '2026-08-08',
    order_remark: '',
    manual_close: '',
    remaining_inbound_qty: 100,
    ...values
  };
}

test('备注开头的CGDD编号被识别为原采购订单号', () => {
  assert.equal(originalOrderNoFromRemark('CGDD012345 原单替换'), 'CGDD012345');
  assert.equal(originalOrderNoFromRemark('  CGDD009999'), 'CGDD009999');
  assert.equal(originalOrderNoFromRemark('调整CGDD012345'), '');
});

test('指定五家供应商全部识别为内部交易订单', () => {
  [
    '浙江迈德斯特医疗器械科技有限公司',
    '杭州国源养老科技有限公司',
    '河北瑞朗德医疗器械科技集团有限公司',
    'MATESIDE GLOBAL US INC.',
    '杭州奇邦医疗器械有限公司'
  ].forEach((supplier) => {
    assert.equal(isInternalTransactionSupplier(supplier), true);
    assert.equal(orderTypeForSupplier(supplier, '正常订单'), '内部交易订单');
  });
  assert.equal(isInternalTransactionSupplier('其他供应商'), false);
  assert.equal(orderTypeForSupplier('其他供应商', '订单变更'), '订单变更');
});

test('迈德斯特匹配采购分工简称电控生产部时不属于内部交易', () => {
  const supplier = '浙江迈德斯特医疗器械科技有限公司';
  assert.equal(isInternalTransactionSupplier(supplier, '电控生产部'), false);
  assert.equal(isInternalTransactionSupplier(supplier, '电控生产部&其他简称'), false);
  assert.equal(orderTypeForSupplier(supplier, '正常订单', '电控生产部'), '正常订单');
  assert.equal(orderTypeForSupplier(supplier, '订单变更', '电控生产部'), '订单变更');
  assert.equal(orderTypeForSupplier(supplier, '正常订单', '迈德斯特'), '内部交易订单');
  assert.equal(orderTypeForSupplier('杭州国源养老科技有限公司', '正常订单', '电控生产部'), '内部交易订单');
});

test('瑞朗德匹配采购分工简称瑞朗德时不属于内部交易', () => {
  const supplier = '河北瑞朗德医疗器械科技集团有限公司';
  assert.equal(isInternalTransactionSupplier(supplier, '瑞朗德'), false);
  assert.equal(isInternalTransactionSupplier(supplier, '瑞朗德、其他简称'), false);
  assert.equal(orderTypeForSupplier(supplier, '正常订单', '瑞朗德'), '正常订单');
  assert.equal(orderTypeForSupplier(supplier, '订单变更', '瑞朗德'), '订单变更');
  assert.equal(orderTypeForSupplier(supplier, '正常订单', '其他简称'), '内部交易订单');
  assert.equal(orderTypeForSupplier('杭州奇邦医疗器械有限公司', '正常订单', '瑞朗德'), '内部交易订单');
});

test('迈德斯特电控生产部订单保留变更类型', () => {
  const supplier = '浙江迈德斯特医疗器械科技有限公司';
  const originalRows = [orderRow({ order_no: 'CGDD010000', supplier, quantity: 100, purchase_date: '2026-03-12', manual_close: '是' })];
  const currentRows = [orderRow({ order_no: 'CGDD020000', supplier, quantity: 90, order_remark: 'CGDD010000' })];
  const result = classifyOrderChange({
    currentRows,
    batchId: 'current-batch',
    supplier,
    supplierShortName: '电控生产部',
    materialCode: 'M-001',
    fallbackMonth: '2026-08',
    index: buildOrderChangeIndex([...originalRows, ...currentRows])
  });
  assert.equal(result.orderType, '订单变更');
});

test('内部交易供应商保留原订单变更的月份和数量口径', () => {
  const supplier = '浙江迈德斯特医疗器械科技有限公司';
  const originalRows = [orderRow({ order_no: 'CGDD010000', supplier, quantity: 100, purchase_date: '2026-03-12', manual_close: '是' })];
  const currentRows = [orderRow({ order_no: 'CGDD020000', supplier, quantity: 90, order_remark: 'CGDD010000' })];
  const result = classifyOrderChange({
    currentRows,
    batchId: 'current-batch',
    supplier,
    materialCode: 'M-001',
    fallbackMonth: '2026-08',
    index: buildOrderChangeIndex([...originalRows, ...currentRows])
  });
  assert.equal(result.orderType, '内部交易订单');
  assert.equal(result.changeValidationStatus, 'valid');
  assert.equal(result.reportingMonth, '2026-03');
  assert.equal(result.reportingPurchaseQty, 100);
});

test('正常订单使用当前订单月份和采购数量', () => {
  const currentRows = [orderRow({ quantity: 80 }), orderRow({ quantity: 20 })];
  const result = classifyOrderChange({
    currentRows,
    batchId: 'current-batch',
    supplier: '供应商甲',
    materialCode: 'M-001',
    fallbackMonth: '2026-08',
    index: buildOrderChangeIndex(currentRows)
  });
  assert.equal(result.orderType, '正常订单');
  assert.equal(result.reportingMonth, '2026-08');
  assert.equal(result.currentPurchaseQty, 100);
  assert.equal(result.reportingPurchaseQty, 100);
});

test('有效变更单按手工关闭原订单的月份和供应商物料采购数量汇总', () => {
  const originalRows = [
    orderRow({ order_no: 'CGDD010000', quantity: 60, purchase_date: '2026-03-12', manual_close: '是', remaining_inbound_qty: 0 }),
    orderRow({ order_no: 'CGDD010000', quantity: 40, purchase_date: '2026-03-12', manual_close: '是', remaining_inbound_qty: 0 })
  ];
  const currentRows = [orderRow({ order_no: 'CGDD020000', quantity: 90, order_remark: 'CGDD010000' })];
  const result = classifyOrderChange({
    currentRows,
    batchId: 'current-batch',
    supplier: '供应商甲',
    materialCode: 'M-001',
    fallbackMonth: '2026-08',
    index: buildOrderChangeIndex([...originalRows, ...currentRows])
  });
  assert.equal(result.orderType, '订单变更');
  assert.equal(result.originalOrderNo, 'CGDD010000');
  assert.equal(result.originalOrderDate, '2026-03-12');
  assert.equal(result.reportingMonth, '2026-03');
  assert.equal(result.originalPurchaseQty, 100);
  assert.equal(result.reportingPurchaseQty, 100);
  assert.equal(result.currentPurchaseQty, 90);
});

test('原订单缺失、匹配错供应商物料或手工关闭不是是均待核验且不计数量', () => {
  const currentRows = [orderRow({ order_remark: 'CGDD010000' })];
  const cases = [
    { sourceRows: currentRows, message: '找不到原采购订单' },
    {
      sourceRows: [orderRow({ order_no: 'CGDD010000', supplier: '供应商乙', manual_close: '是' }), ...currentRows],
      message: '供应商或物料编码'
    },
    {
      sourceRows: [orderRow({ order_no: 'CGDD010000', manual_close: '否' }), ...currentRows],
      message: '手工关闭'
    }
  ];
  cases.forEach(({ sourceRows, message }) => {
    const result = classifyOrderChange({
      currentRows,
      batchId: 'current-batch',
      supplier: '供应商甲',
      materialCode: 'M-001',
      fallbackMonth: '2026-08',
      index: buildOrderChangeIndex(sourceRows)
    });
    assert.equal(result.orderType, '变更待核验');
    assert.equal(result.reportingMonth, '');
    assert.equal(result.reportingPurchaseQty, 0);
    assert.match(result.changeValidationMessage, new RegExp(message));
  });
});

test('原订单创建日期冲突时待核验', () => {
  const originalRows = [
    orderRow({ order_no: 'CGDD010000', purchase_date: '2026-03-12', manual_close: '是' }),
    orderRow({ order_no: 'CGDD010000', purchase_date: '2026-03-13', manual_close: '是' })
  ];
  const currentRows = [orderRow({ order_remark: 'CGDD010000' })];
  const result = classifyOrderChange({
    currentRows,
    batchId: 'current-batch',
    supplier: '供应商甲',
    materialCode: 'M-001',
    fallbackMonth: '2026-08',
    index: buildOrderChangeIndex([...originalRows, ...currentRows])
  });
  assert.equal(result.orderType, '变更待核验');
  assert.equal(result.reportingPurchaseQty, 0);
  assert.match(result.changeValidationMessage, /多个创建日期/);
});
