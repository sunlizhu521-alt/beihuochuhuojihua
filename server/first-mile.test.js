import assert from 'node:assert/strict';
import test from 'node:test';
import xlsx from 'xlsx';
import { FIRST_MILE_PARSER_VERSION, parseFirstMileWorkbook, reparseFirstMileSource } from './first-mile.js';

function workbookFile(sheets) {
  const workbook = xlsx.utils.book_new();
  sheets.forEach(({ name, rows, merges = [] }) => {
    const sheet = xlsx.utils.aoa_to_sheet(rows);
    sheet['!merges'] = merges.map((range) => xlsx.utils.decode_range(range));
    xlsx.utils.book_append_sheet(workbook, sheet, name);
  });
  return { buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) };
}

test('头程工作簿兼容两级表头和单行表头的目的仓库', () => {
  const file = workbookFile([
    {
      name: '头程成品发货',
      rows: [
        ['头程数据说明'],
        ['OA审批单号', '小包装数量', '物料编码', '领星虚拟仓', '目的仓', ''],
        ['OA审批单号', '小包装数量', '物料编码', '其他字段', '仓库', '领星虚拟仓'],
        ['OA-001', 12, '1001', '错误虚拟仓', 'SCK8', '106-G-美国自营仓'],
        ['OA-003', 4, '1003', '错误虚拟仓', '德国东荣', '101-G-德国东荣仓']
      ],
      merges: ['E2:F2']
    },
    {
      name: '空运',
      rows: [
        ['OA审批单号', '小包装数量', '物料编码', '领星虚拟仓', '目的仓', ''],
        ['OA-002', 8, '1002', '错误虚拟仓', '德国东荣', '777-G-德国东荣仓'],
        ['OA-004', 6, '1004', '错误虚拟仓', '智利', '/']
      ],
      merges: ['E1:F1']
    }
  ]);

  const result = parseFirstMileWorkbook(file, { slotId: 'firstMileData1', fileName: '头程测试.xlsx' });

  assert.equal(result.summary.parserVersion, FIRST_MILE_PARSER_VERSION);
  assert.equal(result.rows.length, 4);
  assert.deepEqual(
    result.rows.map((row) => [row.oaApprovalNo, row.destinationWarehouse, row.inboundWarehouseType]),
    [
      ['OA-001', 'SCK8', 'FBA仓'],
      ['OA-003', '101-G-德国东荣仓', 'FBM仓'],
      ['OA-002', '777-G-德国东荣仓', 'FBM仓'],
      ['OA-004', '智利', '']
    ]
  );
});

test('旧头程解析结果使用已保存原文件自动升级', () => {
  const file = workbookFile([
    {
      name: '头程成品发货',
      rows: [
        ['头程数据说明'],
        ['OA审批单号', '小包装数量', '物料编码', '目的仓', ''],
        ['OA审批单号', '小包装数量', '物料编码', '仓库', '领星虚拟仓'],
        ['OA-REPARSE-1', 20, '1008', '德国东荣', '108-G-德国东荣仓']
      ],
      merges: ['D2:E2']
    }
  ]);
  const upgraded = reparseFirstMileSource({
    slotId: 'firstMileData1',
    fileName: '旧头程文件.xlsx',
    sourceFile: file.buffer,
    mapping: { keep: '保留', __firstMileSummary: { parserVersion: 4 } }
  });

  assert.equal(upgraded.summary.parserVersion, FIRST_MILE_PARSER_VERSION);
  assert.equal(upgraded.mapping.keep, '保留');
  assert.equal(upgraded.rows[0].destinationWarehouse, '108-G-德国东荣仓');
  assert.equal(upgraded.rows[0].inboundWarehouseType, 'FBM仓');
  assert.deepEqual(upgraded.selectedSheetNames, ['头程成品发货']);
  assert.equal(reparseFirstMileSource({
    slotId: 'firstMileData1',
    fileName: '新头程文件.xlsx',
    sourceFile: file.buffer,
    mapping: { __firstMileSummary: { parserVersion: FIRST_MILE_PARSER_VERSION } }
  }), null);
  assert.equal(reparseFirstMileSource({
    slotId: 'firstMileData1',
    fileName: '无原文件.xlsx',
    mapping: { __firstMileSummary: { parserVersion: 4 } }
  }), null);
});
