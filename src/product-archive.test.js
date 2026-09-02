import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeFeedbackSlots,
  filterProductArchiveRows,
  flattenProductArchive,
  productArchiveMetrics
} from './product-archive.js';

const slots = [
  { slotId: 'businessUnitFeedback1', title: '海外事业一部' },
  { slotId: 'businessUnitFeedback2', title: '海外事业二部' },
  { slotId: 'businessUnitFeedback3', title: '国内事业部' },
  { slotId: 'businessUnitFeedback4', title: '产品项目' },
  { slotId: 'businessUnitFeedback5', title: '备用2', applied: true, fileName: '备用.xlsx', rowCount: 1 }
];

test('前三个事业部始终显示，备用槽位有应用文件后才进入看板', () => {
  assert.deepEqual(activeFeedbackSlots(slots).map((slot) => slot.title), [
    '海外事业一部', '海外事业二部', '国内事业部', '备用2'
  ]);
});

test('产品按事业部展开并正确计算反馈覆盖指标', () => {
  const products = [{
    id: 'material:1001',
    materialCode: '1001',
    sku: 'A1',
    productLine: '护理床',
    feedbacks: [{ slotId: 'businessUnitFeedback1', productLifecycle: '成长期', productPositioning: '核心产品' }]
  }];
  const flatRows = flattenProductArchive(products, slots.slice(0, 4));
  const metrics = productArchiveMetrics(products, flatRows);

  assert.equal(flatRows.length, 3);
  assert.equal(metrics.productCount, 1);
  assert.equal(metrics.coveredProducts, 1);
  assert.equal(metrics.feedbackCount, 1);
  assert.equal(metrics.pendingCount, 2);
});

test('事业部、生命周期、产品线及关键词筛选联动', () => {
  const rows = [
    { businessUnit: '海外事业一部', productLifecycle: '成长期', productPositioning: '核心产品', productLine: '护理床', sku: 'A1', materialName: '护理床A' },
    { businessUnit: '国内事业部', productLifecycle: '成熟期', productPositioning: '利润产品', productLine: '轮椅', sku: 'B1', materialName: '轮椅B' }
  ];
  assert.equal(filterProductArchiveRows(rows, { businessUnit: '国内事业部' }).length, 1);
  assert.equal(filterProductArchiveRows(rows, { productLifecycle: '成长期', productLine: '护理床' }).length, 1);
  assert.equal(filterProductArchiveRows(rows, { keyword: 'b1' }).length, 1);
  assert.equal(filterProductArchiveRows([...rows, { businessUnit: '海外事业二部', productLifecycle: '', productPositioning: '' }], { productLifecycle: '待反馈' }).length, 1);
});
