import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductArchive } from './product-archive.js';

test('产品档案按物料编码优先、SKU兜底关联事业部反馈', () => {
  const result = buildProductArchive({
    productRows: [
      { materialCode: '1001.0', sku: 'A-1', productLine: '护理床', productSeries: 'A系列' },
      { materialCode: '1002', sku: 'B-1', materialName: '产品B' }
    ],
    feedbackSources: [
      {
        slotId: 'businessUnitFeedback1',
        title: '海外事业一部',
        fileName: '海外一部.xlsx',
        applied: true,
        rows: [
          { materialCode: ' 1001 ', productLifecycle: '成长期', productPositioning: '核心产品' },
          { sku: 'Ｂ－１', productLifecycle: '成熟期', productPositioning: '利润产品' }
        ]
      }
    ]
  });

  assert.equal(result.rows.length, 2);
  const product1001 = result.rows.find((row) => row.materialCode === '1001.0');
  const product1002 = result.rows.find((row) => row.materialCode === '1002');
  assert.equal(product1001.feedbacks[0].productLifecycle, '成长期');
  assert.equal(product1001.feedbacks[0].productPositioning, '核心产品');
  assert.equal(product1002.feedbacks[0].productLifecycle, '成熟期');
  assert.equal(result.feedbackSlots[0].matchedCount, 2);
  assert.equal(result.feedbackSlots[0].unmatchedCount, 0);
});

test('同一事业部同一产品重复反馈采用文件中最后一行并统计未匹配', () => {
  const result = buildProductArchive({
    productRows: [{ materialCode: '1001', sku: 'A1' }],
    feedbackSources: [{
      slotId: 'businessUnitFeedback2',
      title: '海外事业二部',
      rows: [
        { materialCode: '1001', productLifecycle: '导入期' },
        { materialCode: '1001', productLifecycle: '成长期' },
        { materialCode: '9999', productLifecycle: '成熟期' }
      ]
    }]
  });

  assert.equal(result.rows[0].feedbacks.length, 1);
  assert.equal(result.rows[0].feedbacks[0].productLifecycle, '成长期');
  assert.equal(result.feedbackSlots[0].matchedCount, 1);
  assert.equal(result.feedbackSlots[0].unmatchedCount, 1);
});

test('商品分类重复物料合并为空字段且不丢失已有值', () => {
  const result = buildProductArchive({
    productRows: [
      { materialCode: '1001', sku: 'A1', productLine: '护理床' },
      { materialCode: '1001.0', sku: '', materialName: '护理床A1' }
    ]
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].sku, 'A1');
  assert.equal(result.rows[0].materialName, '护理床A1');
});
