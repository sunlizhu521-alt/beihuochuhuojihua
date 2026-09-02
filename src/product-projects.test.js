import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProductProjectRows, mappingSuggestions, productProjectFilterOptions, salesProductLine, summarizeProductProjectRows } from './product-projects.js';

const rows = [
  { projectName: 'A床项目', businessUnit: '国内事业部', responsibilityDepartment: '产品一部', projectStage: '测试', projectStatus: '进行中', productPositioning: '中端', innovationType: '绝对创新', productLine: '护理床（国内）', owner: '张三', demandInitiationDate: '2026-08-20', sku: 'A1', weeklyMeetingNote: '技术评审' },
  { projectName: 'B椅项目', businessUnit: '海外事业一部', responsibilityDepartment: '产品二部', projectStage: '立项', projectStatus: '规划', productPositioning: '高端', innovationType: '微创新', productLine: '轮椅(海外)', owner: '李四', demandInitiationDate: '2026-09-10', sku: 'B1' },
  { projectName: 'C空项目', businessUnit: '海外事业二部', responsibilityDepartment: '产品二部', projectStage: '立项', projectStatus: '规划', productPositioning: '高端', innovationType: '微创新', productLine: '-', owner: '李四', sku: 'C1' }
];

test('project options support multi-select filters and sales product lines', () => {
  const options = productProjectFilterOptions(rows);
  assert.deepEqual(options.salesProductLines, ['-', '护理床', '轮椅']);
  assert.equal(filterProductProjectRows(rows, { responsibilityDepartment: ['产品一部', '产品二部'], salesProductLine: ['护理床'], keyword: 'A1' }).length, 1);
  assert.equal(filterProductProjectRows(rows, { projectStatus: ['规划'], innovationType: ['微创新'] }).length, 2);
  assert.equal(filterProductProjectRows(rows, { keyword: '技术评审' }).length, 1);
});

test('sales product line keeps the text before brackets and preserves dash', () => {
  assert.equal(salesProductLine('护理床（国内）'), '护理床');
  assert.equal(salesProductLine('轮椅(海外)'), '轮椅');
  assert.equal(salesProductLine('-'), '-');
  assert.equal(salesProductLine(''), '-');
});

test('mappingSuggestions recognizes standard Chinese headers', () => {
  const mapping = mappingSuggestions([{ name: '项目名称' }, { name: '事业部' }, { name: '1-需求立项' }, { name: '生产商（已重新盘点）' }]);
  assert.equal(mapping.projectName, '项目名称');
  assert.equal(mapping.businessUnit, '事业部');
  assert.equal(mapping.demandInitiationDate, '1-需求立项');
  assert.equal(mapping.manufacturer, '生产商（已重新盘点）');
});

test('dashboard metrics follow filtered project rows', () => {
  const metrics = summarizeProductProjectRows(rows.slice(0, 1), new Date('2026-08-14T00:00:00+08:00'));
  assert.equal(metrics.totalProjects, 1);
  assert.equal(metrics.responsibilityDepartments[0].label, '产品一部');
  assert.deepEqual(metrics.salesProductLines, [{ label: '护理床', value: 1 }]);
  assert.equal(metrics.launchWithin90Days, 1);
});
