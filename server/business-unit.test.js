import test from 'node:test';
import assert from 'node:assert/strict';

import { purchaseTrackingBusinessUnit } from '../src/business-unit.js';

test('purchase tracking business unit uses the text before the first asterisk', () => {
  assert.equal(purchaseTrackingBusinessUnit('\u54c1\u724c\u5e02\u573a\u90e8*\u6d77\u5916\u9009\u54c1\u90e8'), '\u54c1\u724c\u5e02\u573a\u90e8');
  assert.equal(purchaseTrackingBusinessUnit('\u91c7\u8d2d\u4e2d\u5fc3*\u4e00\u90e8*\u4e00\u7ec4'), '\u91c7\u8d2d\u4e2d\u5fc3');
});

test('purchase tracking business unit preserves plain values and trims whitespace', () => {
  assert.equal(purchaseTrackingBusinessUnit('  \u56fd\u5185\u4e8b\u4e1a\u90e8  '), '\u56fd\u5185\u4e8b\u4e1a\u90e8');
  assert.equal(purchaseTrackingBusinessUnit(' \u54c1\u724c\u90e8 \uff0a \u6d77\u5916\u7ec4 '), '\u54c1\u724c\u90e8');
  assert.equal(purchaseTrackingBusinessUnit(null), '');
});

test('purchase tracking business unit deduplicates combined values after ignoring asterisk suffixes', () => {
  assert.equal(purchaseTrackingBusinessUnit('\u56fd\u5185\u4e8b\u4e1a\u90e8\u3001\u56fd\u5185\u4e8b\u4e1a\u90e8*\u9500\u552e\u4e00\u7ec4'), '\u56fd\u5185\u4e8b\u4e1a\u90e8');
  assert.equal(purchaseTrackingBusinessUnit('\u6d77\u5916\u4e8b\u4e1a\u4e00\u90e8\uff0c\u6d77\u5916\u4e8b\u4e1a\u4e00\u90e8\uff0a\u7f8e\u56fd\u7ec4'), '\u6d77\u5916\u4e8b\u4e1a\u4e00\u90e8');
  assert.equal(purchaseTrackingBusinessUnit('\u56fd\u5185\u4e8b\u4e1a\u90e8+\u6d77\u5916\u4e8b\u4e1a\u4e00\u90e8*\u7f8e\u56fd\u7ec4'), '\u56fd\u5185\u4e8b\u4e1a\u90e8\u3001\u6d77\u5916\u4e8b\u4e1a\u4e00\u90e8');
});
