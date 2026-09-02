import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverSource = fs.readFileSync(path.join(rootDir, 'server', 'app.js'), 'utf8');
const appSource = fs.readFileSync(path.join(rootDir, 'src', 'App.jsx'), 'utf8');
const pageSource = fs.readFileSync(path.join(rootDir, 'src', 'ProductArchivePage.jsx'), 'utf8');

test('产品档案和产品数据完成导航、权限与接口注册', () => {
  assert.match(serverSource, /productArchive:\s*'产品档案'/);
  assert.match(serverSource, /businessUnitFeedback:\s*'产品数据'/);
  assert.match(serverSource, /app\.get\('\/api\/product-archive', requireAuth, requirePage\('productArchive'\)/);
  assert.match(appSource, /pages: \['productArchive', 'businessUnitFeedback'\]/);
  assert.match(appSource, /shouldMount\('productArchive'\)/);
  assert.match(appSource, /shouldMount\('businessUnitFeedback'\)/);
});

test('产品数据提供八个四列槽位及产品项目专用映射', () => {
  assert.match(appSource, /'海外事业一部',[\s\S]*'海外事业二部',[\s\S]*'国内事业部'/);
  assert.match(appSource, /'产品项目',[\s\S]*'备用5'/);
  assert.match(appSource, /\['productLifecycle', '产品生命周期'\]/);
  assert.match(appSource, /\['productPositioning', '产品定位'\]/);
  assert.match(appSource, /\['projectName', '项目名称'\]/);
  assert.match(appSource, /productProjectWorkbook: true/);
  assert.doesNotMatch(appSource, /index === 3 \? \{ manualFieldSelection: true/);
  assert.match(appSource, /slots=\{BUSINESS_UNIT_FEEDBACK_SLOTS\} gridColumns=\{4\}/);
});

test('产品档案看板展示底表来源、反馈覆盖与核心筛选', () => {
  assert.match(pageSource, /底表来源/);
  assert.match(pageSource, /已有事业部数据的产品/);
  assert.match(pageSource, /待维护事业部×产品/);
  assert.match(pageSource, /label="产品生命周期"/);
  assert.match(pageSource, /label="产品定位"/);
  assert.match(pageSource, /label="事业部"/);
});

test('产品档案包含研发项目页签并优先读取产品项目文件槽位', () => {
  assert.match(pageSource, /在售产品档案/);
  assert.match(pageSource, /研发项目看板/);
  assert.match(pageSource, /产品数据-产品项目/);
  assert.match(serverSource, /PRODUCT_PROJECT_SLOT_ID = 'businessUnitFeedback4'/);
  assert.match(serverSource, /parseProductProjectWorkbook\(req\.file\)/);
  assert.match(serverSource, /inspectProductProjectWorkbook\(file\)/);
  assert.match(serverSource, /currentProductProjectFileData\(\)/);
  assert.match(serverSource, /sourceType: 'file'/);
  assert.match(serverSource, /app\.get\('\/api\/product-projects', requireAuth, requirePage\('productArchive'\)/);
  assert.match(pageSource, /生产商（已重新盘点）/);
  assert.match(pageSource, /1-需求立项/);
  assert.match(pageSource, /weeklyMeetingTitle/);
  assert.match(pageSource, /weeklyMeetingNote/);
});

test('研发项目看板按销售产品线分类并按指定顺序提供多选筛选和明细列', () => {
  assert.match(pageSource, /销售产品线分类/);
  assert.match(pageSource, /label="状态"[\s\S]*label="当前阶段"[\s\S]*label="责任部门"[\s\S]*label="销售产品线"[\s\S]*label="项目负责人"[\s\S]*label="创新类型"[\s\S]*product-archive-search/);
  assert.match(pageSource, /<th>状态<\/th><th>当前阶段<\/th><th>责任部门<\/th><th>销售产品线<\/th><th>项目负责人<\/th><th>创新类型<\/th><th>优先级<\/th><th>项目名称<\/th><th>技术对接人<\/th><th>供应链对接人<\/th><th>生产商（已重新盘点）<\/th><th>项目类型<\/th><th>1-需求立项<\/th><th>\{latestMeetingTitle\}<\/th><th>在售产品关联<\/th><th>修改时间<\/th>/);
  assert.match(pageSource, /dateText\(row\.sourceModifiedAt\)/);
});
