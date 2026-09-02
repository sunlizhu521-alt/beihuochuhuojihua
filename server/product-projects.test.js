import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectMetrics,
  extractDingTalkBaseId,
  linkProjectsToProducts,
  normalizeProjectRecords,
  shouldRunDailyProjectSync
} from './product-projects.js';

const mapping = {
  projectName: '项目名称', businessUnit: '事业部', projectStage: '阶段', plannedLaunchDate: '上市日期',
  materialCode: '物料编码', sku: 'SKU', modifiedAt: '修改时间'
};

test('extractDingTalkBaseId supports base links and direct ids', () => {
  assert.equal(extractDingTalkBaseId('https://alidocs.dingtalk.com/i/nodes/base123?x=1'), 'base123');
  assert.equal(extractDingTalkBaseId('base456'), 'base456');
});

test('normalizeProjectRecords drops missing names and keeps newest duplicate', () => {
  const result = normalizeProjectRecords([
    { id: '1', fields: { 项目名称: '旧项目', 事业部: '国内事业部', 物料编码: '1001', 修改时间: '2026-01-01' } },
    { id: '2', fields: { 项目名称: '新项目', 事业部: '国内事业部', 物料编码: '1001', 修改时间: '2026-02-01' } },
    { id: '3', fields: { 事业部: '国内事业部' } }
  ], mapping);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].projectName, '新项目');
  assert.equal(result.report.duplicateCount, 1);
  assert.equal(result.report.missingNameCount, 1);
});

test('normalizeProjectRecords preserves product project workbook detail fields', () => {
  const detailMapping = {
    projectName: '项目名称',
    priority: '优先级',
    innovationType: '创新类型',
    responsibilityDepartment: '责任部门',
    technicalContact: '技术对接人',
    supplyChainContact: '供应链对接人',
    manufacturer: '生产商',
    projectType: '项目类型',
    productLine: '产品线',
    demandInitiationDate: '1-需求立项',
    weeklyMeetingTitle: '周会标题',
    weeklyMeetingNote: '周会纪要'
  };
  const result = normalizeProjectRecords([{ id: 'detail-1', fields: {
    项目名称: '护理床项目', 优先级: 'A', 创新类型: '绝对创新', 责任部门: '产品一部',
    技术对接人: '张三', 供应链对接人: '李四', 生产商: '供应商甲', 项目类型: '整机',
    产品线: '护理床', '1-需求立项': '2026-08-12', 周会标题: '本周周会纪要8-12', 周会纪要: '完成评审'
  } }], detailMapping);
  assert.equal(result.rows[0].priority, 'A');
  assert.equal(result.rows[0].responsibilityDepartment, '产品一部');
  assert.equal(result.rows[0].manufacturer, '供应商甲');
  assert.equal(result.rows[0].demandInitiationDate.slice(0, 10), '2026-08-12');
  assert.equal(result.rows[0].weeklyMeetingTitle, '本周周会纪要8-12');
  assert.equal(result.rows[0].weeklyMeetingNote, '完成评审');
});

test('linkProjectsToProducts prioritizes material and detects conflicts', () => {
  const products = [{ id: 'a', materialCode: '1001', sku: 'A' }, { id: 'b', materialCode: '1002', sku: 'B' }];
  const [linked, conflict] = linkProjectsToProducts([
    { materialCode: '1001', sku: '' }, { materialCode: '1001', sku: 'B' }
  ], products);
  assert.equal(linked.linkStatus, '已关联');
  assert.equal(linked.linkedProductId, 'a');
  assert.equal(conflict.linkStatus, '关联冲突');
});

test('buildProjectMetrics counts 90-day launches', () => {
  const metrics = buildProjectMetrics([
    { businessUnit: '国内', responsibilityDepartment: '产品一部', projectStage: '立项', productLine: '护理床（国内）', demandInitiationDate: '2026-08-20' },
    { businessUnit: '海外', responsibilityDepartment: '产品二部', projectStage: '测试', productLine: '-', demandInitiationDate: '2027-01-20' }
  ], new Date('2026-08-14T00:00:00+08:00'));
  assert.equal(metrics.totalProjects, 2);
  assert.equal(metrics.businessUnitCount, 2);
  assert.deepEqual(metrics.salesProductLines, [{ label: '-', value: 1 }, { label: '护理床', value: 1 }]);
  assert.equal(metrics.launchWithin90Days, 1);
});

test('daily sync only runs once after Shanghai 00:30', () => {
  assert.equal(shouldRunDailyProjectSync({ now: new Date('2026-08-13T16:20:00Z') }), false);
  assert.equal(shouldRunDailyProjectSync({ now: new Date('2026-08-13T16:30:00Z') }), true);
  assert.equal(shouldRunDailyProjectSync({ now: new Date('2026-08-13T16:31:00Z'), lastSuccessAt: '2026-08-14T00:30:00+08:00' }), false);
});
