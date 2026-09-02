import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProgressDateValue } from './progress-date.js';

test('生产跟进日期兼容历史 Excel 和金蝶格式', () => {
  assert.equal(normalizeProgressDateValue('2026-07-31'), '2026-07-31');
  assert.equal(normalizeProgressDateValue('2026/7/31 00:00:00'), '2026-07-31');
  assert.equal(normalizeProgressDateValue('2026年7月31日'), '2026-07-31');
  assert.equal(normalizeProgressDateValue('2026.7.31'), '2026-07-31');
  assert.equal(normalizeProgressDateValue('2026-07-31T00:00:00.000Z'), '2026-07-31');
  assert.equal(normalizeProgressDateValue('7/31/26'), '2026-07-31');
  assert.equal(normalizeProgressDateValue('7/31/2026'), '2026-07-31');
  assert.equal(normalizeProgressDateValue('46234'), '2026-07-31');
});

test('生产跟进日期拒绝无效值且保留空值', () => {
  assert.equal(normalizeProgressDateValue(''), '');
  assert.equal(normalizeProgressDateValue('待确认'), '');
  assert.equal(normalizeProgressDateValue('2/30/26'), '');
  assert.equal(normalizeProgressDateValue('2026-13-01'), '');
});
