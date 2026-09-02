import assert from 'node:assert/strict';
import test from 'node:test';
import xlsx from 'xlsx';
import {
  inspectProductProjectWorkbook,
  parseProductProjectWorkbook,
  PRODUCT_PROJECT_PRIMARY_SHEET
} from './product-project-workbook.js';

function projectWorkbook({ includePrimarySheet = true } = {}) {
  const workbook = xlsx.utils.book_new();
  if (includePrimarySheet) {
    const rows = [
      ['', '更新日：2026-8-12'],
      [], [], [], [], [],
      [
        '事业部', '项目名称', '优先级', '创新类型', '当前阶段', '阶段', '实际用时', '责任部门',
        '项目负责人', '技术对接人', '供应链对接人', '生产商\r\n（已重新盘点）', '项目类型', '产品线',
        '1-需求立项', '2-产品定义（产品部）', '3-产品设计（研发部）', '4-手板样（研发部）',
        '5-工艺评审(工艺部)', '6-开模（供应链中心）', '7-模具样（工艺部）', '8-工程样（工艺部）',
        '9-试产（供应链）', '项目文件', '项目待办', '本周周会纪要8-12'
      ],
      [
        '产品二部', '创新护理床', 'A', '绝对创新', '4-手板样', '', '', '产品二部', '张三', '李四', '王五',
        '供应商甲', '整机', '护理床', new Date(2026, 7, 1), '', '', '', '', '', '', '', new Date(2026, 11, 15), '文件A', '确认外观', '手板样待确认'
      ],
      [
        '', '微创新轮椅', 'B', '微创新', '已完结', '', '', '', '赵六', '', '', '', '整机', '轮椅',
        '', '', '', '', '', '', '', '', '2027年1月3日', '', '', ''
      ],
      ['', '说明文字']
    ];
    const sheet = xlsx.utils.aoa_to_sheet(rows);
    sheet['!merges'] = [xlsx.utils.decode_range('A8:A9')];
    xlsx.utils.book_append_sheet(workbook, sheet, PRODUCT_PROJECT_PRIMARY_SHEET);
  }
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([
    ['项目名称', '负责人'],
    ['不应混入的部件项目', '其他人']
  ]), '（部件）电控平台项目');
  return {
    originalname: '产研项目进度周期表.xlsx',
    buffer: xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  };
}

test('产品项目文件只解析重点工作表并自动映射项目字段', () => {
  const parsed = parseProductProjectWorkbook(projectWorkbook());
  assert.equal(parsed.sheetName, PRODUCT_PROJECT_PRIMARY_SHEET);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.summary.headerRow, 7);
  assert.equal(parsed.summary.workbookUpdateDate, '2026-08-12');
  assert.equal(parsed.rows[0].projectName, '创新护理床');
  assert.equal(parsed.rows[0].businessUnit, '产品二部');
  assert.equal(parsed.rows[0].productPositioning, '绝对创新');
  assert.equal(parsed.rows[0].projectStage, '4-手板样');
  assert.equal(parsed.rows[0].priority, 'A');
  assert.equal(parsed.rows[0].innovationType, '绝对创新');
  assert.equal(parsed.rows[0].responsibilityDepartment, '产品二部');
  assert.equal(parsed.rows[0].technicalContact, '李四');
  assert.equal(parsed.rows[0].supplyChainContact, '王五');
  assert.equal(parsed.rows[0].manufacturer, '供应商甲');
  assert.equal(parsed.rows[0].projectType, '整机');
  assert.equal(parsed.rows[0].productLine, '护理床');
  assert.equal(parsed.rows[0].demandInitiationDate, '2026-08-01');
  assert.equal(parsed.rows[0].weeklyMeetingTitle, '本周周会纪要8-12');
  assert.equal(parsed.rows[0].weeklyMeetingNote, '手板样待确认');
  assert.equal(parsed.rows[0].plannedLaunchDate, '2026-12-15');
  assert.equal(parsed.rows[0].projectStatus, '进行中');
  assert.match(parsed.rows[0].remark, /项目待办：确认外观/);
  assert.match(parsed.rows[0].remark, /本周周会纪要8-12：手板样待确认/);
  assert.equal(parsed.rows[1].businessUnit, '产品二部');
  assert.equal(parsed.rows[1].weeklyMeetingTitle, '本周周会纪要8-12');
  assert.equal(parsed.rows[1].weeklyMeetingNote, '');
  assert.equal(parsed.rows[1].projectStatus, '已完成');
  assert.equal(parsed.rows[1].plannedLaunchDate, '2027-01-03');
  assert.equal(parsed.rows.some((row) => row.projectName === '不应混入的部件项目'), false);
});

test('产品项目预览返回自动解析摘要', () => {
  const preview = inspectProductProjectWorkbook(projectWorkbook());
  assert.equal(preview.autoParsed, true);
  assert.equal(preview.parseSummary.parserType, 'productProject');
  assert.equal(preview.parseSummary.primarySheet, PRODUCT_PROJECT_PRIMARY_SHEET);
  assert.equal(preview.rowCount, 2);
});

test('缺少重点工作表时明确拒绝上传', () => {
  assert.throws(
    () => parseProductProjectWorkbook(projectWorkbook({ includePrimarySheet: false })),
    /未找到重点工作表/
  );
});
