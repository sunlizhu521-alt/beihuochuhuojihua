import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateIntegerByWeights,
  allocateNumberByWeights,
  groupManualProgressRows,
  manualOrderNumbers,
  parseManualProgressRows,
  rebalanceManualProgressSplitRows
} from './manual-progress.js';

function baseRow(overrides = {}) {
  return {
    采购组: '一组',
    采购下单人: '测试采购',
    下单月份: '2026-08',
    OA备货流程号: 'OA-1',
    事业部: '国内事业部*TEMU业务部',
    事业部2: '国内事业部',
    运营: '测试运营',
    采购订单号: 'CGDD-1',
    供应商简称: '测试供应商',
    产品线: '护理床',
    系列: 'E系列',
    物料编码: '1001',
    SKU: 'SKU-1',
    物料名称: '测试物料',
    借调订单: 'JD-1',
    借调备注: '跨仓借调',
    未交付数量: 10,
    已下单未备料未生产: 0,
    已备料未生产: 2,
    生产中产品: 3,
    完工未发产品: 1,
    已发货数量: 5,
    合同约定交期: '2026-09-18 12:30:00',
    '是否正常履约（以通知通知供应商是否取消备货为准）': '是',
    正常履约数量: 10,
    正常履约金额: 1234.5,
    非正常履约数量: 0,
    非正常履约金额: 0,
    备注: '正常',
    ...overrides
  };
}

test('手工跟单解析保留每个源行并自动补足未备料数量', () => {
  const result = parseManualProgressRows([baseRow()], { headerRow: 1 });
  assert.equal(result.summary.sourceRows, 1);
  assert.equal(result.summary.autoFilledRows, 1);
  assert.equal(result.rows[0].sourceRowNo, 2);
  assert.equal(result.rows[0].businessUnit, '国内事业部');
  assert.equal(result.rows[0].unpreparedQty, 5);
  assert.equal(result.rows[0].sourceShippedQty, 5);
  assert.equal(result.rows[0].sourceContractDeliveryDate, '2026-09-18');
  assert.equal(result.rows[0].borrowOrder, 'JD-1');
  assert.equal(result.rows[0].borrowRemark, '跨仓借调');
  assert.equal(result.rows[0].sourceNormalQty, 10);
  assert.equal(result.rows[0].sourceNormalAmount, 1234.5);
  assert.equal(result.rows[0].validationStatus, 'valid');
});

test('三个生产阶段同时为0时保持为0且不自动补入未备料', () => {
  const result = parseManualProgressRows([baseRow({
    已下单未备料未生产: 0,
    已备料未生产: 0,
    生产中产品: 0
  })]);
  assert.equal(result.rows[0].unpreparedQty, 0);
  assert.equal(result.rows[0].preparedNotStartedQty, 0);
  assert.equal(result.rows[0].inProductionQty, 0);
  assert.equal(result.rows[0].autoFilledQty, 0);
  assert.equal(result.rows[0].validationStatus, 'valid');
});

test('手工表Excel日期序列转换为仅日期格式', () => {
  const result = parseManualProgressRows([baseRow({ 合同约定交期: 46265 })]);
  assert.equal(result.rows[0].sourceContractDeliveryDate, '2026-08-31');
});

test('无订单业务、公司大合同和超额行分别标记', () => {
  const result = parseManualProgressRows([
    baseRow({ 采购订单号: '', 物料编码: '1002' }),
    baseRow({ 采购订单号: '/', 物料编码: '/', SKU: '/', 备注: '公司大合同' }),
    baseRow({ 采购订单号: 'CGDD-2', 物料编码: '1003', 未交付数量: 5, 已备料未生产: 6, 生产中产品: 0, 完工未发产品: 0 })
  ]);
  assert.equal(result.summary.manualUnmatchedRows, 1);
  assert.equal(result.summary.companyContractRows, 1);
  assert.equal(result.summary.overAllocatedRows, 1);
  assert.equal(result.rows[2].validationStatus, 'error');
});

test('相同采购订单物料保留全部明细并识别冲突', () => {
  const result = parseManualProgressRows([
    baseRow({ 生产中交付时间: '2026-08-10', 备注: '第一批' }),
    baseRow({ 生产中交付时间: '2026-08-12', 备注: '第二批' })
  ]);
  assert.equal(result.summary.duplicateGroups, 1);
  assert.equal(result.summary.duplicateRows, 2);
  assert.equal(result.summary.conflictGroups, 1);
  assert.deepEqual(result.rows[0].conflictFields, ['生产中交付时间', '备注']);
  const groups = groupManualProgressRows(result.rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sourceRows.length, 2);
});

test('多个采购订单拆分并去重', () => {
  assert.deepEqual(manualOrderNumbers('CG1 + CG2、CG1'), ['CG1', 'CG2']);
  assert.deepEqual(manualOrderNumbers('/'), []);
  const result = parseManualProgressRows([baseRow({ 采购订单号: 'CG1 + CG2、CG1' })]);
  assert.deepEqual(result.rows.map((row) => row.orderNo), ['CG1', 'CG2']);
  assert.deepEqual(result.rows.map((row) => row._splitFrom), ['CG1 + CG2、CG1', 'CG1 + CG2、CG1']);
  assert.equal(result.summary.sourceRows, 2);
  assert.equal(result.summary.totals.manualRemainingQty, 10);
  assert.equal(result.summary.totals.sourceShippedQty, 5);
  assert.equal(result.rows.reduce((sum, row) => sum + row.sourceNormalAmount, 0), 1234.5);

  rebalanceManualProgressSplitRows(result.rows, (row) => row.orderNo === 'CG1' ? 1 : 3);
  assert.deepEqual(result.rows.map((row) => row.manualRemainingQty), [2, 8]);
  assert.deepEqual(result.rows.map((row) => row.sourceShippedQty), [1, 4]);
  assert.equal(result.rows.reduce((sum, row) => sum + row.manualRemainingQty, 0), 10);
  assert.equal(result.rows.reduce((sum, row) => sum + row.sourceShippedQty, 0), 5);
  assert.equal(result.rows.reduce((sum, row) => sum + row.sourceNormalAmount, 0), 1234.5);
});

test('最大余数法按权重分配整数并保持总数一致', () => {
  const items = [
    { orderNo: 'A', weight: 5 },
    { orderNo: 'B', weight: 3 },
    { orderNo: 'C', weight: 2 }
  ];
  const result = allocateIntegerByWeights(7, items);
  assert.deepEqual(result, [4, 2, 1]);
  assert.equal(result.reduce((sum, value) => sum + value, 0), 7);
  assert.deepEqual(allocateIntegerByWeights(9, items.map((item) => ({ ...item, weight: 0 }))), [0, 0, 0]);
});

test('手工履约金额按订单权重拆分并保持原金额一致', () => {
  const items = [{ orderNo: 'A', weight: 2 }, { orderNo: 'B', weight: 1 }];
  const result = allocateNumberByWeights(1000.1, items);
  assert.equal(result.length, 2);
  assert.ok(Math.abs(result.reduce((sum, value) => sum + value, 0) - 1000.1) < 0.000001);
  assert.deepEqual(allocateNumberByWeights(1000.1, items.map((item) => ({ ...item, weight: 0 }))), [0, 0]);
});

test('手工四阶段出现小数时阻止应用，避免整数分配改变原总数', () => {
  const result = parseManualProgressRows([baseRow({ 未交付数量: 10.5 })]);
  assert.equal(result.rows[0].validationStatus, 'error');
  assert.match(result.rows[0].validationMessage, /必须是整数/);
});
