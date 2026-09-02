import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const database = fs.readFileSync(path.join(root, 'server', 'database.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server', 'app.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src', 'InventoryRiskPage.jsx'), 'utf8');
const beiHuoPage = fs.readFileSync(path.join(root, 'src', 'BeiHuoGongJuPage.jsx'), 'utf8');
const appPage = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');

test('供应计划参数保存在腾讯云数据库并保留修改历史', () => {
  assert.match(database, /CREATE TABLE IF NOT EXISTS inventory_risk_settings/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS inventory_risk_setting_history/);
  assert.match(server, /function currentInventoryRiskSettings\(\)/);
  assert.match(server, /function saveInventoryRiskSettings\(input, userName\)/);
  assert.match(server, /ON CONFLICT\(setting_key\) DO UPDATE SET/);
  assert.match(server, /INSERT INTO inventory_risk_setting_history/);
  assert.match(server, /saveInventoryRiskSettings\(payload\.params \|\| req\.body, req\.user\.name\)/);
});

test('页面先读取腾讯云最后参数且只有重新计算才保存', () => {
  assert.match(server, /app\.get\('\/api\/inventory-risk\/params'/);
  assert.match(server, /req\.body\?\.saveParams[\s\S]*?saveInventoryRiskSettings/);
  assert.match(page, /apiRequest\('\/api\/inventory-risk\/params', token\)/);
  assert.match(page, /if \(active && paramsReady && !loaded && !loading\) calculate\(\)/);
  assert.match(page, /body: JSON\.stringify\(\{ \.\.\.params, force, saveParams: force \}\)/);
  assert.match(page, /onClick=\{\(\) => calculate\(true\)\}/);
  assert.match(page, /if \(active\) return;[\s\S]*?setParamsReady\(false\)[\s\S]*?setParamsLoadAttempted\(false\)/);
  assert.match(page, /\{paramsReady && \([\s\S]*?<RiskParameterMatrix/);
  assert.doesNotMatch(page, /localStorage|inventory-risk-params/);
});

test('备货工具使用独立页面权限、设置键、结果缓存和接口', () => {
  assert.match(server, /'beiHuoGongJu'/);
  assert.match(server, /beiHuoGongJu: '备货工具'/);
  assert.match(server, /BEI_HUO_GONG_JU_SETTING_KEY = 'beiHuoGongJu'/);
  assert.match(server, /let beiHuoGongJuResultCache = \{ key: '', payload: null \}/);
  assert.match(server, /function currentBeiHuoGongJuSettings\(\)/);
  assert.match(server, /function saveBeiHuoGongJuSettings\(input, userName\)/);
  assert.match(server, /function beiHuoGongJuData\(input = \{\}, \{ force = false \} = \{\}\)/);
  assert.match(server, /\[randomUUID\(\), BEI_HUO_GONG_JU_SETTING_KEY, paramsJson, updatedBy, updatedAt\]/);
  assert.match(server, /app\.get\('\/api\/bei-huo-gong-ju\/params', requireAuth, requirePage\('beiHuoGongJu'\)/);
  assert.match(server, /app\.post\('\/api\/bei-huo-gong-ju\/query', requireAuth, requirePage\('beiHuoGongJu'\)/);
  assert.match(server, /app\.post\('\/api\/bei-huo-gong-ju\/export', requireAuth, requirePage\('beiHuoGongJu'\)/);
  assert.match(server, /requestPath\.startsWith\('\/api\/bei-huo-gong-ju'\)/);
  assert.doesNotMatch(server, /function beiHuoGongJuData[\s\S]*?inventoryRiskResultCache/);
});

test('备货复核导航懒加载备货需求复核页面', () => {
  assert.match(appPage, /React\.lazy\(\(\) => import\('\.\/BeiHuoGongJuPage\.jsx'\)\)/);
  assert.match(appPage, /\{ title: '备货复核', pages: \['beiHuoGongJu', 'beiHuoReviewLibrary'\] \}/);
  assert.match(appPage, /shouldMount\('beiHuoGongJu'\)/);
  assert.match(beiHuoPage, /export default function BeiHuoGongJuPage/);
  assert.match(beiHuoPage, /apiRequest\('\/api\/bei-huo-gong-ju\/params', token\)/);
  assert.match(beiHuoPage, /apiRequest\('\/api\/bei-huo-gong-ju\/query', token/);
  assert.match(beiHuoPage, /\/api\/bei-huo-gong-ju\/export/);
  assert.match(beiHuoPage, /备货需求复核计算逻辑/);
  assert.doesNotMatch(beiHuoPage, /供应计划分析|\/api\/inventory-risk/);
});

test('备货文件导入注册独立页面权限与四个通用文件槽位', () => {
  assert.match(server, /'beiHuoReviewLibrary'/);
  assert.match(server, /beiHuoReviewLibrary: '备货文件导入'/);
  assert.match(server, /beiHuoReviewFile1: '国内事业部备货'/);
  assert.match(server, /beiHuoReviewFile4: '备用'/);
  assert.match(server, /slotId\.startsWith\('beiHuoReviewFile'\)/);
  assert.match(appPage, /const BEI_HUO_REVIEW_LIBRARY_SLOTS = \[/);
  assert.match(appPage, /\{ id: 'beiHuoReviewFile1', title: '国内事业部备货', fields: \[\] \}/);
  assert.match(appPage, /shouldMount\('beiHuoReviewLibrary'\)[\s\S]*?title="备货文件导入"[\s\S]*?gridColumns=\{4\}/);
});

test('备货需求复核读取国内备货文件并支持两种聚合模式', () => {
  assert.match(server, /\['beiHuoReviewFile1'\]/);
  assert.match(server, /\['物料编码', '品号', '物料编号', '物料代码', 'materialCode'\]/);
  assert.match(server, /buildBeiHuoReviewAnalysis\(\{/);
  assert.match(server, /input\.mode === 'model' \? 'model' : 'materialCode'/);
  assert.doesNotMatch(server, /\/api\/bei-huo-review\/stockup-requirement/);
  assert.match(beiHuoPage, /useState\('国内事业部'\)/);
  assert.match(beiHuoPage, /useState\('materialCode'\)/);
  assert.match(beiHuoPage, /<option value="materialCode">物料编码<\/option><option value="model">型号<\/option>/);
  assert.match(beiHuoPage, /<th>根据预测可销天数<\/th><th>根据以往销售可销天数<\/th>/);
  assert.match(beiHuoPage, /colSpan=\{15\}/);
  assert.doesNotMatch(beiHuoPage, /是否有备货需求|materialCodeSet/);
  assert.doesNotMatch(beiHuoPage, /处置规则|处置动作/);
  assert.doesNotMatch(beiHuoPage, /<RiskMultiSelectFilter label="渠道"/);
  assert.doesNotMatch(beiHuoPage, /<RiskMultiSelectFilter label="处置动作"/);
  assert.doesNotMatch(beiHuoPage, /<RiskMultiSelectFilter label="预测销售"/);
});
