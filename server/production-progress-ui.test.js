import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server', 'app.js'), 'utf8');
const databaseSource = fs.readFileSync(path.join(root, 'server', 'database.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

test('生产跟进显示采购订单匹配的供应商简称且不再提供供应家数筛选', () => {
  assert.match(appSource, /function progressSupplierName\(row\)\s*\{\s*return normalize\(row\.orderSupplierShortName\) \|\| '未匹配';/);
  assert.match(appSource, /function uniqueSupplierShortNames\(values\)[\s\S]*?left === '未匹配'[\s\S]*?right === '未匹配'/);
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  assert.match(progressSource, /progressSupplierName\(row\)/);
  assert.match(progressSource, /label="供应商简称" allLabel="全部供应商简称"/);
  assert.match(progressSource, /'供应商简称',[\s\S]*?'事业部'/);
  assert.doesNotMatch(progressSource, /\bunique\(clearFilterRows/);
  assert.match(progressSource, /uniqueProgressValues\(clearFilterRows/);
  assert.match(progressSource, /suppliers: uniqueSupplierShortNames\(clearFilterRows\('suppliers'\)/);
  const filterBarSource = appSource.slice(appSource.indexOf('function FilterBar('), appSource.indexOf('function Login('));
  assert.doesNotMatch(filterBarSource, /label="是否多家供应"/);
  assert.doesNotMatch(filterBarSource, /filters\.supplierCount|options\.supplierCounts/);
});

test('生产跟进四阶段、履约字段和导出状态完整呈现', () => {
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressEditor('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  ['未备料未生产', '已备料未生产', '生产中产品', '完工未发产品'].forEach((label) => {
    assert.match(progressSource, new RegExp(label));
  });
  assert.match(progressSource, /运营备货数量/);
  assert.match(progressSource, /合同约定交期/);
  assert.match(progressSource, /生产中交付时间/);
  assert.match(progressSource, /未生产预计交付时间/);
  assert.match(progressSource, /是否正常履约/);
  assert.match(progressSource, /跟单备注/);
  assert.match(progressSource, /正常履约金额/);
  assert.match(progressSource, /非正常履约金额/);
  assert.match(progressSource, /未履约原因/);
  assert.match(progressSource, /待人工调整/);
  assert.match(progressSource, /导出中 \$\{exportProgress\}%/);
  assert.match(progressSource, /writeStyledExcelFile/);
  assert.match(progressSource, /'供应商', '供应商简称'/);
  assert.match(progressSource, /row\.supplier \|\| '未填写',[\s\S]*?progressSupplierName\(row\)/);
  assert.match(progressSource, /来自金蝶采购订单累计入库数量，不能手动修改/);
  assert.doesNotMatch(progressSource, /shippedQty: numberValue\(nextValues\.shippedQty\)/);
  assert.doesNotMatch(progressSource, /quantityInput\('shippedQty'/);
  assert.match(serverSource, /const orderQty = orderNo \? systemOrderQuantities\(demand\.demand_key, orderNo, demand\.material_code\) : null/);
  assert.match(serverSource, /const purchaseOrderInboundQty = orderQty[\s\S]*?numberValue\(orderQty\.inboundQty\)[\s\S]*?numberValue\(demand\.tracking_inbound_qty\)/);
  assert.match(serverSource, /const remainingInboundQty = orderQty[\s\S]*?numberValue\(orderQty\.remainingQty\)[\s\S]*?numberValue\(demand\.tracking_remaining_qty\)/);
  assert.match(serverSource, /shipped: purchaseOrderInboundQty/);
  assert.doesNotMatch(serverSource, /numberValue\(req\.body\.shippedQty\)/);
  assert.match(serverSource, /function contractDateOnly\(value\)/);
  assert.match(serverSource, /contractDateOnly\(row\.deliveryDate \|\| row\.delivery_date\)/);
  assert.match(serverSource, /const currentKingdeeOrderKeys = new Set/);
  assert.match(serverSource, /const currentKingdeeOrderNos = new Set/);
  assert.match(serverSource, /currentKingdeeOrderKeys\.has\(kingdeeOrderIdentity\(first\.demandKey, first\.orderNo\)\)/);
  assert.match(serverSource, /currentKingdeeOrderNos\.has\(first\.orderNo\)/);
  assert.match(serverSource, /const visibleSystemRows = systemRows\.map/);
  assert.match(serverSource, /const remainingInboundQty = rows\.reduce\(\(sum, r\) => sum \+ numberValue\(r\.manualRemainingQty\), 0\)/);
  assert.match(serverSource, /const shippedQty = rows\.reduce\(\(sum, r\) => sum \+ numberValue\(r\.sourceShippedQty\), 0\)/);
  assert.match(serverSource, /const unpreparedQty = rows\.reduce\(\(sum, r\) => sum \+ numberValue\(r\.unpreparedQty\), 0\)/);
  assert.match(serverSource, /const preparedNotStartedQty = rows\.reduce\(\(sum, r\) => sum \+ numberValue\(r\.preparedNotStartedQty\), 0\)/);
  assert.match(serverSource, /const inProductionQty = rows\.reduce\(\(sum, r\) => sum \+ numberValue\(r\.inProductionQty\), 0\)/);
  assert.match(serverSource, /const finishedQty = rows\.reduce\(\(sum, r\) => sum \+ numberValue\(r\.finishedQty\), 0\)/);
  assert.match(serverSource, /const manualRows = \[\.\.\.groups\.values\(\)\]\.map\([\s\S]*?\}\)\.filter\(Boolean\)/);
  assert.match(serverSource, /groupCurrentKingdeeOrderRows\(sourceRows\)/);
  assert.match(serverSource, /operationOrderLevel: true/);
  assert.match(serverSource, /if \(!allOrderRows\.length\) return \{/);
  assert.match(serverSource, /return operationOrderBreakdown\(row, allOrderRows, context\.orderChangeIndex\)\.map/);
  assert.match(serverSource, /const normalFulfillmentAmount = rows\.reduce\(\(sum, row\) => sum \+ row\.sourceNormalAmount, 0\)/);
  assert.match(serverSource, /purchaseOwnersForSupplierShortNames/);
  assert.match(progressSource, /numberValue\(row\.normalFulfillmentAmount\)/);
  assert.match(progressSource, /ProgressColumnSelector/);
  assert.match(progressSource, /gendanjindu:progress-columns:/);
  assert.match(progressSource, /defaultProgressColumnKeys\(\)/);
  assert.match(progressSource, /不含税采购价/);
  assert.match(appSource, /配件无采购价/);
  assert.doesNotMatch(progressSource.slice(progressSource.indexOf('<DataTable'), progressSource.indexOf('function DifferenceAllocationPage(')), /'采购组'/);
  assert.match(serverSource, /const displayRows = includeInactive[\s\S]*?return displayRows;\n}/);
  assert.doesNotMatch(serverSource, /return displayRows\.filter\(\(row\) => !row\.adminOnly && canEditDemand\(user/);
  assert.match(serverSource, /app\.patch\('\/api\/progress\/:demandKey'[\s\S]*?if \(!canEditDemand\(req\.user/);
});

test('生产跟进展示当前金蝶所有剩余未交付非零订单', () => {
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  assert.match(progressSource, /numberValue\(row\.remainingInboundQty\) !== 0/);
  assert.match(progressSource, /row\.rowKey \|\| row\.demandKey/);
  assert.match(serverSource, /dataSource: '金蝶系统'/);
  assert.doesNotMatch(serverSource.slice(
    serverSource.indexOf('function operationOrderBreakdown('),
    serverSource.indexOf('function demandRows(')
  ), /effectiveOrderCondition === '有效订单'/);
});

test('采购未交付变化时保留四阶段原值并按四列合计标记差额', () => {
  const modelSource = serverSource.slice(
    serverSource.indexOf('function progressAfterInbound('),
    serverSource.indexOf('function hasManualProgressHistory(')
  );
  assert.doesNotMatch(modelSource, /unprepared \+= remainingInboundQty - progressTotal/);
  assert.match(modelSource, /productionStageGap\(remainingInboundQty, unprepared, preparedNotStarted, inProduction, finished\)/);
  assert.match(serverSource, /function productionStageGap[\s\S]*?numberValue\(inProductionQty\) \+ numberValue\(finishedQty\)/);
  assert.match(serverSource, /const stageTotalQty = requestedUnprepared \+ preparedNotStarted \+ inProduction \+ finished/);
  assert.match(serverSource, /Math\.abs\(stageTotalQty - remainingInboundQty\) > 0\.000001/);
  assert.doesNotMatch(serverSource, /const allProductionStagesZero = requestedUnprepared \+ preparedNotStarted \+ inProduction/);
});

test('生产跟进表格使用清晰竖线和交替行色', () => {
  assert.match(styleSource, /\.progress-table th,[\s\S]*?border-right: 1px solid #d5dee9/);
  assert.match(styleSource, /\.progress-table tbody tr:nth-child\(odd\):not\(\.progress-row-adjustment\) > td/);
  assert.match(styleSource, /\.progress-table tbody tr:nth-child\(even\):not\(\.progress-row-adjustment\) > td/);
  assert.match(styleSource, /\.progress-table tbody tr:nth-child\(even\):not\(\.progress-row-adjustment\) input:not\(\[type="checkbox"\]\)/);
  assert.match(styleSource, /\.progress-row-adjustment > td[\s\S]*?background: #fff1f2 !important/);
});

test('生产跟进删除供应家数、分配状态和数据状态筛选器', () => {
  const filterSource = appSource.slice(
    appSource.indexOf('function useFilteredDemands('),
    appSource.indexOf('function Login(')
  );
  ['是否多家供应', '分配状态', '数据状态'].forEach((label) => {
    assert.doesNotMatch(filterSource, new RegExp(`label="${label}"`));
  });
  assert.doesNotMatch(filterSource, /filters\.(?:supplierCount|allocationStatus|dataStatus)/);
  assert.doesNotMatch(filterSource, /(?:supplierCounts|allocationStatuses|dataStatuses):/);
});

test('production progress filters support linked multi-select options', () => {
  const filterSource = appSource.slice(
    appSource.indexOf('function defaultProgressFilters('),
    appSource.indexOf('function Login(')
  );
  assert.match(filterSource, /supplier: \[\], purchaseOrg: \[\], businessUnit: \[\]/);
  assert.doesNotMatch(filterSource, /month: \[\]|originalMonth: \[\]/);
  assert.match(filterSource, /orderType: \[\]/);
  assert.match(filterSource, /const rowsFor = \(field\) => rows\.filter\(\(row\) => matchesFilters\(row, field\)\)/);
  assert.match(filterSource, /suppliers: uniqueSupplierShortNames\(rowsFor\('supplier'\)/);
  assert.match(filterSource, /purchaseOwners: uniqueProgressValues\(rowsFor\('purchaseOwner'\)/);
  assert.match(filterSource, /matchesSelected\(filters\.supplier, displaySupplier\)/);
  assert.match(filterSource, /matchesSelected\(filters\.purchaseOwner, row\.purchaseOwner\)/);
  assert.match(filterSource, /<MultiSelectFilter label="供应商简称"/);
  assert.match(filterSource, /<MultiSelectFilter label="采购下单人"/);
  assert.doesNotMatch(filterSource, /<SelectField label="(?:供应商简称|采购下单人)"/);
});

test('生产跟进支持成品和配件联动筛选', () => {
  const filterSource = appSource.slice(
    appSource.indexOf('function defaultProgressFilters('),
    appSource.indexOf('function Login(')
  );
  const filterBarSource = appSource.slice(
    appSource.indexOf('function FilterBar('),
    appSource.indexOf('function Login(')
  );
  assert.match(filterSource, /purchaseOwner: \[\], productType: \[\]/);
  assert.match(filterSource, /omit === 'productType'[\s\S]*?row\.productLine === '其他\/配件' \? '配件' : '成品'/);
  assert.match(filterSource, /productTypes: \['成品', '配件'\]/);
  assert.doesNotMatch(filterSource, /productTypes: \['成品', '配件'\]\.filter/);
  assert.match(filterSource, /productType: options\.productTypes/);
  assert.match(filterSource, /label="成品\/配件" allLabel="全部类型"[\s\S]*?value=\{filters\.productType\}[\s\S]*?options=\{options\.productTypes\}/);
  assert.match(filterSource, /function defaultProgressFilters\(\)[\s\S]*?productType: \[\]/);
  assert.ok(
    filterBarSource.indexOf('label="成品/配件"') < filterBarSource.indexOf('label="采购组织"'),
    '成品/配件筛选器应位于生产跟进筛选栏最前面'
  );
});

test('生产跟进恢复订单类型筛选并继续去掉新旧下单月份筛选', () => {
  const filterSource = appSource.slice(
    appSource.indexOf('function useFilteredDemands('),
    appSource.indexOf('function Login(')
  );
  const progressSource = appSource.slice(
    appSource.indexOf('const PROGRESS_COLUMNS'),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  assert.doesNotMatch(filterSource, /filters\.(?:month|originalMonth)/);
  assert.doesNotMatch(filterSource, /options\.(?:months|originalMonths)/);
  assert.doesNotMatch(filterSource, /label="(?:新下单月份|原下单月份)"/);
  assert.match(filterSource, /matchesSelected\(filters\.orderType, row\.orderType \|\| '正常订单'\)/);
  assert.match(filterSource, /orderTypes: \['正常订单', '内部交易订单', '订单变更', '变更待核验'\]/);
  assert.match(filterSource, /label="订单类型" allLabel="全部订单类型"/);
  assert.ok(
    filterSource.indexOf('label="成品/配件"') < filterSource.indexOf('label="订单类型"'),
    '订单类型筛选器应紧跟在成品/配件筛选器后面'
  );
  assert.match(appSource, /function MonthCalendarFilter\([\s\S]*?showWhenEmpty = false[\s\S]*?availableOptions\.length === 0 && !showWhenEmpty/);
  assert.match(filterSource, /row\.originalOrderNo/);
  ['订单类型', '下单月份', '当前订单采购数量', '原采购订单号', '原订单创建日期', '原订单采购数量', '变更校验'].forEach((label) => {
    assert.match(progressSource, new RegExp(label));
  });
});

test('生产跟进筛选、方案和页码刷新后保留且搜索由按钮触发', () => {
  const filterSource = appSource.slice(
    appSource.indexOf('function defaultProgressFilters('),
    appSource.indexOf('function Login(')
  );
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  const searchButtonIndex = filterSource.indexOf('>搜索</button>');
  const clearButtonIndex = filterSource.indexOf('>清空筛选</button>');

  assert.match(appSource, /function useSessionFilters\(cacheKey, initialFilters\)[\s\S]*?window\.sessionStorage\.getItem\(storageKey\)[\s\S]*?window\.sessionStorage\.setItem\(storageKey/);
  assert.match(filterSource, /if \(!rows\.length\) return;/);
  assert.match(filterSource, /const \[keywordDraft, setKeywordDraft\] = useState\(filters\.keyword \|\| ''\)/);
  assert.match(filterSource, /value=\{keywordDraft\}[\s\S]*?onChange=\{\(event\) => setKeywordDraft\(event\.target\.value\)\}/);
  assert.doesNotMatch(filterSource, /onChange=\{\(event\) => setFilters\(\{ \.\.\.filters, keyword:/);
  assert.ok(searchButtonIndex >= 0 && searchButtonIndex < clearButtonIndex, '搜索按钮应在清空筛选前面');
  assert.match(filterSource, /onClick=\{\(\) => onSearch\?\.\(keywordDraft\)\}/);
  assert.match(filterSource, /function readProgressViewState\(storageKey\)/);
  assert.match(progressSource, /gendanjindu:progress-view:v1:\$\{filterCacheKey\}:\$\{user\?\.id \|\| user\?\.name \|\| 'user'\}/);
  assert.match(progressSource, /window\.sessionStorage\.setItem\(progressViewStorageKey, JSON\.stringify\(\{ currentPage, groupMode \}\)\)/);
  assert.match(progressSource, /if \(!filterEffectReady\.current\)[\s\S]*?return;/);
  assert.match(progressSource, /function applyProgressSearch\(keyword\)[\s\S]*?searchOriginPage\.current = currentPage/);
  assert.match(progressSource, /requestedFilterPage\.current = currentKeyword && !nextKeyword \? searchOriginPage\.current : 1/);
  assert.match(progressSource, /onSearch=\{applyProgressSearch\}[\s\S]*?onClear=\{clearProgressFilters\}/);
});

test('生产跟进数量口径说明包含订单变更完整规则', () => {
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  ['订单类型与下单数量口径', '正常订单：', '订单变更：', '变更单月份：', '变更单下单数量：', '变更待核验：', '原订单展示规则：', '汇总方式：'].forEach((label) => {
    assert.match(progressSource, new RegExp(label));
  });
  assert.match(progressSource, /原订单必须存在于当前采购订单表，供应商一致，并且“手工关闭=是”/);
  assert.doesNotMatch(progressSource, /供应商和物料编码一致/);
  assert.match(progressSource, /手工关闭=是/);
  assert.match(styleSource, /\.progress-order-change-rules/);
  assert.match(styleSource, /\.progress-order-type\.type-pending/);
});

test('金蝶导入保存备注和手工关闭并为生产跟进构建当前批次变更索引', () => {
  assert.match(databaseSource, /order_remark TEXT NOT NULL DEFAULT ''/);
  assert.match(databaseSource, /manual_close TEXT NOT NULL DEFAULT ''/);
  assert.match(databaseSource, /\['order_remark', "TEXT NOT NULL DEFAULT ''"\]/);
  assert.match(databaseSource, /\['manual_close', "TEXT NOT NULL DEFAULT ''"\]/);
  assert.match(serverSource, /pickMapped\(row, mapping, 'orderRemark', \['备注'\]\)/);
  assert.match(serverSource, /pickMapped\(row, mapping, 'manualClose', \['手工关闭'\]\)/);
  assert.match(serverSource, /order_remark, manual_close, raw_json/);
  assert.match(serverSource, /buildOrderChangeIndex\(currentOrderRows\)/);
  assert.match(serverSource, /classifyOrderChange\(\{/);
  assert.match(serverSource, /operationOrderBreakdown\(row, allOrderRows, context\.orderChangeIndex\)/);
  assert.match(serverSource, /reportingMonth/);
  assert.match(serverSource, /originalPurchaseQty/);
});

test('多选筛选弹层使用 portal 避免被生产跟进横向筛选栏裁剪', () => {
  const multiFilterSource = appSource.slice(
    appSource.indexOf('function MultiSelectFilter('),
    appSource.indexOf('function MonthCalendarFilter(')
  );
  assert.match(appSource, /import \{ createPortal \} from 'react-dom'/);
  assert.match(multiFilterSource, /createPortal\(/);
  assert.match(multiFilterSource, /style=\{\{ position: 'fixed', zIndex: 10000, \.\.\.menuPosition \}\}/);
  assert.match(multiFilterSource, /!menuRef\.current\?\.contains\(event\.target\)/);
  assert.match(multiFilterSource, /window\.addEventListener\('scroll', updateMenuPosition, true\)/);
});

test('创建月份弹层使用 portal 避免被生产跟进横向筛选栏裁剪', () => {
  const monthFilterSource = appSource.slice(
    appSource.indexOf('function MonthCalendarFilter('),
    appSource.indexOf('function FieldMapping(')
  );
  assert.match(monthFilterSource, /createPortal\(/);
  assert.match(monthFilterSource, /className="filter-menu month-calendar-menu"/);
  assert.match(monthFilterSource, /style=\{\{ position: 'fixed', zIndex: 10000, \.\.\.menuPosition \}\}/);
  assert.match(monthFilterSource, /!menuRef\.current\?\.contains\(event\.target\)/);
  assert.match(monthFilterSource, /window\.addEventListener\('scroll', updateMenuPosition, true\)/);
});

test('生产跟进汇总父行展示供应商订单状态月份原订单产品线系列和采购数量', () => {
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  const parentSummarySource = progressSource.slice(
    progressSource.indexOf('className="progress-order-toggle"'),
    progressSource.indexOf('{expanded && (', progressSource.indexOf('className="progress-order-toggle"'))
  );
  assert.match(progressSource, /className="supplier-filter-link"[\s\S]*?\{supplierLabel\}/);
  assert.doesNotMatch(progressSource, /供应商简称：/);
  assert.match(progressSource, /订单状态：\{orderTypeLabel\}/);
  assert.match(progressSource, /原采购月份：\{originalOrderMonthLabel\}/);
  assert.match(progressSource, /原采购订单号：\{originalOrderNoLabel\}/);
  assert.match(progressSource, /新采购月份：\{currentOrderMonthLabel\}/);
  assert.match(progressSource, /当前采购订单号：\{currentOrderNoLabel\}/);
  assert.match(progressSource, /产品线：\{productLineLabel\}/);
  assert.match(progressSource, /系列：\{productSeriesLabel\}/);
  assert.match(progressSource, /原订单采购数量：\{originalPurchaseQtyLabel\}/);
  assert.doesNotMatch(parentSummarySource, /物料：|SKU：|产品：/);
  assert.match(progressSource, /订单数：\{group\.orderNos\.size\}/);
  assert.match(progressSource, /下单数量：不计入汇总/);
  assert.match(progressSource, /group\.reportingPurchaseQty\.toLocaleString\('zh-CN'\)/);
  assert.match(progressSource, /originalOrderNos: new Set\(\)/);
  assert.match(progressSource, /originalOrderMonths: new Set\(\)/);
  assert.match(progressSource, /currentOrderMonths: new Set\(\)/);
  assert.match(progressSource, /row\.originalOrderMonth \|\| \(row\.originalOrderNo \? row\.reportingMonth : ''\)/);
  assert.match(progressSource, /normalize\(row\.month\) \|\| normalize\(row\.currentOrderDate\)\.slice\(0, 7\)/);
  assert.match(progressSource, /originalQuantityKeys: new Set\(\)/);
  assert.match(progressSource, /group\.originalQuantityKeys\.has\(originalQuantityKey\)/);
  assert.match(progressSource, /group\.originalPurchaseQty \+= numberValue\(row\.originalPurchaseQty\)/);
  assert.match(styleSource, /\.kingdee-progress-page \.progress-order-toggle\s*\{[\s\S]*?flex-wrap: wrap/);
});

test('生产跟进父汇总月份显示为中文年月', () => {
  const helperSource = appSource.slice(
    appSource.indexOf('function formatProgressMonthLabel('),
    appSource.indexOf('function uniqueSupplierShortNames(')
  );
  assert.match(helperSource, /month\.match\(\/\^\(\\d\{4\}\)-\(\\d\{1,2\}\)\//);
  assert.match(helperSource, /`\$\{match\[1\]\}年\$\{match\[2\]\.padStart\(2, '0'\)\}月`/);
});

test('生产跟进支持新月份、原月份与供应商三级汇总并切换分页', () => {
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  assert.match(progressSource, /const \[groupMode, setGroupMode\] = useState\(initialProgressView\.groupMode\)/);
  assert.match(progressSource, /const summaryGroups = useMemo\(\(\) => \{[\s\S]*?const key = row\.orderNo[\s\S]*?`order:\$\{row\.orderNo\}`[\s\S]*?`manual:/);
  assert.match(progressSource, /supplierShortNames: new Set\(\)[\s\S]*?reportingMonths: new Set\(\)[\s\S]*?materialCodes: new Set\(\)/);
  assert.match(progressSource, /group\.materialCode = \[\.\.\.group\.materialCodes\]\.join\('、'\)/);
  assert.match(progressSource, /orderNos: new Set\(\)[\s\S]*?group\.orderNos\.add\(row\.orderNo\)/);
  assert.match(progressSource, /quantityKeys: new Set\(\)[\s\S]*?quantityOrderNo[\s\S]*?group\.quantityKeys\.has\(quantityKey\)/);
  assert.match(progressSource, /const supplierGroups = useMemo\(\(\) => \{[\s\S]*?summaryGroups\.forEach\(\(orderGroup\) =>/);
  assert.match(progressSource, /addOrderGroupToSupplierRollup\(supplierGroup, orderGroup\)[\s\S]*?supplierGroup\.months\.set\(monthKey, monthGroup\)/);
  assert.match(progressSource, /const activeGroups = groupMode === 'supplier' \? supplierGroups : summaryGroups/);
  assert.match(progressSource, /Math\.ceil\(activeGroups\.length \/ pageSize\)/);
  assert.match(progressSource, /activeGroups\.slice\(\(currentPage - 1\) \* pageSize, currentPage \* pageSize\)/);
  assert.match(progressSource, />按新下单月份<\/button>/);
  assert.match(progressSource, />按原下单月份<\/button>/);
  assert.match(progressSource, />按供应商<\/button>/);
  assert.match(progressSource, /className="progress-scheme-heading"[\s\S]*?<strong>筛选方案<\/strong>[\s\S]*?<small>根据习惯选择任意一个<\/small>/);
  assert.doesNotMatch(progressSource, /<strong>我的方案<\/strong>/);
  assert.match(progressSource, /className=\{groupMode === 'supplier' \? 'active' : ''\}[\s\S]*?setGroupMode\('supplier'\)[\s\S]*?resetProgressGroupExpansion\(\)[\s\S]*?setCurrentPage\(1\)/);
  assert.match(progressSource, /每页 20 个\{groupMode === 'supplier' \? '供应商汇总组' : '下单汇总组'\}/);
  assert.match(styleSource, /\.progress-scheme-bar button\.active\s*\{[\s\S]*?color: #246bdb/);
  assert.match(styleSource, /\.progress-scheme-heading\s*\{[\s\S]*?flex-direction: column/);
});

test('生产跟进同一采购订单号只生成一个汇总父行', () => {
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  assert.match(progressSource, /const key = row\.orderNo\s*\? `order:\$\{row\.orderNo\}`/);
  assert.match(progressSource, /group\.rows\.push\(row\)/);
  assert.match(progressSource, /采购订单号：\{currentOrderNoLabel\}/);
  assert.match(progressSource, /group\.rows\.map\(\(row\) => \(/);
});

test('生产跟进汇总按新月份、原月份或供应商排序且简称可点击筛选', () => {
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  assert.match(appSource, /function compareProgressMonths\(left, right\)/);
  assert.match(progressSource, /groupMode === 'originalMonth'[\s\S]*?group\.originalOrderMonth[\s\S]*?group\.currentOrderMonth/);
  assert.match(progressSource, /groupMode === 'supplier'[\s\S]*?left\.supplierShortName\.localeCompare\(right\.supplierShortName/);
  assert.match(progressSource, /compareProgressMonths\(left\.currentOrderMonth, right\.currentOrderMonth\)/);
  assert.match(progressSource, /className=\{`progress-order-toggle\$\{supplierNested \? ' progress-supplier-order-toggle' : ''\}`\}[\s\S]*?role="button"[\s\S]*?tabIndex=\{0\}/);
  assert.match(progressSource, /className="supplier-filter-link"[\s\S]*?event\.stopPropagation\(\)[\s\S]*?supplier: uniqueSupplierShortNames\(group\.rows\.map\(\(row\) => progressSupplierName\(row\)\)\)/);
  assert.match(styleSource, /\.supplier-filter-link\s*\{[\s\S]*?color: #2563eb/);
  assert.doesNotMatch(progressSource, /<button[^>]*className="progress-order-toggle"[\s\S]*?<button[^>]*className="supplier-filter-link"/);
});

test('生产跟进去掉供应商标签栏和只看按钮', () => {
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  assert.doesNotMatch(progressSource, /supplier-tags-bar|supplier-tag|activeSupplier/);
  assert.doesNotMatch(progressSource, /supplier-lookonly-btn/);
  assert.doesNotMatch(progressSource, />\s*只看\s*<\/button>/);
  assert.doesNotMatch(styleSource, /\.supplier-tags-bar|\.supplier-tag(?:\W|$)/);
  assert.doesNotMatch(styleSource, /\.supplier-lookonly-btn/);
});

test('生产跟进隐藏公共导航和通用布局并提供返回与退出入口', () => {
  const appRenderSource = appSource.slice(appSource.indexOf('function App()'));
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );

  assert.match(appRenderSource, /const progressStandalone = activeTab === 'progressRefresh'/);
  assert.match(appRenderSource, /className=\{progressStandalone \? 'progress-standalone-shell' : 'app-shell'\}/);
  assert.match(appRenderSource, /\{!progressStandalone && \(\s*<aside className="sidebar"/);
  assert.match(appRenderSource, /className=\{progressStandalone \? 'progress-standalone-content' : 'content'\}/);
  assert.match(appRenderSource, /onExit=\{progressReturnPage \? \(\) => setActiveTab\(progressReturnPage\) : null\}/);
  assert.match(appRenderSource, /onLogout=\{logout\}/);
  assert.doesNotMatch(appRenderSource, /kingdee-shell/);
  assert.match(progressSource, />返回系统<\/button>/);
  assert.match(progressSource, />退出登录<\/button>/);
  assert.match(styleSource, /\.progress-standalone-shell\s*\{[\s\S]*?min-height: 100vh/);
  assert.match(styleSource, /\.progress-standalone-content\s*\{[\s\S]*?min-height: 100vh[\s\S]*?overflow: auto/);
});

test('清除跟单数据仅孙立柱可见且后端接口同步限制账号', () => {
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );

  assert.match(progressSource, /const isSystemOwner = user\?\.role === '管理员' && normalize\(user\?\.name\) === '孙立柱'/);
  assert.match(progressSource, /!onlyIssues && isSystemOwner && \([\s\S]*?清除跟单数据/);
  assert.match(progressSource, /clearPanelOpen && isSystemOwner/);
  assert.match(serverSource, /function requireSystemOwner\(req, res, next\)[\s\S]*?req\.user\?\.role === ROLE_ADMIN[\s\S]*?normalize\(req\.user\?\.name\) === normalize\(ADMIN_NAME\)/);
  assert.match(serverSource, /app\.post\('\/api\/progress\/clear-preview', requireAuth, requirePage\('progressRefresh'\), requireSystemOwner/);
  assert.match(serverSource, /app\.post\('\/api\/progress\/clear', requireAuth, requirePage\('progressRefresh'\), requireSystemOwner/);
});

test('生产跟进不再展示任何柱形图', () => {
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  const operationSource = appSource.slice(
    appSource.indexOf('function Dashboard('),
    appSource.indexOf('function DifferencePage(')
  );
  assert.doesNotMatch(progressSource, /<ProgressStackedChart/);
  assert.doesNotMatch(progressSource, /className="progress-chart-grid"/);
  assert.match(operationSource, /<ProgressStackedChart/);
});

test('差异分配作为采购跟单入口并复用生产跟进权限', () => {
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  const navigationSource = appSource.slice(0, appSource.indexOf('const DIMENSION_SLOTS'));
  const appRenderSource = appSource.slice(appSource.indexOf('function App()'));

  assert.match(navigationSource, /'progressRefresh',[\s\S]*?'differenceAllocation'/);
  assert.match(navigationSource, /differenceAllocation: '差异分配'/);
  assert.match(navigationSource, /const PROGRESS_RELATED_PAGES = new Set\(\['differenceAllocation', 'operationLogs'\]\)/);
  assert.match(navigationSource, /PROGRESS_RELATED_PAGES\.has\(page\)[\s\S]*?canViewProgress/);
  assert.match(appRenderSource, /shouldMount\('differenceAllocation'\)[\s\S]*?<DifferenceAllocationPage token=\{token\}[\s\S]*?currentAppliedAt=\{demandMeta\.currentAppliedAt\}/);
  assert.doesNotMatch(progressSource, /showDifferenceAllocation|setDifferenceAllocationView|>差异分配<\/button>/);
  assert.doesNotMatch(serverSource, /requirePage\('differenceAllocation'\)/);
  assert.match(serverSource, /requestPath\.startsWith\('\/api\/difference'\)\) return \{ key: 'progressRefresh', label: PAGE_LABELS\.progressRefresh \}/);
  assert.match(serverSource, /app\.get\('\/api\/difference-allocations\/latest', requireAuth, requirePage\('progressRefresh'\)/);
});

test('操作记录作为采购跟单入口且只展示生产跟进操作', () => {
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  const operationLogSource = appSource.slice(
    appSource.indexOf('function OperationLogsPage('),
    appSource.indexOf('function PermissionsPage(')
  );

  const navigationSource = appSource.slice(0, appSource.indexOf('const DIMENSION_SLOTS'));
  const appRenderSource = appSource.slice(appSource.indexOf('function App()'));

  assert.match(navigationSource, /'differenceAllocation',[\s\S]*?'operationLogs',[\s\S]*?'trace'/);
  assert.doesNotMatch(navigationSource, /title: '系统操作', pages: \[[^\]]*'operationLogs'/);
  assert.match(appRenderSource, /shouldMount\('operationLogs'\)[\s\S]*?<OperationLogsPage[\s\S]*?title="生产跟进 \/ 操作记录"[\s\S]*?fixedPageKey="progressRefresh"/);
  assert.doesNotMatch(progressSource, /showOperationLogs|setOperationLogsView|>操作记录<\/button>/);
  assert.match(operationLogSource, /<SelectField label="登录人"/);
  assert.match(operationLogSource, /if \(fixedPageKey\) query\.set\('pageKey', fixedPageKey\)/);
  assert.match(operationLogSource, /!fixedPageKey && \(options\.pages \|\| \[\]\)\.length > 0/);
  assert.match(serverSource, /app\.get\('\/api\/operation-logs', requireAuth, requireAnyPage\(\['operationLogs', 'progressRefresh'\]\)/);
  assert.match(serverSource, /app\.post\('\/api\/operation-logs\/export', requireAuth, requireAnyPage\(\['operationLogs', 'progressRefresh'\]\)/);
  assert.match(serverSource, /function operationLogFiltersForAccess\(user, filters = \{\}\)[\s\S]*?canAccessAllOperationLogs\(user\)[\s\S]*?pageKey: 'progressRefresh'/);
  assert.match(serverSource, /const optionScope = canAccessAllOperationLogs\(req\.user\)[\s\S]*?pageKey: normalize\(requestedFilters\.pageKey\)[\s\S]*?pageKey: 'progressRefresh'/);
});

test('生产跟进使用固定默认显示列并按用户持久保存', () => {
  const columnSource = appSource.slice(
    appSource.indexOf('const PROGRESS_COLUMNS'),
    appSource.indexOf('function ProgressEditor(')
  );
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  const exportSource = progressSource.slice(
    progressSource.indexOf('async function handleExport()'),
    progressSource.indexOf('const progressTableColumns')
  );

  const defaultColumnsMatch = columnSource.match(/const PROGRESS_DEFAULT_COLUMNS = \[([\s\S]*?)\];/);
  assert.ok(defaultColumnsMatch);
  assert.deepEqual(
    [...defaultColumnsMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
    [
      'documentStatus', 'supplierShortName', 'businessUnit', 'operatorName', 'productLine', 'materialCode', 'sku',
      'operationStockQty', 'remainingInboundQty', 'shippedQty', 'unpreparedQty', 'preparedNotStartedQty',
      'inProductionQty', 'finishedQty', 'contractDeliveryDates', 'productionDeliveryDate',
      'unproducedEstimatedDeliveryDate', 'fulfillmentStatus', 'fulfillmentRemark', 'remark', 'oaFlowNo', 'action'
    ]
  );
  assert.match(columnSource, /\['changeValidationStatus', '变更校验'\]/);
  assert.match(columnSource, /\['dataStatus', '数据状态'\]/);
  assert.doesNotMatch(defaultColumnsMatch[1], /orderType|reportingMonth|orderNo|currentPurchaseQty|originalOrderNo|originalOrderDate|originalPurchaseQty|changeValidationStatus|dataStatus/);
  assert.match(columnSource, /function defaultProgressColumnKeys\(\)\s*\{\s*return \[\.\.\.PROGRESS_DEFAULT_COLUMNS\];/);
  assert.doesNotMatch(columnSource, /PROGRESS_DEFAULT_(?:WIDE|COMPACT|NARROW)_COLUMNS/);
  assert.match(columnSource, /function readProgressColumnPreference\(storageKey\)/);
  assert.match(columnSource, /Array\.isArray\(saved\)[\s\S]*?saved\?\.columns/);
  assert.match(columnSource, /修改显示列 \{selected\.size\}\/\{columns\.length\}/);
  assert.match(columnSource, /默认显示列/);
  assert.match(columnSource, /columns\.map\(\(\[key, label\]\)/);
  assert.match(progressSource, /gendanjindu:progress-columns:v3:\$\{user\?\.id \|\| user\?\.name \|\| 'user'\}/);
  assert.match(progressSource, /JSON\.stringify\(\{[\s\S]*?columns: visibleColumnKeys,[\s\S]*?customized: columnPreferenceCustomized/);
  assert.doesNotMatch(progressSource, /applyResponsiveDefault/);
  assert.match(progressSource, /setColumnPreferenceCustomized\(true\)[\s\S]*?setVisibleColumnKeys\(keys\)/);
  assert.match(progressSource, /setColumnPreferenceCustomized\(false\)[\s\S]*?defaultProgressColumnKeys\(\)/);
  assert.match(exportSource, /const headers = \[[\s\S]*?'状态校验'/);
  assert.match(exportSource, /\.\.\.displayRows\.map/);
  assert.doesNotMatch(exportSource, /visibleColumnKeys/);
});

test('生产跟进默认展示采购订单运营并放在事业部之后', () => {
  const columnSource = appSource.slice(
    appSource.indexOf('const PROGRESS_COLUMNS'),
    appSource.indexOf('function ProgressEditor(')
  );
  const editorSource = appSource.slice(
    appSource.indexOf('function ProgressEditor('),
    appSource.indexOf('function ProgressPage(')
  );
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  const exportSource = progressSource.slice(
    progressSource.indexOf('async function handleExport()'),
    progressSource.indexOf('const progressTableColumns')
  );

  assert.match(columnSource, /\['businessUnit', '事业部'\], \['operatorName', '运营'\], \['productLine', '产品线'\]/);
  assert.match(columnSource, /PROGRESS_DEFAULT_COLUMNS[\s\S]*?'businessUnit', 'operatorName', 'productLine'/);
  assert.match(columnSource, /PROGRESS_STICKY_COLUMN_KEYS[\s\S]*?'businessUnit', 'operatorName', 'productLine'/);
  assert.match(editorSource, /\['businessUnit', row\.businessUnit\], \['operatorName', row\.operatorName \|\| '未填写'\],\s*\['productLine'/);
  assert.match(exportSource, /'事业部', '运营', '产品线'/);
  assert.match(exportSource, /row\.businessUnit,\s*row\.operatorName \|\| '',\s*row\.productLine/);
});

test('生产跟进按采购订单保存跟单备注并筛选本周人工跟进状态', () => {
  const filterSource = appSource.slice(
    appSource.indexOf('function defaultProgressFilters('),
    appSource.indexOf('function Login(')
  );
  const editorSource = appSource.slice(
    appSource.indexOf('function ProgressEditor('),
    appSource.indexOf('function ProgressPage(')
  );
  assert.match(databaseSource, /CREATE TABLE IF NOT EXISTS production_order_followups/);
  assert.match(databaseSource, /fulfillment_remark TEXT NOT NULL DEFAULT ''/);
  assert.match(databaseSource, /material_code TEXT NOT NULL DEFAULT ''/);
  assert.match(databaseSource, /followed_user_id TEXT NOT NULL DEFAULT ''/);
  assert.match(databaseSource, /followed_role TEXT NOT NULL DEFAULT ''/);
  assert.match(databaseSource, /followed_by TEXT NOT NULL DEFAULT ''/);
  assert.match(databaseSource, /followed_at TEXT NOT NULL DEFAULT ''/);
  assert.match(serverSource, /function chinaWeekStartText\(now = new Date\(\)\)/);
  assert.match(serverSource, /timeZone: 'Asia\/Shanghai'/);
  assert.match(serverSource, /function isFollowedThisWeek\(followedAt, now = new Date\(\)\)/);
  assert.match(serverSource, /function saveProductionOrderFollowup/);
  assert.match(serverSource, /`order:\$\{encodeURIComponent\(normalizedOrderNo\)\}:\$\{encodeURIComponent\(normalizedMaterialCode\)\}`/);
  assert.match(serverSource, /normalize\(followup\.followed_role\) === ROLE_USER/);
  assert.match(serverSource, /function migrateProductionOrderFollowups\(\)/);
  assert.match(appSource, /trackingKey: row\.followupKey \|\| row\.rowKey \|\| row\.demandKey/);
  assert.match(serverSource, /fulfillmentRemark: req\.body\.fulfillmentRemark/);
  assert.match(serverSource, /DELETE FROM production_order_followups WHERE tracking_key/);
  assert.match(editorSource, /\['fulfillmentRemark', textInput\('fulfillmentRemark', '添加跟单备注'\)\]/);
  assert.match(editorSource, /\['remark', <input className="progress-remark-input" value=\{values\.remark\} readOnly title="原备注仅供查看，不能修改" \/>\]/);
  assert.match(editorSource, /trackingKey: row\.followupKey \|\| row\.rowKey \|\| row\.demandKey/);
  assert.match(editorSource, /提交成功：已标记为本周已跟进/);
  assert.match(editorSource, /再次提交成功：本周跟进内容已更新/);
  assert.match(editorSource, /页面未自动刷新/);
  assert.doesNotMatch(editorSource, /await reloadDemands\(\)/);
  assert.match(editorSource, /管理员提交不改变本周跟进状态/);
  assert.match(editorSource, /提交失败：/);
  assert.match(filterSource, /followupStatus: \['未跟进'\]/);
  assert.match(filterSource, /followupStatuses: \['未跟进', '本周已跟进'\]/);
  assert.match(filterSource, /matchesSelected\(filters\.followupStatus, row\.followupStatus \|\| '未跟进'\)/);
  assert.match(filterSource, /label="是否本周已跟进" allLabel="全部跟进状态"/);
  assert.match(filterSource, /function singleFollowupStatusSelection\(values\)/);
  assert.match(filterSource, /followupStatus: singleFollowupStatusSelection\(value\)/);
  assert.match(filterSource, /selected\.length > 1 \? \[selected\.at\(-1\)\] : selected/);
});

test('生产跟进单条和批量提交成功后不自动重新加载全量数据', () => {
  const editorSource = appSource.slice(
    appSource.indexOf('function ProgressEditor('),
    appSource.indexOf('function ProgressPage(')
  );
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  const bulkSubmitSource = progressSource.slice(
    progressSource.indexOf('async function submitProgressRows('),
    progressSource.indexOf('function toggleOrderGroup(')
  );
  const editorRenderSource = progressSource.slice(
    progressSource.indexOf('{expanded && group.rows.map('),
    progressSource.indexOf('function renderSupplierGroup(')
  );
  assert.doesNotMatch(editorSource, /reloadDemands/);
  assert.doesNotMatch(bulkSubmitSource, /reloadDemands/);
  assert.match(editorSource, /如需更新筛选结果请点击“刷新”/);
  assert.match(bulkSubmitSource, /页面未自动刷新/);
  assert.doesNotMatch(editorRenderSource, /reloadDemands=\{reloadDemands\}/);
});

test('生产跟进保存支持幂等重试且不再返回全量数据', () => {
  const editorSource = appSource.slice(
    appSource.indexOf('function ProgressEditor('),
    appSource.indexOf('function ProgressPage(')
  );
  const saveRouteSource = serverSource.slice(
    serverSource.indexOf("app.patch('/api/progress/:demandKey'"),
    serverSource.indexOf("app.get('/api/diffs'")
  );
  assert.match(databaseSource, /CREATE TABLE IF NOT EXISTS production_progress_save_requests/);
  assert.match(serverSource, /function progressSaveRequest\(req\)/);
  assert.match(serverSource, /function saveProgressRequest\(/);
  assert.match(saveRouteSource, /if \(saveRequest\.existing\)[\s\S]*?const replayTrackingKey[\s\S]*?productionFollowupPayload\(replayTrackingKey\)[\s\S]*?true\)\)/);
  assert.match(saveRouteSource, /saveProgressRequest\([\s\S]*?progressSavePayload/);
  assert.match(saveRouteSource, /followupMarkedBySubmission/);
  assert.doesNotMatch(saveRouteSource, /res\.json\(\{ rows: demandRows/);
  assert.match(editorSource, /const requestId = clientRequestId\('progress'\)/);
  assert.match(editorSource, /networkRetries: 2/);
  assert.match(editorSource, /timeoutMs: 30000/);
  assert.match(editorSource, /'X-Idempotency-Key': requestId/);
  assert.match(editorSource, /result\.replayed/);
  assert.match(appSource, /\u7f51\u7edc\u8fde\u63a5\u5931\u8d25\$\{retried\}/);
});

test('生产跟进使用独立轻量数据接口并按页面升级加载范围', () => {
  const appRenderSource = appSource.slice(appSource.indexOf('function App()'));
  assert.match(serverSource, /function demandLoadContext\(demands, \{ includeInventory = true \} = \{\}\)/);
  assert.match(serverSource, /includeInventory \? all\('SELECT \* FROM inventory'\) : \[\]/);
  assert.match(serverSource, /app\.get\('\/api\/progress\/demands', requireAuth, requirePage\('progressRefresh'\)/);
  assert.match(serverSource, /demandRows\(false, req\.user, \{ includeInventory: false \}\)/);
  assert.match(serverSource, /dataScope: 'progress'/);
  assert.match(appSource, /function demandDataScopeForPage\(page\)[\s\S]*?page === 'progressRefresh'[\s\S]*?return 'progress'/);
  assert.match(appSource, /function demandDataScopeSatisfies\(loadedScope, requiredScope\)[\s\S]*?loadedScope === 'full'/);
  assert.match(appRenderSource, /scope === 'progress' \? '\/api\/progress\/demands' : '\/api\/demands'/);
  assert.match(appRenderSource, /demandRequestSequence\.current/);
  assert.match(appRenderSource, /demandDataScopeSatisfies\(demandsScope, requiredScope\)/);
});

test('生产跟进按供应商展示有缩进的四级订单层级', () => {
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  const nestedStart = progressSource.indexOf('{supplierNested ? (');
  const nestedEnd = progressSource.indexOf(') : (', nestedStart);
  assert.match(progressSource, /function renderPurchaseOrderGroup\(group, showSupplier = true, supplierNested = false\)/);
  assert.match(progressSource, /renderPurchaseOrderGroup\(orderGroup, false, true\)/);
  assert.match(progressSource, /className=\{`progress-order-detail-header\$\{supplierNested \? ' progress-supplier-detail-header' : ''\}`\}/);
  assert.match(progressSource, /supplierNested=\{supplierNested\}/);
  assert.match(progressSource, /className="progress-supplier-parent-toggle"/);
  assert.match(progressSource, /className="progress-supplier-month-toggle"/);
  assert.ok(nestedStart >= 0 && nestedEnd > nestedStart);
  const nestedSource = progressSource.slice(nestedStart, nestedEnd);
  assert.match(nestedSource, /当前采购月份：[\s\S]*?当前采购订单号：[\s\S]*?原采购月份：[\s\S]*?原采购订单号：[\s\S]*?产品线：[\s\S]*?系列：[\s\S]*?采购数量：[\s\S]*?未交付数量：/);
  assert.doesNotMatch(nestedSource, /订单状态：/);
  assert.match(styleSource, /\.progress-supplier-month-toggle\s*\{\s*padding-left: 34px;/);
  assert.match(styleSource, /\.progress-order-toggle\.progress-supplier-order-toggle\s*\{\s*padding-left: 60px;/);
  assert.match(styleSource, /\.progress-supplier-detail-header > th:first-child,[\s\S]*?\.progress-supplier-detail-row > td:first-child\s*\{\s*padding-left: 86px !important;/);
});

test('生产跟进回车移到下一行同列并全选内容', () => {
  const editorSource = appSource.slice(
    appSource.indexOf('function focusNextProgressEditable('),
    appSource.indexOf('function ProgressPage(')
  );
  assert.match(editorSource, /event\.key !== 'Enter'/);
  assert.match(editorSource, /querySelectorAll\(`\[data-progress-edit-column="\$\{columnKey\}"\]:not\(\[disabled\]\):not\(\[readonly\]\)`\)/);
  assert.match(editorSource, /const next = controls\[currentIndex \+ 1\]/);
  assert.match(editorSource, /next\.focus\(\)[\s\S]*?next\.select\(\)/);
  assert.match(editorSource, /data-progress-edit-column=\{readOnly \? undefined : key\}/);
  assert.match(editorSource, /data-progress-edit-column="fulfillmentStatus"/);
});

test('生产跟进全选后在供应商订单层显示批量提交', () => {
  const editorSource = appSource.slice(
    appSource.indexOf('function ProgressEditor('),
    appSource.indexOf('function ProgressPage(')
  );
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  const nestedStart = progressSource.indexOf('{supplierNested ? (');
  const nestedEnd = progressSource.indexOf('<span>当前采购月份：', nestedStart);
  const nestedPrefix = progressSource.slice(nestedStart, nestedEnd);
  assert.match(progressSource, /const showBulkSubmit = supplierNested[\s\S]*?allVisibleEditableSelected[\s\S]*?groupEditableKeys\.every/);
  assert.match(progressSource, /async function submitProgressRows\(targetRows\)/);
  assert.match(progressSource, /networkRetries: 2[\s\S]*?X-Idempotency-Key/);
  assert.match(nestedPrefix, /progress-inline-bulk-submit[\s\S]*?批量提交/);
  assert.match(editorSource, /onSelect\?\.\(row\.rowKey \|\| row\.demandKey/);
  assert.match(styleSource, /\.progress-inline-bulk-submit\s*\{/);
});

test('生产跟进展开明细列按内容自适应且不换行', () => {
  const editorSource = appSource.slice(
    appSource.indexOf('function ProgressEditor('),
    appSource.indexOf('function ProgressPage(')
  );
  assert.match(editorSource, /className=\{`progress-order-detail-row/);
  assert.match(styleSource, /\.kingdee-progress-page \.progress-table table\s*\{[\s\S]*?width: max-content;[\s\S]*?table-layout: auto;/);
  assert.match(styleSource, /\.kingdee-progress-page \.progress-order-detail-header > th,[\s\S]*?\.progress-order-detail-row > td\s*\{[\s\S]*?width: auto !important;[\s\S]*?max-width: none !important;[\s\S]*?white-space: nowrap !important;/);
  assert.match(styleSource, /\.kingdee-progress-page \.progress-order-detail-row > td \*\s*\{[\s\S]*?white-space: nowrap !important;/);
});

test('生产跟进采购订单明细纵向滚动时冻结表头', () => {
  assert.match(styleSource, /\.kingdee-progress-page \.progress-order-detail-header th\s*\{[\s\S]*?position: sticky;[\s\S]*?top: 0;[\s\S]*?z-index: 7;/);
  assert.match(styleSource, /\.kingdee-progress-page \.progress-order-detail-header > \.progress-sticky-column\s*\{[\s\S]*?z-index: 8;/);
});

test('生产跟进展开明细冻结关键识别与数量列', () => {
  const columnSource = appSource.slice(
    appSource.indexOf('const PROGRESS_COLUMNS'),
    appSource.indexOf('function ProgressEditor(')
  );
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  ['documentStatus', 'supplierShortName', 'businessUnit', 'operatorName', 'productLine', 'materialCode', 'sku', 'operationStockQty', 'remainingInboundQty', 'shippedQty'].forEach((key) => {
    assert.match(columnSource, new RegExp(`PROGRESS_STICKY_COLUMN_KEYS[\\s\\S]*?'${key}'`));
  });
  assert.match(progressSource, /useLayoutEffect\(\(\) => \{[\s\S]*?getBoundingClientRect\(\)\.width/);
  assert.match(progressSource, /tableWrapRef=\{progressTableWrapRef\}/);
  assert.match(styleSource, /\.progress-order-detail-row > \.progress-sticky-column[\s\S]*?position: sticky;[\s\S]*?left: var\(--progress-sticky-left\)/);
  assert.match(styleSource, /\.progress-sticky-column-last[\s\S]*?box-shadow:/);
});

test('生产跟进四阶段独立填写且合计必须等于未交付数量', () => {
  const editorSource = appSource.slice(
    appSource.indexOf('function ProgressEditor('),
    appSource.indexOf('function ProgressPage(')
  );
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressPage('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  assert.match(editorSource, /const manuallyAssignedQty = numberValue\(values\.preparedNotStartedQty\)[\s\S]*?\+ numberValue\(values\.inProductionQty\);/);
  assert.match(editorSource, /const stageTotalQty = requestedUnpreparedQty \+ manuallyAssignedQty \+ numberValue\(values\.finishedQty\)/);
  assert.match(editorSource, /unpreparedQty: numberValue\(nextValues\.unpreparedQty\)/);
  assert.doesNotMatch(editorSource, /Math\.max\(remainingQty - nextAssignedQty/);
  assert.match(editorSource, /完工未发产品合计必须等于未交付数量/);
  assert.match(progressSource, /四列合计必须等于未交付数量/);
  assert.match(progressSource, /均可独立填写，不自动补差/);
});

test('生产跟进支持手工登记表预览和采购订单折叠', () => {
  const progressSource = appSource.slice(
    appSource.indexOf('function useFilteredDemands('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  assert.doesNotMatch(progressSource, /label="数据状态"/);
  assert.doesNotMatch(progressSource, /label="采购组"/);
  assert.match(progressSource, /function ManualProgressImportPanel/);
  assert.match(progressSource, /导入手工登记表/);
  assert.match(progressSource, /!onlyIssues && isSystemOwner && <ManualProgressImportPanel/);
  assert.match(progressSource, /progress-order-parent-row/);
  assert.match(progressSource, /showHeader=\{false\}/);
  assert.match(progressSource, /expanded && \([\s\S]*?progress-order-detail-header[\s\S]*?progressTableColumns\.map/);
  assert.match(progressSource, /group\.rows\.map/);
  assert.match(serverSource, /\/api\/progress\/manual-import\/preview/);
  assert.match(serverSource, /\/api\/progress\/manual-import\/:batchId\/apply/);
  assert.match(serverSource, /app\.post\('\/api\/progress\/manual-import\/preview', requireAuth, requirePage\('progressRefresh'\), requireSystemOwner/);
  assert.match(serverSource, /app\.post\('\/api\/progress\/manual-import\/:batchId\/apply', requireAuth, requirePage\('progressRefresh'\), requireSystemOwner/);
  assert.match(serverSource, /app\.post\('\/api\/progress\/manual-import\/reconcile', requireAuth, requirePage\('progressRefresh'\), requireSystemOwner/);
  assert.match(serverSource, /app\.get\('\/api\/progress\/manual-import\/history', requireAuth, requirePage\('progressRefresh'\), requireSystemOwner/);
  assert.match(serverSource, /app\.get\('\/api\/progress\/manual-import\/latest', requireAuth, requirePage\('progressRefresh'\), requireSystemOwner/);
  assert.match(serverSource, /app\.get\('\/api\/progress\/manual-import\/:batchId\/rows', requireAuth, requirePage\('progressRefresh'\), requireSystemOwner/);
  assert.match(serverSource, /app\.get\('\/api\/progress\/manual-import\/:batchId\/export', requireAuth, requirePage\('progressRefresh'\), requireSystemOwner/);
  assert.match(progressSource, /删除全部待匹配（\{numberValue\(preview\.summary\.manualUnmatchedRows\)\}）/);
  assert.match(progressSource, /expectedCount, reason: '管理员批量删除手工待匹配记录'/);
  assert.match(serverSource, /app\.post\('\/api\/progress\/manual-import\/unmatched\/delete-all', requireAuth, requirePage\('progressRefresh'\), requireSystemOwner/);
  assert.match(serverSource, /仅\$\{ADMIN_NAME\}可以删除手工待匹配记录/);
  assert.match(serverSource, /data_status = '已删除'[\s\S]*?validation_status = 'deleted'/);
  const bulkDeleteRoute = serverSource.slice(
    serverSource.indexOf("app.post('/api/progress/manual-import/unmatched/delete-all'"),
    serverSource.indexOf("app.post('/api/progress/manual-import/rows/:rowId/delete'")
  );
  assert.doesNotMatch(bulkDeleteRoute, /active = 1|stale = 0/);
  assert.match(serverSource, /app\.get\('\/api\/progress\/manual-import\/latest'[\s\S]*?refreshManualProgressBatchSummary\(batch\.id\)/);
  assert.doesNotMatch(serverSource, /app\.(?:get|post)\('\/api\/progress\/manual-import[^\n]*requireAdmin/);
  assert.match(serverSource, /本次手工表未出现/);
  assert.match(serverSource, /function latestAppliedManualProgressBatch\(\)/);
  assert.match(serverSource, /WHERE batch_id = \? AND active = 1 AND stale = 0 AND deleted_at = ''/);
  assert.match(serverSource, /SET active = 0, stale = 1, data_status = '本次手工表未出现'/);
});

test('生产跟进保留金蝶内部工具栏并使用独立全屏容器', () => {
  const progressSource = appSource.slice(
    appSource.indexOf('function ProgressColumnSelector('),
    appSource.indexOf('function DifferenceAllocationPage(')
  );
  assert.match(progressSource, /className="compact-button progress-toolbar-entry progress-columns-button"[\s\S]*?修改显示列/);
  assert.doesNotMatch(progressSource, />差异分配<\/button>/);
  assert.doesNotMatch(progressSource, />操作记录<\/button>/);
  assert.match(progressSource, /className="progress-command primary"[\s\S]*?>刷新<\/button>/);
  assert.match(progressSource, /className="progress-scheme-bar"[\s\S]*?>按新下单月份<\/button>[\s\S]*?>按原下单月份<\/button>[\s\S]*?>按供应商<\/button>/);
  assert.doesNotMatch(progressSource, />待人工调整<\/button>/);
  assert.match(progressSource, /<details className="progress-logic-note"/);
  assert.doesNotMatch(progressSource, /setDifferenceAllocationView|setOperationLogsView/);
  assert.match(appSource, /className=\{progressStandalone \? 'progress-standalone-shell' : 'app-shell'\}/);
  assert.match(styleSource, /\.progress-standalone-shell\s*\{[\s\S]*?min-height: 100vh/);
  assert.doesNotMatch(appSource, /className=\{`app-shell\$\{activeTab === 'progressRefresh'/);
  assert.match(styleSource, /\.progress-command-bar\s*\{[\s\S]*?min-height: 40px/);
  assert.match(styleSource, /\.progress-command-bar\s*\{[\s\S]*?flex-wrap: wrap/);
  assert.match(styleSource, /\.kingdee-progress-page \.progress-column-selector\s*\{[\s\S]*?display: contents/);
  assert.match(styleSource, /\.kingdee-progress-page \.progress-column-menu\s*\{[\s\S]*?position: static;[\s\S]*?flex: 1 0 100%;[\s\S]*?width: 100%/);
  assert.match(styleSource, /\.progress-command-bar:has\(\.progress-column-menu\)\s*\{[\s\S]*?overflow-x: visible/);
  assert.match(styleSource, /@media \(max-width: 900px\)[\s\S]*?\.kingdee-progress-page \.progress-column-menu\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styleSource, /\.progress-scheme-bar\s*\{[\s\S]*?min-height: 42px/);
  assert.match(styleSource, /\.kingdee-progress-page \.progress-order-detail-header th\s*\{[\s\S]*?background: #edf3fb/);
  assert.match(styleSource, /\.progress-record-link,[\s\S]*?color: #216ef4/);
  assert.match(styleSource, /\.progress-internal-view-heading\s*\{[\s\S]*?min-height: 36px;/);
});

test('手工跟单重新匹配批量写入并跳过无变化快照', () => {
  const reconcileSource = serverSource.slice(
    serverSource.indexOf('function manualProgressValuesChanged('),
    serverSource.indexOf('function manualProgressSourcePayload(')
  );
  assert.match(reconcileSource, /const demandMap = new Map\(all\('SELECT \* FROM order_demands WHERE active = 1'\)/);
  assert.match(reconcileSource, /const progressMap = new Map\(all\('SELECT \* FROM supplier_progress'\)/);
  assert.match(reconcileSource, /if \(!manualProgressValuesChanged\(existing, values\)\) return/);
  assert.match(reconcileSource, /runMany\([\s\S]*?UPDATE manual_progress_rows/);
  assert.match(reconcileSource, /runMany\([\s\S]*?INSERT INTO supplier_progress_snapshots/);
  assert.doesNotMatch(reconcileSource, /get\('SELECT \* FROM order_demands WHERE demand_key = \? AND active = 1'/);
});

test('手工登记表模糊匹配兼容采购下单人维度变更', () => {
  const candidateSource = serverSource.slice(
    serverSource.indexOf('function manualProgressCandidateMaps()'),
    serverSource.indexOf('function manualProgressCandidatePayload(')
  );
  const matchSource = serverSource.slice(
    serverSource.indexOf('function matchManualProgressRows('),
    serverSource.indexOf('function manualProgressSummary(')
  );
  assert.equal((candidateSource.match(/manualProgressMatchKey\(\[\.\.\.parts, shortName, purchaseOwner\]\)/g) || []).length, 2);
  assert.equal((candidateSource.match(/manualProgressMatchKey\(\[\.\.\.parts, shortName, UNASSIGNED_PURCHASE_OWNER\]\)/g) || []).length, 2);
  assert.equal((candidateSource.match(/manualProgressMatchKey\(\[\.\.\.parts, shortName, ''\]\)/g) || []).length, 2);
  assert.match(matchSource, /manualProgressMatchKey\(\[\.\.\.parts, row\.purchaseOwner\]\)[\s\S]*?manualProgressMatchKey\(\[\.\.\.parts, UNASSIGNED_PURCHASE_OWNER\]\)[\s\S]*?manualProgressMatchKey\(\[\.\.\.parts, ''\]\)/);
});
