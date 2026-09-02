import bcrypt from 'bcryptjs';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import multer from 'multer';
import { SaxesParser } from 'saxes';
import unzipper from 'unzipper';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';
import { all, get, initDatabase, run, runMany, saveDatabase, transaction } from './database.js';
import {
  FIRST_MILE_PARSER_VERSION,
  dedupeFirstMileRows,
  firstMileOwner,
  inspectFirstMileWorkbook,
  isFirstMileSlot,
  parseFirstMileWorkbook,
  reparseFirstMileSource
} from './first-mile.js';
import { FULL_INVENTORY_SHEETS, buildFullInventorySummary, inspectFullInventoryWorkbook, inspectOrderFulfillmentWorkbook, parseFullInventoryWorkbook, parseOrderFulfillmentWorkbook } from './full-inventory.js';
import {
  buildInventoryDimensionDiagnostics,
  buildInventorySummaryModel,
  isInventorySummarySlot,
  parseInventoryManualWorkbook,
  parseInventorySummaryWorkbook
} from './inventory-summary.js';
import {
  buildBeiHuoReviewAnalysis,
  buildInventoryRiskAnalysis,
  buildSupplyPlanSummary,
  inventoryRiskCacheKey,
  normalizeInventoryRiskParams,
  normalizeSupplyPlanParams
} from './inventory-risk.js';
import { buildInventoryRiskWorkbook } from './inventory-risk-export.js';
import { groupCurrentKingdeeOrderRows, isEffectivePurchaseOrder, kingdeeOrderIdentity } from './kingdee-order-visibility.js';
import { buildOrderChangeIndex, classifyOrderChange, NORMAL_ORDER_TYPE, orderTypeForSupplier } from './order-change.js';
import { buildStyledExcelBuffer } from '../shared/excel-export.js';
import { normalizeProgressDateValue } from '../shared/progress-date.js';
import { buildProductArchive } from './product-archive.js';
import {
  buildProjectMetrics,
  createDingTalkProjectClient,
  extractDingTalkBaseId,
  linkProjectsToProducts,
  normalizeProjectMapping,
  normalizeProjectRecords,
  shouldRunDailyProjectSync
} from './product-projects.js';
import { inspectProductProjectWorkbook, parseProductProjectWorkbook } from './product-project-workbook.js';
import {
  allocateIntegerByWeights,
  allocateNumberByWeights,
  groupManualProgressRows,
  manualOrderNumbers,
  manualProgressSourceValues,
  parseManualProgressRows,
  rebalanceManualProgressSplitRows
} from './manual-progress.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4003);
const ADMIN_NAME = process.env.ADMIN_NAME || '孙立柱';
const ROLE_ADMIN = '管理员';
const ROLE_USER = '普通用户';
const UNMATCHED_SUPPLIER_SHORT_NAME = '未匹配';
const ALL_PAGES = [
  'domesticBoard',
  'wangdianData',
  'crossBorderInventory',
  'lingxingInventory',
  'inventorySummary',
  'inventoryRisk',
  'supplyPlanBoard',
  'productArchive',
  'businessUnitFeedback',
  'inventoryPurchase',
  'inventorySummaryLibrary',
  'inventoryManualLibrary',
  'beiHuoGongJu',
  'beiHuoReviewLibrary',
  'fullInventorySummary',
  'fullInventoryLibrary',
  'operationBoard',
  'progressRefresh',
  'differenceAllocation',
  'trace',
  'purchaseBoard',
  'firstMileBoard',
  'firstMileDatabase',
  'dimensionMissing',
  'dimensionLibrary',
  'kingdeeImport',
  'permissions',
  'operationLogs'
];
const PAGE_LABELS = {
  domesticBoard: '国内事业部看板',
  inventorySummary: '库存汇总',
  inventoryRisk: '供应计划分析',
  supplyPlanBoard: '供应计划工具',
  productArchive: '产品档案',
  businessUnitFeedback: '产品数据',
  inventoryPurchase: '采购未交付',
  inventorySummaryLibrary: '底表文件',
  inventoryManualLibrary: '手工表库',
  beiHuoGongJu: '备货工具',
  beiHuoReviewLibrary: '备货文件导入',
  fullInventorySummary: '全量库存汇总',
  fullInventoryLibrary: '全量库存底表',
  operationBoard: '运营看板-未交付',
  purchaseBoard: '采购看板',
  kingdeeImport: '采购订单',
  progressRefresh: '生产跟进',
  differenceAllocation: '差异分配',
  wangdianData: '国内数据',
  lingxingInventory: '领星库存',
  firstMileDatabase: '头程数据库',
  firstMileBoard: '头程数据看板',
  crossBorderInventory: '跨境库存看板',
  dimensionMissing: '维度表缺失',
  dimensionLibrary: '维度表库',
  trace: '变更追溯',
  operationLogs: '操作记录',
  permissions: '权限管理'
};
const DIMENSION_SLOTS = {
  productCategory: '商品分类',
  purchaseAssignment: '采购分工',
  spare1: '仓库名称',
  warehouseMaterialMap: '仓库与物料对照表',
  dimensionSpare: '领星SKU和物料编码对照',
  lingxingWarehouseMap: '领星&金蝶仓库对照',
  dimensionSpare2: '备用',
  spare2: '备用2',
  dimensionSpare3: '备用3',
  wangdianDataMain: '国内数据',
  wangdianSpare1: '京东库存',
  wangdianSpare2: '京东ID与品号匹配',
  wangdianSpare3: '备用3',
  lingxingFbaInventory: 'FBA库存',
  lingxingFbmInventory: 'FBM库存',
  lingxingWfsInventory: 'WFS库存',
  lingxingSpare: '备用',
  inventorySummaryFile1: 'FBA库存报表',
  inventorySummaryFile2: 'FBM库存报表',
  inventorySummaryFile3: 'WFS库存报表',
  inventorySummaryFile4: 'FBA在途报表',
  inventorySummaryFile5: 'FBM在途报表',
  inventorySummaryFile6: '国内在库报表',
  inventorySummaryFile7: '京东在库报表',
  inventorySummaryFile8: '销售数据报表',
  inventorySummaryFile9: 'Dim-领星FBA仓库&金蝶仓库',
  inventorySummaryFile10: 'Dim-领星SKU对应物料编码-产品管理',
  inventorySummaryFile11: 'Dim-京东ID与品号匹配',
  inventorySummaryFile12: '采购跟单情况',
  inventorySummaryFile13: 'Dim-领星FBA在途&金蝶仓库',
  inventorySummaryFile14: '京东在途',
  inventorySummaryFile15: '销售预测',
  inventorySummaryFile16: '库龄文件',
  inventorySummaryFile17: 'WFS在途报表',
  inventorySummaryFile18: '备用',
  inventorySummaryFile19: '备用',
  inventorySummaryFile20: '备用',
  firstMileData1: '张婷婷头程数据',
  firstMileData2: '扈翠芸头程数据',
  firstMileData3: '魏静头程数据',
  firstMileData4: '李紫媛头程数据',
  firstMileData5: '李宛宸头程数据',
  firstMileSpare: '备用',
  beiHuoReviewFile1: '国内事业部备货',
  beiHuoReviewFile2: '备用',
  beiHuoReviewFile3: '备用',
  beiHuoReviewFile4: '备用',
  fullInventoryFile1: '全量库存底表',
  fullInventoryFile2: '订单履约表'
};
[
  '海外事业一部',
  '海外事业二部',
  '国内事业部',
  '产品项目',
  '备用2',
  '备用3',
  '备用4',
  '备用5'
].forEach((title, index) => {
  DIMENSION_SLOTS[`businessUnitFeedback${index + 1}`] = title;
});
const PRODUCT_PROJECT_SLOT_ID = 'businessUnitFeedback4';
Object.entries(DIMENSION_SLOTS)
  .filter(([slotId]) => /^inventorySummaryFile\d+$/.test(slotId))
  .forEach(([slotId, title]) => {
    DIMENSION_SLOTS[slotId.replace('inventorySummaryFile', 'inventoryManualFile')] = `${title}手工`;
  });
DIMENSION_SLOTS.inventoryManualFile8 = '不可售手工';
for (let slotNumber = 10; slotNumber <= 20; slotNumber += 1) {
  DIMENSION_SLOTS[`inventoryManualFile${slotNumber}`] = '备用';
}
DIMENSION_SLOTS.inventoryManualFile14 = '京东在途手工';
DIMENSION_SLOTS.inventoryManualFile17 = 'WFS在途手工';

function inventoryLibraryBaseSlotId(slotId) {
  return String(slotId || '').replace(/^inventoryManualFile(?=\d+$)/, 'inventorySummaryFile');
}

function isInventoryManualSlot(slotId) {
  return /^inventoryManualFile\d+$/.test(String(slotId || ''));
}

function isInventoryLibrarySlot(slotId) {
  return isInventorySummarySlot(inventoryLibraryBaseSlotId(slotId))
    || ['inventorySummaryFile15', 'inventorySummaryFile16'].includes(inventoryLibraryBaseSlotId(slotId));
}
const DIFF_NORMAL_ORDER = '正常订单';
const DIFF_ORDER_COMPLETE_REASON = '订单已完结';
const DIFF_LEGACY_ORDER_COMPLETE_REASON = '订单完结';
const DIFF_ORDER_COMPLETE_ACTION = '订单已完结';
const DIFF_ALLOCATION_ACTIONS = [DIFF_NORMAL_ORDER, '减少', '取消', '增加', '其他', DIFF_ORDER_COMPLETE_ACTION];
const DIFF_ALLOCATION_REASONS = [DIFF_NORMAL_ORDER, '业务调整', '型号迭代', '涨价', '降价', DIFF_ORDER_COMPLETE_REASON, '其他'];
const UNASSIGNED_PURCHASE_OWNER = '未分配采购下单人';
const UNASSIGNED_BUSINESS_UNIT = '之前未分配事业部';
const TRACKING_CLOSE_STATUS = '未关闭';

const app = express();
const UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_LIMIT_BYTES } });
const kingdeeUploadDir = path.join(os.tmpdir(), 'gendanjindu-kingdee-uploads');
fs.mkdirSync(kingdeeUploadDir, { recursive: true });
fs.readdirSync(kingdeeUploadDir, { withFileTypes: true }).forEach((entry) => {
  if (entry.isFile()) fs.rmSync(path.join(kingdeeUploadDir, entry.name), { force: true });
});
const kingdeeUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, kingdeeUploadDir),
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${randomUUID()}${path.extname(file.originalname || '')}`)
  }),
  limits: { fileSize: UPLOAD_LIMIT_BYTES }
});
const ALLOWED_ORIGINS = new Set([
  'https://zhugeaishiyanshi.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || ALLOWED_ORIGINS.has(origin));
  }
}));
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginOpenerPolicy: false
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false }));
app.use(compression());
app.use(express.json({ limit: '30mb' }));

function nowText() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function chinaDateTimeParts(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
}

function chinaNowText(now = new Date()) {
  const parts = chinaDateTimeParts(now);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function chinaWeekStartText(now = new Date()) {
  const parts = chinaDateTimeParts(now);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mondayOffset = weekday === 0 ? 6 : weekday - 1;
  const monday = new Date(Date.UTC(year, month - 1, day - mondayOffset));
  const p = (value) => String(value).padStart(2, '0');
  return `${monday.getUTCFullYear()}-${p(monday.getUTCMonth() + 1)}-${p(monday.getUTCDate())} 00:00:00`;
}

function isFollowedThisWeek(followedAt, now = new Date()) {
  const value = normalize(followedAt);
  if (!value) return false;
  const current = chinaNowText(now);
  return value >= chinaWeekStartText(now) && value <= current;
}

function progressFollowupTrackingKey(demandKeyValue, orderNo = '', materialCode = '') {
  const normalizedOrderNo = normalizeMatchPart(orderNo);
  const normalizedMaterialCode = normalizeMatchPart(materialCode);
  if (normalizedOrderNo && normalizedMaterialCode) {
    return `order:${encodeURIComponent(normalizedOrderNo)}:${encodeURIComponent(normalizedMaterialCode)}`;
  }
  return normalizedOrderNo
    ? kingdeeOrderIdentity(demandKeyValue, orderNo)
    : normalize(demandKeyValue);
}

function progressFollowupPayload(followupMap, trackingKey, now = new Date()) {
  const followup = followupMap.get(normalize(trackingKey)) || {};
  const isOrdinaryUserFollowup = normalize(followup.followed_role) === ROLE_USER;
  const followedAt = isOrdinaryUserFollowup ? normalize(followup.followed_at) : '';
  const followedThisWeek = isFollowedThisWeek(followedAt, now);
  return {
    fulfillmentRemark: normalize(followup.fulfillment_remark),
    followupUpdatedBy: isOrdinaryUserFollowup ? normalize(followup.followed_by) : '',
    followupUpdatedAt: followedAt,
    followedThisWeek,
    followupStatus: followedThisWeek ? '本周已跟进' : '未跟进'
  };
}

function productionFollowupPayload(trackingKey, now = new Date()) {
  const key = normalize(trackingKey);
  const row = get('SELECT * FROM production_order_followups WHERE tracking_key = ?', [key]);
  return progressFollowupPayload(new Map(row ? [[key, row]] : []), key, now);
}

function saveProductionOrderFollowup({
  trackingKey,
  demandKey,
  orderNo = '',
  materialCode = '',
  fulfillmentRemark = '',
  user,
  followedAt = chinaNowText()
}) {
  const key = normalize(trackingKey);
  const existing = get('SELECT * FROM production_order_followups WHERE tracking_key = ?', [key]) || {};
  const followupPreviouslyThisWeek = normalize(existing.followed_role) === ROLE_USER
    && isFollowedThisWeek(existing.followed_at);
  const followupMarkedBySubmission = normalize(user?.role) === ROLE_USER;
  const followedUserId = followupMarkedBySubmission ? normalize(user?.id) : normalize(existing.followed_user_id);
  const followedRole = followupMarkedBySubmission ? ROLE_USER : normalize(existing.followed_role);
  const followedBy = followupMarkedBySubmission
    ? (normalize(user?.name) || '未知用户')
    : normalize(existing.followed_by);
  const effectiveFollowedAt = followupMarkedBySubmission ? normalize(followedAt) : normalize(existing.followed_at);
  run(
    `INSERT INTO production_order_followups (
       tracking_key, demand_key, order_no, material_code, fulfillment_remark,
       followed_user_id, followed_role, followed_by, followed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tracking_key) DO UPDATE SET
       demand_key = excluded.demand_key,
       order_no = excluded.order_no,
       material_code = excluded.material_code,
       fulfillment_remark = excluded.fulfillment_remark,
       followed_user_id = excluded.followed_user_id,
       followed_role = excluded.followed_role,
       followed_by = excluded.followed_by,
       followed_at = excluded.followed_at`,
    [
      key, normalize(demandKey), normalize(orderNo), normalize(materialCode), normalize(fulfillmentRemark),
      followedUserId, followedRole, followedBy, effectiveFollowedAt
    ]
  );
  return {
    followupMarkedBySubmission,
    followupPreviouslyThisWeek,
    ...productionFollowupPayload(key)
  };
}

function productionFollowupMaterialCode(row) {
  const stored = normalize(row.material_code);
  if (stored) return stored;
  const demandKeyValue = normalize(row.demand_key);
  const orderNo = normalize(row.order_no);
  if (demandKeyValue && orderNo) {
    const order = get(
      `SELECT material_code FROM kingdee_orders
       WHERE demand_key = ? AND order_no = ? AND material_code <> ''
       ORDER BY rowid DESC LIMIT 1`,
      [demandKeyValue, orderNo]
    );
    if (normalize(order?.material_code)) return normalize(order.material_code);
  }
  if (demandKeyValue) {
    const demand = get('SELECT material_code FROM order_demands WHERE demand_key = ?', [demandKeyValue]);
    if (normalize(demand?.material_code)) return normalize(demand.material_code);
    const parts = demandKeyValue.split('|');
    if (parts.length >= 5 && normalize(parts.at(-1))) return normalize(parts.at(-1));
  }
  if (orderNo) {
    const materials = all(
      `SELECT DISTINCT material_code FROM kingdee_orders
       WHERE order_no = ? AND material_code <> ''`,
      [orderNo]
    ).map((item) => normalize(item.material_code)).filter(Boolean);
    if (materials.length === 1) return materials[0];
  }
  return '';
}

function productionFollowupUser(userMapById, userMapByName, row) {
  const byId = userMapById.get(normalize(row.followed_user_id || row.user_id));
  if (byId) return byId;
  return userMapByName.get(normalize(row.followed_by)) || null;
}

function migrateProductionOrderFollowups() {
  const migrationKey = 'production-followup-stable-key-v1';
  if (get('SELECT 1 AS found FROM import_mappings WHERE kind = ?', [migrationKey])) return;
  const users = all('SELECT id, name, role FROM users');
  const userMapById = new Map(users.map((user) => [normalize(user.id), user]));
  const userMapByName = new Map(users.map((user) => [normalize(user.name), user]));
  const rows = all('SELECT * FROM production_order_followups');
  const groups = new Map();
  rows.forEach((row, index) => {
    const manual = normalize(row.tracking_key).startsWith('manual:');
    const materialCode = manual ? normalize(row.material_code) : productionFollowupMaterialCode(row);
    const trackingKey = manual
      ? normalize(row.tracking_key)
      : progressFollowupTrackingKey(row.demand_key, row.order_no, materialCode);
    if (!trackingKey) return;
    const group = groups.get(trackingKey) || { rows: [], ordinaryCandidates: [] };
    const user = productionFollowupUser(userMapById, userMapByName, row);
    const followedRole = normalize(row.followed_role) || normalize(user?.role);
    const normalizedRow = {
      ...row,
      tracking_key: trackingKey,
      material_code: materialCode,
      followed_user_id: normalize(row.followed_user_id) || normalize(user?.id),
      followed_role: followedRole,
      source_index: index
    };
    group.rows.push(normalizedRow);
    if (followedRole === ROLE_USER && normalize(row.followed_at)) {
      group.ordinaryCandidates.push(normalizedRow);
    }
    groups.set(trackingKey, group);
  });
  const requestRows = all(
    `SELECT r.*, u.name AS followed_by, u.role AS followed_role
     FROM production_progress_save_requests r
     LEFT JOIN users u ON u.id = r.user_id
     WHERE u.role = ?`,
    [ROLE_USER]
  );
  requestRows.forEach((request, index) => {
    const manual = normalize(request.tracking_key).startsWith('manual:');
    const materialCode = manual ? '' : productionFollowupMaterialCode(request);
    const trackingKey = manual
      ? normalize(request.tracking_key)
      : progressFollowupTrackingKey(request.demand_key, request.order_no, materialCode);
    const group = groups.get(trackingKey);
    if (!group || !normalize(request.saved_at)) return;
    group.ordinaryCandidates.push({
      followed_user_id: normalize(request.user_id),
      followed_role: ROLE_USER,
      followed_by: normalize(request.followed_by),
      followed_at: normalize(request.saved_at),
      source_index: rows.length + index
    });
  });
  const newest = (items, dateField) => [...items].sort((left, right) => (
    normalize(right[dateField]).localeCompare(normalize(left[dateField]))
      || numberValue(right.source_index) - numberValue(left.source_index)
  ))[0] || {};
  transaction(() => {
    run('DELETE FROM production_order_followups');
    groups.forEach((group, trackingKey) => {
      const latestRow = newest(group.rows, 'followed_at');
      const latestRemarkRow = newest(group.rows.filter((row) => normalize(row.fulfillment_remark)), 'followed_at');
      const latestOrdinary = newest(group.ordinaryCandidates, 'followed_at');
      run(
        `INSERT INTO production_order_followups (
           tracking_key, demand_key, order_no, material_code, fulfillment_remark,
           followed_user_id, followed_role, followed_by, followed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trackingKey, normalize(latestRow.demand_key), normalize(latestRow.order_no), normalize(latestRow.material_code),
          normalize(latestRemarkRow.fulfillment_remark), normalize(latestOrdinary.followed_user_id),
          normalize(latestOrdinary.followed_role), normalize(latestOrdinary.followed_by), normalize(latestOrdinary.followed_at)
        ]
      );
    });
    run(
      `INSERT INTO import_mappings (kind, mapping_json, updated_by, updated_at)
       VALUES (?, ?, '系统迁移', ?)
       ON CONFLICT(kind) DO UPDATE SET mapping_json = excluded.mapping_json,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [migrationKey, JSON.stringify({ migratedRows: rows.length, stableRows: groups.size }), nowText()]
    );
  });
  if (rows.length) {
    console.info(`[Production followup migration] ${rows.length} legacy rows -> ${groups.size} stable rows`);
  }
}

function progressSaveRequest(req) {
  const suppliedRequestId = normalize(req.headers['x-idempotency-key'] || req.body?.requestId);
  const requestId = suppliedRequestId || randomUUID();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
    const error = new Error('提交请求标识无效');
    error.status = 400;
    throw error;
  }
  const existing = get('SELECT * FROM production_progress_save_requests WHERE request_id = ?', [requestId]);
  if (existing && normalize(existing.user_id) !== normalize(req.user?.id)) {
    const error = new Error('提交请求标识已被其他用户使用');
    error.status = 409;
    throw error;
  }
  const requestedTrackingKey = normalize(req.body?.trackingKey);
  const existingTrackingKeys = existing ? new Set([
    normalize(existing.tracking_key),
    progressFollowupTrackingKey(existing.demand_key, existing.order_no),
    progressFollowupTrackingKey(existing.demand_key, existing.order_no, productionFollowupMaterialCode(existing))
  ].filter(Boolean)) : new Set();
  if (existing && requestedTrackingKey && !existingTrackingKeys.has(requestedTrackingKey)) {
    const error = new Error('提交请求标识与采购订单不匹配');
    error.status = 409;
    throw error;
  }
  return { requestId, existing };
}

function saveProgressRequest({ requestId, userId, trackingKey, demandKey, orderNo = '', savedAt }) {
  run(
    `INSERT INTO production_progress_save_requests (
       request_id, user_id, tracking_key, demand_key, order_no, saved_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      normalize(requestId), normalize(userId), normalize(trackingKey), normalize(demandKey),
      normalize(orderNo), normalize(savedAt)
    ]
  );
}

function progressSavePayload(saveRequest, values = {}, replayed = false) {
  const source = saveRequest.existing || values;
  return {
    ok: true,
    requestId: saveRequest.requestId,
    trackingKey: normalize(source.tracking_key || source.trackingKey),
    demandKey: normalize(source.demand_key || source.demandKey),
    orderNo: normalize(source.order_no || source.orderNo),
    savedAt: normalize(source.saved_at || source.savedAt),
    followupMarkedBySubmission: Boolean(values.followupMarkedBySubmission),
    followupPreviouslyThisWeek: Boolean(values.followupPreviouslyThisWeek),
    followupStatus: normalize(values.followupStatus) || '未跟进',
    replayed
  };
}

function normalize(value) {
  return String(value ?? '').trim();
}

function normalizeMatchPart(value) {
  return normalize(value)
    .normalize('NFKC')
    .replace(/[\s\u00a0\u200b-\u200d\ufeff]/g, '')
    .replace(/\.0$/, '');
}

function assignmentKey(supplier, materialCode) {
  return [normalizeMatchPart(supplier), normalizeMatchPart(materialCode)].join('|');
}

function numberValue(value) {
  const n = Number(normalize(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function productionStageNeedsAdjustment(remainingQty, unpreparedQty, preparedNotStartedQty, inProductionQty, finishedQty) {
  return Math.abs(productionStageGap(remainingQty, unpreparedQty, preparedNotStartedQty, inProductionQty, finishedQty)) > 0.000001;
}

function productionStageGap(remainingQty, unpreparedQty, preparedNotStartedQty, inProductionQty, finishedQty) {
  const progressTotal = numberValue(unpreparedQty) + numberValue(preparedNotStartedQty)
    + numberValue(inProductionQty) + numberValue(finishedQty);
  return numberValue(remainingQty) - progressTotal;
}

function actionsForDelta(deltaQty) {
  const value = numberValue(deltaQty);
  if (value > 0) return ['增加', '其他'];
  if (value < 0) return ['减少', '取消', '其他'];
  return ['其他'];
}

function allocationActionsForReason(deltaQty, reason) {
  const actions = actionsForDelta(deltaQty);
  const normalizedReason = normalize(reason);
  if (normalizedReason === DIFF_NORMAL_ORDER) return [DIFF_NORMAL_ORDER];
  if (normalizedReason === DIFF_ORDER_COMPLETE_REASON || normalizedReason === DIFF_LEGACY_ORDER_COMPLETE_REASON) return [DIFF_ORDER_COMPLETE_ACTION];
  return actions;
}

function monthFromDate(value) {
  const text = normalize(value).replace(/\./g, '-').replace(/\//g, '-');
  if (!text) return '';
  const match = text.match(/^(\d{4})-(\d{1,2})/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
}

function dateSortValue(value) {
  const text = normalize(value).replace(/\./g, '-').replace(/\//g, '-');
  if (!text) return Number.MAX_SAFE_INTEGER;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  const match = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3] || 1)).getTime();
}

function progressDateValue(value, label) {
  const text = normalize(value);
  if (!text) return '';
  const normalized = normalizeProgressDateValue(text);
  if (normalized) return normalized;
  const error = new Error(`${label}不是有效日期，请选择日期后再提交`);
  error.status = 400;
  throw error;
}

function progressQuantityValue(value, fallback, label) {
  if (value === undefined || value === null || normalize(value) === '') return Math.max(0, numberValue(fallback));
  const parsed = Number(normalize(value).replace(/,/g, ''));
  if (!Number.isFinite(parsed) || parsed < 0) {
    const error = new Error(`${label}必须是大于等于0的有效数量`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function demandKey(purchaseOrg, month, businessUnit, supplier, materialCode) {
  return [purchaseOrg, month, normalize(businessUnit) || UNASSIGNED_BUSINESS_UNIT, supplier, materialCode].map(normalize).join('|');
}

function displayDemandKey(row) {
  return [
    row.purchaseOrg || row.purchase_org,
    row.month,
    row.businessUnit || row.business_unit,
    supplierNameForRow(row)
  ].map(normalize).filter(Boolean).join('|');
}

function supplierNameForRow(row) {
  return normalize(row.supplierShortName || row.supplier_short_name) || normalize(row.supplier);
}

function displayKeyFromDemandKey(value) {
  const parts = normalize(value).split('|');
  return parts.length >= 5 ? parts.slice(0, 4).join('|') : normalize(value);
}

function displayKeyForCompareRow(row) {
  return [
    row.purchase_org,
    row.month,
    row.business_unit,
    normalize(row.supplier_short_name) || normalize(row.supplier)
  ].map(normalize).filter(Boolean).join('|');
}

function stockKey(businessUnit, supplier, materialCode) {
  return [businessUnit, supplier, materialCode].map(normalize).join('|');
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function pageAccessFor(user) {
  if (user.role === ROLE_ADMIN) return ALL_PAGES;
  return parseJson(user.page_access, []);
}

function userPayload(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    pageAccess: pageAccessFor(user)
  };
}

async function ensureAdmin() {
  return;
}

async function requireAuth(req, res, next) {
  req.user = { id: 'local', name: ADMIN_NAME, role: ROLE_ADMIN, page_access: JSON.stringify(ALL_PAGES) };
  next();
}

function requirePage(page) {
  return (req, res, next) => {
    if (req.user.role === ROLE_ADMIN || pageAccessFor(req.user).includes(page)) return next();
    return res.status(403).json({ error: '没有页面权限' });
  };
}

function requireAnyPage(pages) {
  return (req, res, next) => {
    const access = pageAccessFor(req.user);
    if (req.user.role === ROLE_ADMIN || pages.some((page) => access.includes(page))) return next();
    return res.status(403).json({ error: '没有页面权限' });
  };
}

function requireAdmin(req, res, next) {
  if (req.user.role === ROLE_ADMIN) return next();
  return res.status(403).json({ error: '仅管理员可操作' });
}

function requireSystemOwner(req, res, next) {
  if (req.user?.role === ROLE_ADMIN && normalize(req.user?.name) === normalize(ADMIN_NAME)) return next();
  return res.status(403).json({ error: `仅管理员${ADMIN_NAME}可操作` });
}

function safeFilename(file) {
  return Buffer.from(file.originalname, 'latin1').toString('utf8');
}

let auditSaveTimer = null;

function auditIpAddress(req) {
  const forwarded = normalize(req.headers['x-forwarded-for']).split(',')[0].trim();
  return forwarded
    || normalize(req.headers['x-real-ip'])
    || normalize(req.socket?.remoteAddress).replace(/^::ffff:/, '')
    || '未知';
}

function auditPageForRequest(req) {
  const requestPath = req.path;
  if (requestPath.startsWith('/api/auth/')) return { key: 'system', label: '系统登录' };
  if (requestPath.startsWith('/api/supply-plan')) return { key: 'supplyPlanBoard', label: PAGE_LABELS.supplyPlanBoard };
  if (requestPath.startsWith('/api/product-projects')) return { key: 'productArchive', label: PAGE_LABELS.productArchive };
  if (requestPath.startsWith('/api/product-archive')) return { key: 'productArchive', label: PAGE_LABELS.productArchive };
  if (requestPath.startsWith('/api/inventory-risk')) return { key: 'inventoryRisk', label: PAGE_LABELS.inventoryRisk };
  if (requestPath.startsWith('/api/bei-huo-gong-ju')) return { key: 'beiHuoGongJu', label: PAGE_LABELS.beiHuoGongJu };
  if (requestPath.startsWith('/api/bei-huo-review')) return { key: 'beiHuoGongJu', label: PAGE_LABELS.beiHuoGongJu };
  if (requestPath.startsWith('/api/inventory-summary')) return { key: 'inventorySummary', label: PAGE_LABELS.inventorySummary };
  if (requestPath.startsWith('/api/full-inventory-summary')) return { key: 'fullInventorySummary', label: PAGE_LABELS.fullInventorySummary };
  if (requestPath.startsWith('/api/operation-logs')) return { key: 'operationLogs', label: PAGE_LABELS.operationLogs };
  if (requestPath.startsWith('/api/progress')) return { key: 'progressRefresh', label: PAGE_LABELS.progressRefresh };
  if (requestPath.startsWith('/api/difference')) return { key: 'progressRefresh', label: PAGE_LABELS.progressRefresh };
  if (requestPath.startsWith('/api/imports/kingdee') || requestPath.startsWith('/api/mappings/kingdee')) return { key: 'kingdeeImport', label: PAGE_LABELS.kingdeeImport };
  if (requestPath.startsWith('/api/first-mile-board')) return { key: 'firstMileBoard', label: PAGE_LABELS.firstMileBoard };
  if (requestPath.startsWith('/api/cross-border-inventory')) return { key: 'crossBorderInventory', label: PAGE_LABELS.crossBorderInventory };
  if (requestPath.startsWith('/api/dimension-missing')) return { key: 'dimensionMissing', label: PAGE_LABELS.dimensionMissing };
  if (requestPath.startsWith('/api/domestic-board')) return { key: 'domesticBoard', label: PAGE_LABELS.domesticBoard };
  if (requestPath.startsWith('/api/change-notes')) return { key: 'trace', label: PAGE_LABELS.trace };
  if (requestPath.startsWith('/api/users')) return { key: 'permissions', label: PAGE_LABELS.permissions };
  if (requestPath.startsWith('/api/dimensions') || requestPath.startsWith('/api/workbook/inspect')) {
    const pathSlot = requestPath.match(/^\/api\/dimensions\/([^/]+)/)?.[1];
    const slotId = normalize(pathSlot || req.body?.slotId);
    if (slotId.startsWith('businessUnitFeedback')) return { key: 'businessUnitFeedback', label: PAGE_LABELS.businessUnitFeedback };
    if (slotId.startsWith('firstMile')) return { key: 'firstMileDatabase', label: PAGE_LABELS.firstMileDatabase };
    if (slotId.startsWith('wangdian')) return { key: 'wangdianData', label: PAGE_LABELS.wangdianData };
    if (slotId.startsWith('lingxingF')) return { key: 'lingxingInventory', label: PAGE_LABELS.lingxingInventory };
    if (slotId.startsWith('inventorySummaryFile')) return { key: 'inventorySummaryLibrary', label: PAGE_LABELS.inventorySummaryLibrary };
    if (isInventoryManualSlot(slotId)) return { key: 'inventoryManualLibrary', label: PAGE_LABELS.inventoryManualLibrary };
    if (slotId.startsWith('beiHuoReviewFile')) return { key: 'beiHuoReviewLibrary', label: PAGE_LABELS.beiHuoReviewLibrary };
    if (slotId.startsWith('fullInventoryFile')) return { key: 'fullInventoryLibrary', label: PAGE_LABELS.fullInventoryLibrary };
    return { key: 'dimensionLibrary', label: PAGE_LABELS.dimensionLibrary };
  }
  return { key: 'system', label: '系统操作' };
}

function auditActionForRequest(req) {
  const requestPath = req.path;
  if (requestPath === '/api/auth/login') return '登录系统';
  if (requestPath === '/api/auth/logout') return '退出登录';
  if (requestPath === '/api/operation-logs/export') return '导出操作日志';
  if (requestPath.includes('/export')) return '导出数据';
  if (requestPath === '/api/progress/clear-preview') return '预览清除生产跟进范围';
  if (requestPath === '/api/progress/clear') return '清除生产跟进数据';
  if (requestPath.includes('/preview') || requestPath === '/api/workbook/inspect') return '解析预览';
  if (requestPath.includes('/test-cache') || requestPath.endsWith('/cache')) return '清除采购订单缓存';
  if (requestPath === '/api/users/bulk-delete' && req.method === 'POST') return '批量删除用户';
  if (requestPath.startsWith('/api/users') && req.method === 'POST') return '创建用户';
  if (requestPath.startsWith('/api/users') && req.method === 'PATCH' && normalize(req.body?.password)) return '重置用户密码';
  if (requestPath.startsWith('/api/users') && req.method === 'PATCH' && Array.isArray(req.body?.pageAccess)) return '分配页面权限';
  if (requestPath.includes('/reallocate')) return '重新分配生产进度';
  if (requestPath.startsWith('/api/progress') && requestPath.includes('/bulk')) return '批量提交生产跟进';
  if (requestPath.startsWith('/api/progress') && requestPath.includes('/import')) return '导入生产跟进';
  if (requestPath.startsWith('/api/progress')) return '提交生产跟进';
  if (requestPath.startsWith('/api/difference') && requestPath.includes('/allocations')) return '提交差异分配';
  if (requestPath.startsWith('/api/imports/kingdee') && requestPath.includes('/apply')) return '应用采购订单';
  if (requestPath.startsWith('/api/imports/kingdee')) return '上传采购订单';
  if (requestPath.startsWith('/api/dimensions') && requestPath.includes('/upload')) return '上传数据文件';
  if (requestPath.startsWith('/api/dimensions') && requestPath.includes('/apply')) return '应用数据文件';
  if (requestPath.startsWith('/api/dimensions') && req.method === 'DELETE') return '删除数据文件';
  if (requestPath.startsWith('/api/domestic-board') && requestPath.includes('/bulk')) return '批量提交国内看板';
  if (requestPath.startsWith('/api/domestic-board')) return '提交国内看板';
  if (requestPath.startsWith('/api/change-notes')) return '新增变更记录';
  if (req.method === 'DELETE') return '删除数据';
  if (req.method === 'PATCH' || req.method === 'PUT') return '修改数据';
  return '提交数据';
}

function auditTargetForRequest(req) {
  if (req.auditTarget) return normalize(req.auditTarget).slice(0, 500);
  if (req.file) return safeFilename(req.file);
  const body = req.body || {};
  const target = body.name || body.demandKey || body.merchantCode || body.rowId || body.id;
  if (target) return normalize(target).slice(0, 500);
  return normalize(req.path.replace(/^\/api\//, '')).slice(0, 500);
}

function auditDetailsForRequest(req) {
  if (req.auditDetails) return normalize(req.auditDetails).slice(0, 2000);
  if (req.file) return `文件：${safeFilename(req.file).slice(0, 500)}，大小：${Math.ceil(numberValue(req.file.size) / 1024)} KB`;
  if (Array.isArray(req.body?.rows)) return `提交 ${req.body.rows.length} 条记录`;
  if (Array.isArray(req.body?.userIds)) return `选择 ${req.body.userIds.length} 名用户`;
  if (Array.isArray(req.body?.pageAccess)) return `页面权限 ${req.body.pageAccess.length} 项`;
  if (req.path.includes('/export')) return '导出当前筛选结果';
  return '';
}

function scheduleAuditSave() {
  if (auditSaveTimer) clearTimeout(auditSaveTimer);
  auditSaveTimer = setTimeout(() => {
    auditSaveTimer = null;
    try {
      saveDatabase();
    } catch (error) {
      console.error(`[${nowText()}] Failed to persist operation log:`, error);
    }
  }, 800);
}

function recordOperation(req, statusCode) {
  const auditUser = req.auditUser || req.user || {};
  const attemptedName = req.path === '/api/auth/login' ? normalize(req.body?.name).slice(0, 200) : '';
  const page = auditPageForRequest(req);
  const action = auditActionForRequest(req);
  run(
    `INSERT INTO operation_logs (
       id, user_id, user_name, user_role, event_type, page_key, page_label,
       action, target, details, ip_address, user_agent, method, request_path,
       status_code, result, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(), normalize(auditUser.id).slice(0, 200), normalize(auditUser.name).slice(0, 200) || attemptedName || '未登录用户',
      normalize(auditUser.role).slice(0, 100), req.path.startsWith('/api/auth/') ? '登录' : '操作', page.key, page.label,
      action, auditTargetForRequest(req), auditDetailsForRequest(req), auditIpAddress(req),
      normalize(req.headers['user-agent']).slice(0, 1000), req.method, normalize(req.originalUrl || req.path).slice(0, 1000),
      statusCode, statusCode < 400 ? '成功' : '失败', nowText()
    ]
  );
  scheduleAuditSave();
}

app.use((req, res, next) => {
  const shouldAudit = req.path.startsWith('/api/')
    && (req.method !== 'GET' || req.path.includes('/export'));
  if (shouldAudit) {
    res.on('finish', () => {
      try {
        recordOperation(req, res.statusCode);
      } catch (error) {
        console.error(`[${nowText()}] Failed to record operation ${req.method} ${req.path}:`, error);
      }
    });
  }
  next();
});

const HEADER_HINTS = [
  '物料编码', '物流编码', 'SKU', '物料名称', '产品名称', '供应商', '供应商简称',
  '产品明细供应商', '产品线明细供应商', '采购下单人', '创建人', '采购组', '采购组织', '产品线', '系列',
  '事业部', '采购日期', '创建日期', '采购数量', '下单数量', '入库数量', '采购订单号', 'OA备货流程号', '备注', '手工关闭',
  '仓库编码', '仓库代码', '仓库名称', '仓位位置', '仓库位置', '站点', '站点名称', '一级仓库分类', '二级仓库分类', '一级分类', '二级分类'
];

function compactHeader(value) {
  return normalize(value).replace(/\s+/g, '').toLowerCase();
}

function headerScore(values) {
  const cells = values.map(compactHeader).filter(Boolean);
  if (!cells.length) return 0;
  const hints = HEADER_HINTS.map(compactHeader).filter(Boolean);
  const hintScore = cells.reduce((total, cell) => {
    const best = hints.reduce((score, hint) => {
      if (cell === hint) return Math.max(score, 30);
      if (hint.length >= 2 && cell.length <= hint.length + 8 && (cell.startsWith(hint) || cell.endsWith(hint))) {
        return Math.max(score, 18);
      }
      if (hint.length >= 3 && cell.length <= hint.length + 8 && cell.includes(hint)) {
        return Math.max(score, 10);
      }
      return score;
    }, 0);
    return total + best;
  }, 0);
  return hintScore + Math.min(cells.length, 12) + (cells.length >= 2 ? 5 : 0);
}

function uniqueColumns(values) {
  const seen = new Map();
  return values.map((value, index) => {
    const column = normalize(value);
    if (!column) return '';
    const count = seen.get(column) || 0;
    seen.set(column, count + 1);
    return count ? `${column}_${count + 1}` : column;
  });
}

function sheetData(sheet) {
  if (!sheet?.['!ref']) return { columns: [], rowCount: 0, previewRows: [], rows: [], headerRow: 0 };
  const aoa = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
  if (!aoa.length) return { columns: [], rowCount: 0, previewRows: [], rows: [], headerRow: 0 };
  const scanRows = aoa.slice(0, Math.min(10, aoa.length));
  const best = scanRows
    .map((values, index) => ({ index, score: headerScore(values) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0];
  const headerIndex = best && best.score > 0 ? best.index : 0;
  const rowColumns = uniqueColumns(aoa[headerIndex] || []);
  const columns = rowColumns.filter(Boolean);
  const rows = aoa.slice(headerIndex + 1).map((values) => {
    const row = {};
    rowColumns.forEach((column, index) => {
      if (column) row[column] = values[index] ?? '';
    });
    return row;
  }).filter((row) => Object.values(row).some((value) => normalize(value)));
  return { columns, rowCount: rows.length, previewRows: rows.slice(0, 8), rows, headerRow: headerIndex + 1 };
}

function workbookSheetNames(file) {
  if (!file?.buffer) throw new Error('未收到上传文件');
  return xlsx.read(file.buffer, { type: 'buffer', bookSheets: true, WTF: false }).SheetNames || [];
}

async function workbookChoiceInspect(file) {
  const sheetNames = await workbookSheetNamesFromUpload(file);
  return {
    sheetNames,
    sheetPreviews: sheetNames.map((sheetName) => ({
      sheetName,
      columns: [],
      rowCount: null,
      previewRows: [],
      headerRow: 0
    })),
    columns: ['工作表'],
    previewRows: [],
    rowCount: null,
    totalRowCount: null,
    headerRow: 0,
    lightweight: true
  };
}

function workbookRows(file, sheetName = null, options = {}) {
  if (!file?.buffer) throw new Error('未收到上传文件');
  const selectedSheetNames = (Array.isArray(sheetName) ? sheetName : sheetName ? [sheetName] : [])
    .map(normalize)
    .filter((name, index, names) => name && names.indexOf(name) === index);
  const workbook = xlsx.read(file.buffer, {
    type: 'buffer',
    cellDates: true,
    dense: true,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    WTF: false,
    ...(selectedSheetNames.length ? { sheets: selectedSheetNames } : {})
  });
  const preferredSheet = !selectedSheetNames.length && options.preferredSheetPatterns?.length
    ? workbook.SheetNames.find((name) => options.preferredSheetPatterns.some((pattern) => pattern.test(name)))
    : '';
  const targetSheets = selectedSheetNames.length
    ? workbook.SheetNames.filter((name) => selectedSheetNames.includes(name))
    : preferredSheet
      ? [preferredSheet]
      : workbook.SheetNames;
  const parsedRows = new Map();
  const getSheetData = (name) => {
    if (!parsedRows.has(name)) {
      parsedRows.set(name, sheetData(workbook.Sheets[name]));
    }
    return parsedRows.get(name);
  };
  const sheets = targetSheets.map((name) => {
    const data = getSheetData(name);
    return { sheetName: name, rows: data.rows, columns: data.columns, headerRow: data.headerRow };
  });
  const includePreviews = options.includePreviews !== false;
  const sheetPreviews = includePreviews ? workbook.SheetNames.map((name) => {
    if (parsedRows.has(name)) {
      const data = parsedRows.get(name);
      return { sheetName: name, columns: data.columns, rowCount: data.rowCount, previewRows: data.previewRows, headerRow: data.headerRow };
    }
    const data = sheetData(workbook.Sheets[name]);
    return { sheetName: name, columns: data.columns, rowCount: data.rowCount, previewRows: data.previewRows, headerRow: data.headerRow };
  }) : [];
  return { sheetNames: workbook.SheetNames, sheetPreviews, sheets, rows: sheets.flatMap((sheet) => sheet.rows) };
}

function rowObject(columns, values) {
  const row = {};
  columns.forEach((column, index) => {
    const value = values[index] ?? '';
    if (column && normalize(value)) row[column] = value;
  });
  return row;
}

function xmlName(name) {
  return String(name || '').split(':').pop();
}

function xmlAttribute(node, name) {
  const entry = Object.entries(node?.attributes || {}).find(([key]) => key === name || xmlName(key) === name);
  return entry?.[1] ?? '';
}

function parseXmlStream(stream, handlers = {}) {
  return new Promise((resolve, reject) => {
    const parser = new SaxesParser({ xmlns: false, position: false });
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      stream.destroy?.();
      reject(error);
    };
    parser.on('opentag', (node) => handlers.open?.(node));
    parser.on('text', (text) => handlers.text?.(text));
    parser.on('closetag', (node) => handlers.close?.(node));
    parser.on('error', fail);
    stream.on('error', fail);
    stream.on('data', (chunk) => {
      if (settled) return;
      try {
        parser.write(chunk.toString('utf8'));
      } catch (error) {
        fail(error);
      }
    });
    stream.on('end', () => {
      if (settled) return;
      try {
        parser.close();
        settled = true;
        resolve();
      } catch (error) {
        fail(error);
      }
    });
  });
}

async function workbookSheetDefinitions(directory) {
  const workbookEntry = directory.files.find((entry) => entry.path === 'xl/workbook.xml');
  const relationshipsEntry = directory.files.find((entry) => entry.path === 'xl/_rels/workbook.xml.rels');
  const sheets = [];
  const relationships = new Map();
  if (workbookEntry) {
    await parseXmlStream(workbookEntry.stream(), {
      open(node) {
        if (xmlName(node.name) !== 'sheet') return;
        sheets.push({
          name: String(xmlAttribute(node, 'name') || ''),
          relationshipId: String(xmlAttribute(node, 'id') || '')
        });
      }
    });
  }
  if (relationshipsEntry) {
    await parseXmlStream(relationshipsEntry.stream(), {
      open(node) {
        if (xmlName(node.name) !== 'Relationship') return;
        relationships.set(String(xmlAttribute(node, 'Id') || ''), String(xmlAttribute(node, 'Target') || ''));
      }
    });
  }
  return sheets.map((sheet, index) => {
    const rawTarget = relationships.get(sheet.relationshipId) || `worksheets/sheet${index + 1}.xml`;
    const target = rawTarget.replace(/^\/+/, '').replace(/^\.\//, '');
    return {
      name: sheet.name || `Sheet${index + 1}`,
      path: target.startsWith('xl/') ? target : `xl/${target}`
    };
  });
}

async function workbookSheetNamesFromUpload(file) {
  if (!file?.path && !file?.buffer) throw new Error('未收到上传文件');
  const extension = path.extname(file.originalname || file.path || '').toLowerCase();
  if (extension !== '.xlsx') {
    const buffer = file.buffer || await fs.promises.readFile(file.path);
    return workbookSheetNames({ ...file, buffer });
  }
  const directory = file.path
    ? await unzipper.Open.file(file.path)
    : await unzipper.Open.buffer(file.buffer);
  return (await workbookSheetDefinitions(directory)).map((sheet) => sheet.name);
}

async function readSharedStrings(directory) {
  const entry = directory.files.find((item) => item.path === 'xl/sharedStrings.xml');
  if (!entry) return [];
  const values = [];
  let inText = false;
  let current = '';
  await parseXmlStream(entry.stream(), {
    open(node) {
      const name = xmlName(node.name);
      if (name === 'si') current = '';
      if (name === 't') inText = true;
    },
    text(text) {
      if (inText) current += text;
    },
    close(node) {
      const name = xmlName(node.name);
      if (name === 't') inText = false;
      if (name === 'si') values.push(current);
    }
  });
  return values;
}

function dateNumberFormat(numFmtId, customFormats) {
  const builtInDateIds = new Set([
    14, 15, 16, 17, 18, 19, 20, 21, 22,
    27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
    45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58
  ]);
  if (builtInDateIds.has(numFmtId)) return true;
  const format = customFormats.get(numFmtId) || '';
  return /(^|[^\\])[ymdhis]/i.test(format.replace(/"[^"]*"/g, ''));
}

async function readDateStyleIndexes(directory) {
  const entry = directory.files.find((item) => item.path === 'xl/styles.xml');
  if (!entry) return new Set();
  const customFormats = new Map();
  const styleFormats = [];
  let inCellFormats = false;
  await parseXmlStream(entry.stream(), {
    open(node) {
      const name = xmlName(node.name);
      if (name === 'numFmt') {
        customFormats.set(Number(xmlAttribute(node, 'numFmtId')), String(xmlAttribute(node, 'formatCode') || ''));
      } else if (name === 'cellXfs') {
        inCellFormats = true;
      } else if (name === 'xf' && inCellFormats) {
        styleFormats.push(Number(xmlAttribute(node, 'numFmtId')));
      }
    },
    close(node) {
      if (xmlName(node.name) === 'cellXfs') inCellFormats = false;
    }
  });
  return new Set(
    styleFormats
      .map((numFmtId, index) => dateNumberFormat(numFmtId, customFormats) ? index : -1)
      .filter((index) => index >= 0)
  );
}

function worksheetColumnIndex(reference, fallback) {
  const letters = String(reference || '').match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) return fallback;
  return letters.split('').reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function worksheetCellValue(cell, sharedStrings, dateStyleIndexes) {
  const raw = cell.text;
  if (cell.type === 's') return sharedStrings[Number(raw)] ?? '';
  if (cell.type === 'inlineStr' || cell.type === 'str') return raw;
  if (cell.type === 'b') return raw === '1';
  if (cell.type === 'e' || raw === '') return '';
  const number = Number(raw);
  if (!Number.isFinite(number)) return raw;
  if (dateStyleIndexes.has(cell.styleIndex)) {
    const parsed = xlsx.SSF.parse_date_code(number);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  return number;
}

async function streamWorksheetData(entry, sheetName, sharedStrings, dateStyleIndexes, options = {}) {
  const prefixRows = [];
  const rows = [];
  const maxStoredRows = Number.isFinite(options.maxStoredRows)
    ? Math.max(0, Number(options.maxStoredRows))
    : Infinity;
  let rowCount = 0;
  let columns = [];
  let headerRow = 0;
  let detectedHeaderScore = 0;
  const initializeHeader = () => {
    if (columns.length || !prefixRows.length) return;
    const best = prefixRows
      .map((values, index) => ({ index, score: headerScore(values) }))
      .sort((left, right) => right.score - left.score || left.index - right.index)[0];
    const headerIndex = best && best.score > 0 ? best.index : 0;
    detectedHeaderScore = best?.score || 0;
    columns = uniqueColumns(prefixRows[headerIndex] || []);
    headerRow = headerIndex + 1;
    prefixRows.slice(headerIndex + 1).forEach((values) => {
      const row = rowObject(columns, values);
      if (!Object.values(row).some((value) => normalize(value))) return;
      rowCount += 1;
      if (rows.length < maxStoredRows) rows.push(row);
    });
  };

  const addValues = (values) => {
    if (prefixRows.length < 10) {
      prefixRows.push(values);
      if (prefixRows.length === 10) initializeHeader();
      return;
    }
    const row = rowObject(columns, values);
    if (!Object.values(row).some((value) => normalize(value))) return;
    rowCount += 1;
    if (rows.length < maxStoredRows) rows.push(row);
    if (rowCount > 200000) {
      const error = new Error('采购订单超过20万行，请拆分或清理无效行后重试');
      error.status = 400;
      error.publicMessage = error.message;
      throw error;
    }
  };

  let currentRow = null;
  let currentCell = null;
  let captureValue = false;
  await parseXmlStream(entry.stream(), {
    open(node) {
      const name = xmlName(node.name);
      if (name === 'row') {
        currentRow = [];
      } else if (name === 'c' && currentRow) {
        currentCell = {
          columnIndex: worksheetColumnIndex(xmlAttribute(node, 'r'), currentRow.length),
          type: String(xmlAttribute(node, 't') || ''),
          styleIndex: Number(xmlAttribute(node, 's') || 0),
          text: ''
        };
      } else if ((name === 'v' || name === 't') && currentCell) {
        captureValue = true;
      }
    },
    text(text) {
      if (captureValue && currentCell) currentCell.text += text;
    },
    close(node) {
      const name = xmlName(node.name);
      if (name === 'v' || name === 't') {
        captureValue = false;
      } else if (name === 'c' && currentCell && currentRow) {
        if (currentCell.columnIndex < 160) {
          currentRow[currentCell.columnIndex] = worksheetCellValue(currentCell, sharedStrings, dateStyleIndexes);
        }
        currentCell = null;
      } else if (name === 'row' && currentRow) {
        addValues(currentRow);
        currentRow = null;
      }
    }
  });
  initializeHeader();
  return {
    sheetName,
    rows,
    rowCount,
    columns: columns.filter(Boolean),
    headerRow,
    detectedHeaderScore
  };
}

async function streamingWorkbookInspect(file, sheetName = null) {
  const extension = path.extname(file?.originalname || file?.path || '').toLowerCase();
  if (extension !== '.xlsx') {
    const buffer = file?.buffer || await fs.promises.readFile(file.path);
    return workbookInspect({ ...file, buffer }, sheetName);
  }

  const directory = await unzipper.Open.file(file.path);
  const definedSheets = await workbookSheetDefinitions(directory);
  const worksheetEntries = directory.files
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.path))
    .map((entry, index) => ({
      name: definedSheets.find((sheet) => sheet.path === entry.path)?.name || `Sheet${index + 1}`,
      entry
    }));
  const sharedStrings = await readSharedStrings(directory);
  const dateStyleIndexes = await readDateStyleIndexes(directory);
  const sheetPreviews = [];
  for (const worksheet of worksheetEntries) {
    const data = await streamWorksheetData(
      worksheet.entry,
      worksheet.name,
      sharedStrings,
      dateStyleIndexes,
      { maxStoredRows: 8 }
    );
    sheetPreviews.push({
      sheetName: worksheet.name,
      columns: data.columns,
      rowCount: data.rowCount,
      previewRows: data.rows,
      headerRow: data.headerRow
    });
  }
  const sheetNames = sheetPreviews.map((sheet) => sheet.sheetName);
  const targetName = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0];
  const target = sheetPreviews.find((sheet) => sheet.sheetName === targetName)
    || { columns: [], previewRows: [], rowCount: 0, headerRow: 0 };
  const totalRowCount = sheetPreviews.reduce((sum, sheet) => sum + numberValue(sheet.rowCount), 0);
  return {
    sheetNames,
    sheetPreviews,
    columns: target.columns,
    previewRows: target.previewRows,
    rowCount: sheetName ? target.rowCount : totalRowCount,
    totalRowCount,
    headerRow: target.headerRow,
    streaming: true
  };
}

async function streamingKingdeeWorkbookRows(file, sheetName = null, options = {}) {
  const extension = path.extname(file?.originalname || file?.path || '').toLowerCase();
  if (extension !== '.xlsx') {
    const buffer = file?.buffer || fs.readFileSync(file.path);
    return workbookRows({ ...file, buffer }, sheetName, options);
  }

  const directory = await unzipper.Open.file(file.path);
  const definedSheets = await workbookSheetDefinitions(directory);
  const worksheetEntries = directory.files
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.path))
    .map((entry, index) => ({
      name: definedSheets.find((sheet) => sheet.path === entry.path)?.name || `Sheet${index + 1}`,
      path: entry.path,
      entry
    }));
  const sharedStrings = await readSharedStrings(directory);
  const dateStyleIndexes = await readDateStyleIndexes(directory);
  const sheetNames = worksheetEntries.map((sheet) => sheet.name);
  const requestedSheetNames = (Array.isArray(sheetName) ? sheetName : sheetName ? [sheetName] : [])
    .map(normalize)
    .filter((name, index, names) => name && names.indexOf(name) === index);
  const explicitSheets = requestedSheetNames
    .map((name) => worksheetEntries.find((sheet) => sheet.name === name))
    .filter(Boolean);
  const preferredSheet = !requestedSheetNames.length
    ? worksheetEntries.find((sheet) => options.preferredSheetPatterns?.some((pattern) => pattern.test(sheet.name)))
    : null;
  const candidates = requestedSheetNames.length
    ? explicitSheets
    : preferredSheet
      ? [preferredSheet]
      : worksheetEntries;
  if (requestedSheetNames.length) {
    const sheets = [];
    for (const worksheet of candidates) {
      const data = await streamWorksheetData(worksheet.entry, worksheet.name, sharedStrings, dateStyleIndexes);
      const rows = options.stringifyValues
        ? data.rows.map((row) => Object.fromEntries(
          Object.entries(row).map(([column, value]) => [column, normalize(value)])
        ))
        : data.rows;
      sheets.push({
        sheetName: data.sheetName,
        rows,
        columns: data.columns,
        headerRow: data.headerRow
      });
    }
    return { sheetNames, sheetPreviews: [], sheets, rows: sheets.flatMap((sheet) => sheet.rows) };
  }
  let fallbackSheet = null;
  for (const worksheet of candidates) {
    const data = await streamWorksheetData(worksheet.entry, worksheet.name, sharedStrings, dateStyleIndexes);
    data.mappingMatchCount = Object.values(options.mapping || {})
      .filter((column) => column && data.columns.includes(column))
      .length;
    const candidateScore = data.mappingMatchCount * 1000 + data.detectedHeaderScore;
    const fallbackScore = (fallbackSheet?.mappingMatchCount || 0) * 1000 + (fallbackSheet?.detectedHeaderScore || 0);
    if (!fallbackSheet || candidateScore > fallbackScore) {
      fallbackSheet = data;
    }
  }
  const target = fallbackSheet;
  if (!target) return { sheetNames, sheetPreviews: [], sheets: [], rows: [] };
  return { sheetNames, sheetPreviews: [], sheets: [target], rows: target.rows };
}

async function removeUploadedFile(file) {
  if (!file?.path) return;
  await fs.promises.rm(file.path, { force: true }).catch(() => {});
}

function cleanupKingdeeUpload(req, res, next) {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    void removeUploadedFile(req.file);
  };
  res.once('finish', cleanup);
  res.once('close', cleanup);
  next();
}

function dimensionWorkbookUpload(req, res, next) {
  const slotId = normalize(req.params?.slotId);
  const baseSlotId = inventoryLibraryBaseSlotId(slotId);
  const useDisk = isInventoryLibrarySlot(slotId)
    || ['inventorySummaryFile15', 'inventorySummaryFile16'].includes(baseSlotId);
  const middleware = (useDisk ? kingdeeUpload : upload).single('file');
  return middleware(req, res, next);
}

let inventoryUploadQueue = Promise.resolve();

function serializeInventoryUpload(req, res, next) {
  if (!isInventoryLibrarySlot(req.params?.slotId)) return next();
  let release;
  const previous = inventoryUploadQueue;
  inventoryUploadQueue = new Promise((resolve) => { release = resolve; });
  previous.catch(() => {}).then(() => {
    let released = false;
    const releaseQueue = () => {
      if (released) return;
      released = true;
      release();
    };
    res.once('finish', releaseQueue);
    res.once('close', releaseQueue);
    next();
  });
}

function workbookInspect(file, sheetName = null) {
  if (!file?.buffer) throw new Error('未收到上传文件');
  const workbook = xlsx.read(file.buffer, { type: 'buffer', cellDates: true });
  const sheetPreviews = workbook.SheetNames.map((name) => {
    const data = sheetData(workbook.Sheets[name]);
    return { sheetName: name, columns: data.columns, rowCount: data.rowCount, previewRows: data.previewRows, headerRow: data.headerRow };
  });
  const targetName = sheetName && workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
  const target = sheetPreviews.find((sheet) => sheet.sheetName === targetName) || { columns: [], previewRows: [], rowCount: 0, headerRow: 0 };
  const totalRowCount = sheetPreviews.reduce((sum, sheet) => sum + numberValue(sheet.rowCount), 0);
  return {
    sheetNames: workbook.SheetNames,
    sheetPreviews,
    columns: target.columns,
    previewRows: target.previewRows,
    rowCount: sheetName ? target.rowCount : totalRowCount,
    totalRowCount,
    headerRow: target.headerRow
  };
}

function pick(row, column) {
  return normalize(row?.[column]);
}

function pickAny(row, columns = []) {
  for (const column of columns) {
    const value = pick(row, column);
    if (value) return value;
  }
  return '';
}

function normalizedDimensionHeader(value) {
  return normalize(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[(（]?(必填|选填|required)[)）]?/gi, '')
    .replace(/[\s_\-—:：/\\]+/g, '');
}

function pickDimensionAlias(row, aliases = []) {
  const direct = pickAny(row, aliases);
  if (direct) return direct;
  const normalizedAliases = aliases.map(normalizedDimensionHeader).filter(Boolean);
  const ranked = Object.entries(row || {}).map(([column, value]) => {
    const candidate = normalizedDimensionHeader(column);
    const score = normalizedAliases.reduce((best, alias) => {
      if (candidate === alias) return Math.max(best, 1000 + alias.length);
      if (alias.length >= 2 && (candidate.startsWith(alias) || candidate.endsWith(alias))) return Math.max(best, 500 + alias.length);
      if (alias.length >= 2 && candidate.includes(alias)) return Math.max(best, 200 + alias.length);
      return best;
    }, 0);
    return { value: normalize(value), score };
  }).filter((item) => item.value && item.score > 0).sort((left, right) => right.score - left.score);
  if (!ranked.length || (ranked[1] && ranked[0].score === ranked[1].score)) return '';
  return ranked[0].value;
}

function pickMapped(row, mapping, key, aliases = []) {
  return pick(row, mapping[key]) || pickAny(row, aliases);
}

function uniqueDelimitedValues(values) {
  return [...new Set(values.flatMap((value) => normalize(value).split(/[+、]/)).map(normalize).filter(Boolean))].join('、');
}

function appendUniqueDelimited(existing, next) {
  return uniqueDelimitedValues([existing, next]);
}

function rawDateSortValue(raw) {
  const source = raw || {};
  const direct = dateSortValue(pickAny(source, ['createDate', 'purchaseDate', 'orderDate', 'date', '采购日期', '创建日期', '下单日期', '订单日期', '日期']));
  if (direct !== Number.MAX_SAFE_INTEGER) return direct;
  const dateEntry = Object.entries(source).find(([key, value]) => {
    const field = normalize(key).toLowerCase();
    return value && (field.includes('日期') || field.includes('date'));
  });
  return dateSortValue(dateEntry?.[1]);
}

function compareOaRows(a, b) {
  return (numberValue(a.dateSort) || Number.MAX_SAFE_INTEGER) - (numberValue(b.dateSort) || Number.MAX_SAFE_INTEGER)
    || numberValue(a.sourceIndex) - numberValue(b.sourceIndex);
}

function orderedOaFlowNos(rows, valuePicker = (row) => row.oaFlowNo || row.oa_flow_no) {
  return uniqueDelimitedValues([...rows].sort(compareOaRows).map(valuePicker));
}

function mappedKingdeeRows(rows, mapping, options = {}) {
  const valid = [];
  const skipped = [];
  const summary = [];
  rows.forEach((row, index) => {
    const createDate = pickMapped(row, mapping, 'createDate', ['采购日期', '创建日期', '下单日期', '订单日期', '日期']);
    const month = monthFromDate(createDate);
    const rawBusinessUnit = pickMapped(row, mapping, 'businessUnit', ['事业部', '业务部门', '部门']);
    const businessUnit = rawBusinessUnit || UNASSIGNED_BUSINESS_UNIT;
    const supplier = pickMapped(row, mapping, 'supplier', ['供应商', '供应商名称', '供应商全称']);
    const materialCode = pickMapped(row, mapping, 'materialCode', ['物料编码', '物料代码', '商品编码', '存货编码', '产品编码', '品号', '编码']);
    const purchaseOrg = pickMapped(row, mapping, 'purchaseOrg', ['采购组织', '采购单位', '采购部门']);
    const creator = pickMapped(row, mapping, 'creator', ['创建人', '制单人', '采购员', '申请人', '下单人', '采购下单人', '创建者']);
    const operatorName = pickMapped(row, mapping, 'operatorName', ['运营', '运营人员', '运营负责人']);
    const oaFlowNo = pickMapped(row, mapping, 'oaFlowNo', ['OA备货流程号', 'OA流程号', '备货流程号', 'OA申请号', 'OA申请流程号', 'OA流程编号']);
    const quantity = numberValue(row?.[mapping.quantity] ?? pickAny(row, ['采购订单数量', '数量', '订单数量', '下单数量', '采购数量']));
    const inboundQty = numberValue(row?.[mapping.inboundQty] ?? pickAny(row, ['入库数量', '累计入库数量', '采购入库数量', '已入库数量', '已发货数量', '发货数量']));
    const remainingInboundQty = numberValue(row?.[mapping.remainingInboundQty] ?? pickAny(row, ['剩余入库数量', '剩余数量', '未交付数量']));
    const closeStatus = pickMapped(row, mapping, 'closeStatus', ['关闭状态']);
    const documentStatus = pickMapped(row, mapping, 'documentStatus', ['单据状态']);
    const materialName = pickMapped(row, mapping, 'materialName', ['物料名称', '商品名称', '产品名称']);
    const deliveryDate = pickMapped(row, mapping, 'deliveryDate', ['交货日期', '预计交货日期']);
    const isGift = pickMapped(row, mapping, 'isGift', ['是否赠品', '赠品']);
    const businessClose = pickMapped(row, mapping, 'businessClose', ['业务关闭']);
    const orderRemark = pickMapped(row, mapping, 'orderRemark', ['备注']);
    const manualClose = pickMapped(row, mapping, 'manualClose', ['手工关闭']);
    const orderNo = pickMapped(row, mapping, 'orderNo', ['单据编号', '采购订单号', '采购单号', '订单号', '采购订单编号']);
    const rowValues = Object.values(row).map(normalize).filter(Boolean);
    const isSummaryRow = (!month && !supplier && !materialCode)
      && rowValues.some((value) => value === '合计' || value === '总计');
    if (isSummaryRow) {
      summary.push({ row: index + 2, preview: JSON.stringify(row).slice(0, 200) });
      return;
    }
    const reasons = [];
    if (!month) reasons.push('日期无法解析');
    if (!supplier) reasons.push('供应商为空');
    if (!materialCode) reasons.push('物料编码为空');
    if (!quantity) reasons.push('数量为0或无法解析');
    if (reasons.length) {
      skipped.push({ row: index + 2, reasons: reasons.join(';'), preview: JSON.stringify(row).slice(0, 100) });
      return;
    }
    valid.push({
      month,
      createDate,
      businessUnit,
      supplier,
      materialCode,
      purchaseOrg,
      creator,
      operatorName,
      oaFlowNo,
      materialName,
      purchaseDate: createDate,
      deliveryDate,
      documentStatus,
      closeStatus,
      isGift,
      businessClose,
      orderRemark,
      manualClose,
      isTracking: closeStatus === TRACKING_CLOSE_STATUS,
      dateSort: dateSortValue(createDate),
      sourceIndex: index,
      orderNo,
      quantity,
      inboundQty,
      remainingInboundQty,
      raw: options.retainRaw === false ? {} : row,
      demandKey: demandKey(purchaseOrg, month, businessUnit, supplier, materialCode)
    });
  });
  return {
    totalRows: rows.length,
    validRows: valid.length,
    summaryRows: summary.length,
    summary,
    skippedRows: skipped.length,
    skipped,
    rows: valid
  };
}

function summarizeDemands(rows) {
  const map = new Map();
  [...rows].sort(compareOaRows).forEach((row) => {
    const current = map.get(row.demandKey) || {
      demandKey: row.demandKey,
      month: row.month,
      businessUnit: row.businessUnit,
      supplier: row.supplier,
      materialCode: row.materialCode,
      purchaseOrg: row.purchaseOrg || '',
      oaFlowNo: '',
      materialName: row.materialName || '',
      closeStatuses: '',
      currentOrderQty: 0,
      currentInboundQty: 0,
      trackingOrderQty: 0,
      trackingInboundQty: 0,
      trackingRemainingQty: 0,
      rows: 0,
      trackingRows: 0
    };
    current.currentOrderQty += row.quantity;
    current.currentInboundQty += numberValue(row.inboundQty);
    current.closeStatuses = appendUniqueDelimited(current.closeStatuses, row.closeStatus);
    current.materialName ||= row.materialName || '';
    if (row.isTracking) {
      current.trackingOrderQty += row.quantity;
      current.trackingInboundQty += numberValue(row.inboundQty);
      current.trackingRemainingQty += numberValue(row.remainingInboundQty);
      current.oaFlowNo = appendUniqueDelimited(current.oaFlowNo, row.oaFlowNo);
      current.trackingRows += 1;
    }
    current.rows += 1;
    map.set(row.demandKey, current);
  });
  return [...map.values()];
}

function kingdeeImportStats(result, summary) {
  return {
    totalRows: result.totalRows,
    validRows: result.validRows,
    summaryRows: result.summaryRows,
    skippedRows: result.skippedRows,
    mergedRows: summary.length,
    trackingRows: result.rows.filter((row) => row.isTracking).length,
    totalPurchaseQty: summary.reduce((sum, row) => sum + numberValue(row.currentOrderQty), 0),
    totalInboundQty: summary.reduce((sum, row) => sum + numberValue(row.currentInboundQty), 0),
    trackingPurchaseQty: summary.reduce((sum, row) => sum + numberValue(row.trackingOrderQty), 0),
    trackingInboundQty: summary.reduce((sum, row) => sum + numberValue(row.trackingInboundQty), 0),
    trackingRemainingQty: summary.reduce((sum, row) => sum + numberValue(row.trackingRemainingQty), 0)
  };
}

function diffAgainstCurrent(summary) {
  const current = all('SELECT demand_key, current_order_qty FROM order_demands WHERE active = 1');
  const currentMap = new Map(current.map((row) => [row.demand_key, row.current_order_qty]));
  const nextMap = new Map(summary.map((row) => [row.demandKey, row.currentOrderQty]));
  const diffs = [];
  summary.forEach((row) => {
    if (!currentMap.has(row.demandKey)) {
      diffs.push({ demandKey: row.demandKey, diffType: '新增', oldQty: 0, newQty: row.currentOrderQty });
      return;
    }
    const oldQty = numberValue(currentMap.get(row.demandKey));
    if (oldQty !== row.currentOrderQty) {
      diffs.push({ demandKey: row.demandKey, diffType: row.currentOrderQty > oldQty ? '数量增加' : '数量减少', oldQty, newQty: row.currentOrderQty });
    }
  });
  current.forEach((row) => {
    if (!nextMap.has(row.demand_key)) {
      diffs.push({ demandKey: row.demand_key, diffType: '消失', oldQty: row.current_order_qty, newQty: 0 });
    }
  });
  return diffs;
}

function computeSessionDiffs(sourceRows, summary) {
  const oldMap = new Map(sourceRows.map((row) => [row.demandKey, row.currentOrderQty]));
  const newMap = new Map(summary.map((row) => [row.demandKey, row.currentOrderQty]));
  const diffs = [];
  summary.forEach((row) => {
    if (!oldMap.has(row.demandKey)) {
      diffs.push({ demandKey: row.demandKey, diffType: '新增', oldQty: 0, newQty: row.currentOrderQty });
    } else {
      const oldQty = numberValue(oldMap.get(row.demandKey));
      if (oldQty !== row.currentOrderQty) {
        diffs.push({ demandKey: row.demandKey, diffType: row.currentOrderQty > oldQty ? '数量增加' : '数量减少', oldQty, newQty: row.currentOrderQty });
      }
    }
  });
  sourceRows.forEach((row) => {
    if (!newMap.has(row.demandKey)) {
      diffs.push({ demandKey: row.demandKey, diffType: '消失', oldQty: row.currentOrderQty, newQty: 0 });
    }
  });
  return diffs;
}

function sessionBaselineRows(sessionId, summary) {
  const oldTotals = new Map(summary.map((row) => [row.demandKey, numberValue(row.currentOrderQty)]));
  all(
    'SELECT demand_key, old_qty, new_qty FROM difference_compare_rows WHERE session_id = ?',
    [sessionId]
  ).forEach((row) => {
    const oldTotal = numberValue(oldTotals.get(row.demand_key));
    oldTotals.set(row.demand_key, oldTotal + numberValue(row.old_qty) - numberValue(row.new_qty));
  });
  return [...oldTotals].map(([demandKey, currentOrderQty]) => ({ demandKey, currentOrderQty }));
}

function savedMapping(kind) {
  const row = get('SELECT * FROM import_mappings WHERE kind = ?', [kind]);
  return parseJson(row?.mapping_json, {});
}

function getDimensionRows(slotId) {
  const record = get('SELECT rows_json, applied FROM dimension_files WHERE slot_id = ?', [slotId]);
  if (!record?.applied) return [];
  return parseJson(record.rows_json, []);
}

function orderDataCounts() {
  return {
    demands: numberValue(get('SELECT COUNT(*) AS count FROM order_demands')?.count),
    activeDemands: numberValue(get('SELECT COUNT(*) AS count FROM order_demands WHERE active = 1')?.count),
    kingdeeOrders: numberValue(get('SELECT COUNT(*) AS count FROM kingdee_orders')?.count),
    importBatches: numberValue(get('SELECT COUNT(*) AS count FROM kingdee_import_batches')?.count),
    orderEvents: numberValue(get('SELECT COUNT(*) AS count FROM kingdee_order_events')?.count)
  };
}

function assertOrderDataUnchanged(before, message = '维度表操作不能修改采购订单数据') {
  const after = orderDataCounts();
  const changed = Object.keys(before).some((key) => before[key] !== after[key]);
  if (changed) {
    throw new Error(`${message}，已回滚`);
  }
}

function rowAliasValue(row, aliases = []) {
  const sources = [row];
  if (row && typeof row === 'object') {
    [row.raw, row.rawRow, row._raw].forEach((source) => {
      if (source && source !== row && typeof source === 'object') sources.push(source);
    });
  }
  const compactAliases = new Set(aliases.map(compactHeader));
  for (const source of sources) {
    for (const alias of aliases) {
      const value = normalize(source?.[alias]);
      if (value) return value;
    }
  }
  for (const source of sources) {
    for (const [key, value] of Object.entries(source || {})) {
      if (compactAliases.has(compactHeader(key))) {
        const normalized = normalize(value);
        if (normalized) return normalized;
      }
    }
  }
  return '';
}

function rawDimensionColumnValue(row, zeroBasedColumnIndex) {
  const raw = row && typeof row === 'object' ? row.raw : null;
  if (!raw || typeof raw !== 'object') return '';
  return normalize(Object.values(raw)[zeroBasedColumnIndex]);
}

function warehouseLevel2CategoryValue(row) {
  // “仓库名称”底表的二级仓库分类固定在 H 列；优先读取原始 H 列，
  // 以兼容修正历史文件中曾经保存错误映射的记录。
  return rawDimensionColumnValue(row, 7)
    || rowAliasValue(row, ['level2WarehouseCategory', '二级仓库分类']);
}

function productDimensionMaterialName(product, materialCode = '') {
  const materialKey = normalizeMatchPart(materialCode || rowAliasValue(product, ['materialCode', '物料编码', '品号']));
  const sourceName = rowAliasValue(product, ['金蝶名称', '物料名称', '商品名称', '产品名称', '中文名称', 'SKU名称']);
  return [sourceName, normalize(product?.materialName)]
    .find((value) => value && normalizeMatchPart(value) !== materialKey) || '';
}

function assignmentMaterialCode(row) {
  return rowAliasValue(row, ['materialCode', '物料编码', '商品编码', '存货编码', '产品编码']);
}

function splitSupplierNames(value) {
  return normalize(value).split(/[&+、,，;；]/).map(normalize).filter(Boolean);
}

function assignmentSupplierCandidates(row) {
  return [
    rowAliasValue(row, ['productLineDetailSupplier', '产品线明细供应商', '产品线明细-供应商', '产品明细供应商', '产品明细-供应商', '产品线明细供应商名称', '产品线明细-供应商名称']),
    rowAliasValue(row, ['供应商全称', '供应商名称']),
    rowAliasValue(row, ['供应商']),
    rowAliasValue(row, ['supplier']),
    rowAliasValue(row, ['supplierShortName', '供应商简称'])
  ].flatMap(splitSupplierNames);
}

function assignmentSupplierDisplayNames(row) {
  const detailNames = splitSupplierNames(
    rowAliasValue(row, ['productLineDetailSupplier', '产品线明细供应商', '产品线明细-供应商', '产品明细供应商', '产品明细-供应商'])
  );
  const shortNames = assignmentSupplierShortNames(row);
  if (detailNames.length > 1) return detailNames;
  return shortNames.length ? shortNames : detailNames;
}

function assignmentSupplierShortNames(row) {
  return splitSupplierNames(rowAliasValue(row, ['supplierShortName', '供应商简称']));
}

function supplierNamesLikelySame(left, right) {
  const leftKey = normalizeMatchPart(left);
  const rightKey = normalizeMatchPart(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  const shorter = leftKey.length <= rightKey.length ? leftKey : rightKey;
  const longer = leftKey.length > rightKey.length ? leftKey : rightKey;
  return shorter.length >= 2 && longer.includes(shorter);
}

function selectUniqueAssignment(rows = []) {
  if (!rows.length) return {};
  const owners = [...new Set(rows.map((row) => singlePurchaseOwner(assignmentOwner(row))).filter(Boolean))];
  if (owners.length > 1) return {};
  return rows.find((row) => assignmentOwner(row)) || rows[0] || {};
}

function assignmentRowsForMaterial(lookups, materialCode) {
  return lookups.assignmentRowsByMaterial.get(normalizeMatchPart(materialCode)) || [];
}

function assignmentSupplierShortName(lookups, materialCode, fallbackRows = []) {
  const materialKey = normalizeMatchPart(materialCode);
  const aggregatedNames = lookups.supplierShortNamesByMaterial?.get(materialKey) || [];
  if (aggregatedNames.length) return aggregatedNames.join('&');
  const materialRows = assignmentRowsForMaterial(lookups, materialCode);
  const rows = materialRows.length ? materialRows : fallbackRows;
  return [...new Set(
    rows
      .flatMap(assignmentSupplierDisplayNames)
  )].join('&');
}

function buildAssignmentLookups(assignmentRows = []) {
  const assignmentRowsByKey = new Map();
  const assignmentRowsByMaterial = new Map();
  const assignmentSupplierShortNamesByMaterial = new Map();
  const supplierMap = new Map();
  assignmentRows.forEach((row) => {
    const materialCode = assignmentMaterialCode(row);
    const materialKey = normalizeMatchPart(materialCode);
    const supplierCandidates = assignmentSupplierCandidates(row);
    if (materialKey) {
      const materialRows = assignmentRowsByMaterial.get(materialKey) || [];
      materialRows.push(row);
      assignmentRowsByMaterial.set(materialKey, materialRows);
      const shortNames = assignmentSupplierShortNamesByMaterial.get(materialKey) || [];
      assignmentSupplierShortNames(row).forEach((name) => {
        if (!shortNames.includes(name)) shortNames.push(name);
      });
      assignmentSupplierShortNamesByMaterial.set(materialKey, shortNames);
    }
    supplierCandidates.forEach((candidate) => {
      const supplierKey = normalizeMatchPart(candidate);
      if (supplierKey && rowAliasValue(row, ['supplierShortName', '供应商简称']) && !supplierMap.has(supplierKey)) supplierMap.set(supplierKey, row);
      if (!candidate || !materialCode) return;
      const key = assignmentKey(candidate, materialCode);
      const keyRows = assignmentRowsByKey.get(key) || [];
      keyRows.push(row);
      assignmentRowsByKey.set(key, keyRows);
    });
  });
  return { assignmentRowsByKey, assignmentRowsByMaterial, assignmentSupplierShortNamesByMaterial, supplierMap };
}

function supplierAssignmentRowsForOrder(lookups, supplier, materialCode) {
  const exactRows = lookups.assignmentRowsByKey.get(assignmentKey(supplier, materialCode)) || [];
  if (exactRows.length) return exactRows;
  return assignmentRowsForMaterial(lookups, materialCode)
    .filter((row) => assignmentSupplierCandidates(row).some((candidate) => supplierNamesLikelySame(supplier, candidate)));
}

function orderSupplierShortName(lookups, supplier, materialCode) {
  const names = [];
  supplierAssignmentRowsForOrder(lookups, supplier, materialCode).forEach((row) => {
    assignmentSupplierShortNames(row).forEach((name) => {
      if (!names.includes(name)) names.push(name);
    });
  });
  return names.join('&') || UNMATCHED_SUPPLIER_SHORT_NAME;
}

function assignmentSupplierCount(lookups, materialCode) {
  return (lookups.assignmentSupplierShortNamesByMaterial.get(normalizeMatchPart(materialCode)) || []).length;
}

function resolveSupplierAssignment(lookups, supplier, materialCode) {
  const exactRows = lookups.assignmentRowsByKey.get(assignmentKey(supplier, materialCode)) || [];
  const exactAssignment = selectUniqueAssignment(exactRows);
  if (assignmentOwner(exactAssignment)) return exactAssignment;

  const materialRows = assignmentRowsForMaterial(lookups, materialCode);
  const fuzzyRows = materialRows.filter((row) => assignmentSupplierCandidates(row).some((candidate) => supplierNamesLikelySame(supplier, candidate)));
  const fuzzyAssignment = selectUniqueAssignment(fuzzyRows);
  if (assignmentOwner(fuzzyAssignment)) return fuzzyAssignment;

  return {};
}

function purchaseOwnersForSupplierShortNames(lookups, supplierShortNames, materialCode) {
  const owners = supplierShortNames.flatMap((supplierShortName) => (
    lookups.assignmentRowsByKey.get(assignmentKey(supplierShortName, materialCode)) || []
  )).map(assignmentOwner).flatMap(splitDelimited).filter(Boolean);
  return [...new Set(owners)].join('+') || UNASSIGNED_PURCHASE_OWNER;
}

function resolveAssignment(lookups, supplier, materialCode) {
  const supplierAssignment = resolveSupplierAssignment(lookups, supplier, materialCode);
  if (assignmentOwner(supplierAssignment)) return supplierAssignment;
  const materialRows = assignmentRowsForMaterial(lookups, materialCode);
  return selectUniqueAssignment(materialRows);
}

function dimensionLookups() {
  const productRows = getDimensionRows('productCategory');
  const assignmentRows = getDimensionRows('purchaseAssignment');
  const assignmentLookups = buildAssignmentLookups(assignmentRows);
  const productMap = new Map();
  const supplierShortNamesByMaterial = new Map();
  const addSupplierNames = (materialCode, names) => {
    const materialKey = normalizeMatchPart(materialCode);
    if (!materialKey) return;
    const values = supplierShortNamesByMaterial.get(materialKey) || [];
    splitSupplierNames(names).forEach((name) => {
      if (!values.includes(name)) values.push(name);
    });
    supplierShortNamesByMaterial.set(materialKey, values);
  };
  productRows.forEach((row) => {
    const materialCode = normalize(row.materialCode);
    if (materialCode && !productMap.has(materialCode)) productMap.set(materialCode, row);
  });
  assignmentRows.forEach((row) => {
    assignmentSupplierDisplayNames(row).forEach((name) => addSupplierNames(assignmentMaterialCode(row), name));
  });
  all('SELECT material_code, supplier_short_name FROM order_demands WHERE active = 1').forEach((row) => {
    addSupplierNames(row.material_code, row.supplier_short_name);
  });
  return { productMap, ...assignmentLookups, supplierShortNamesByMaterial };
}

const FIRST_MILE_SLOT_IDS = [
  'firstMileData1',
  'firstMileData2',
  'firstMileData3',
  'firstMileData4',
  'firstMileData5',
  'firstMileSpare'
];

function firstMileProductLookups() {
  const byMaterial = new Map();
  const bySku = new Map();
  getDimensionRows('productCategory').forEach((row) => {
    const materialCode = rowAliasValue(row, ['materialCode', '物料编码', '商品编码', '品号']);
    const sku = rowAliasValue(row, ['sku', 'SKU', '系统SKU', '库存SKU']);
    if (materialCode && !byMaterial.has(normalizeMatchPart(materialCode))) byMaterial.set(normalizeMatchPart(materialCode), row);
    if (sku && !bySku.has(normalizeMatchPart(sku))) bySku.set(normalizeMatchPart(sku), row);
  });
  return { byMaterial, bySku };
}

function firstMileBoardModel() {
  const records = all(
    `SELECT slot_id, title, file_name, mapping_json, rows_json, updated_at
     FROM dimension_files
     WHERE applied = 1 AND slot_id IN (${FIRST_MILE_SLOT_IDS.map(() => '?').join(', ')})`,
    FIRST_MILE_SLOT_IDS
  );
  const sourceApplications = records.map((record) => {
    const mapping = parseJson(record.mapping_json, {});
    return {
      slotId: record.slot_id,
      label: DIMENSION_SLOTS[record.slot_id] || record.title,
      fileName: record.file_name,
      appliedAt: record.updated_at,
      parseSummary: mapping.__firstMileSummary
        ? { ...mapping.__firstMileSummary, owner: firstMileOwner(record.slot_id) }
        : null,
      requiresReupload: numberValue(mapping.__firstMileSummary?.parserVersion) < FIRST_MILE_PARSER_VERSION
    };
  });
  const sourceRows = records.flatMap((record) => parseJson(record.rows_json, [])
    .filter((row) => row?.businessType && row?.sourceFile)
    .map((row) => ({ ...row, sourceOwner: firstMileOwner(record.slot_id), sourceAppliedAt: record.updated_at })));
  const { byMaterial, bySku } = firstMileProductLookups();
  const rows = dedupeFirstMileRows(sourceRows).map((row) => {
    const product = byMaterial.get(normalizeMatchPart(row.materialCode))
      || bySku.get(normalizeMatchPart(row.sourceSku))
      || {};
    const materialCode = normalize(row.materialCode)
      || rowAliasValue(product, ['materialCode', '物料编码', '商品编码', '品号']);
    const sku = rowAliasValue(product, ['sku', 'SKU', '系统SKU']) || normalize(row.sourceSku) || '未映射';
    const productLine = rowAliasValue(product, ['productLine', '销售产品线', '产品线']) || '未映射';
    const productSeries = rowAliasValue(product, ['productSeries', '销售系列', '系列']) || '未映射';
    const model = rowAliasValue(product, ['model', '型号']) || '未映射';
    const materialName = normalize(row.materialName)
      || rowAliasValue(product, ['materialName', '物料名称', '金蝶名称', '中文名称'])
      || '未映射';
    return {
      ...row,
      materialCode: materialCode || '未映射',
      sku,
      materialName,
      productLine,
      productSeries,
      model,
      sourceFileText: (row.sourceFiles || [row.sourceFile]).join(' + '),
      sourceSheetText: (row.sourceSheets || [row.sourceSheet]).join(' + '),
      mappingStatus: productLine === '未映射' || productSeries === '未映射' ? '商品未映射' : '完整'
    };
  }).sort((left, right) => (
    dateSortValue(right.actualSailingAt || right.expectedSailingAt || right.factoryShippedAt)
    - dateSortValue(left.actualSailingAt || left.expectedSailingAt || left.factoryShippedAt)
    || normalize(left.oaApprovalNo).localeCompare(normalize(right.oaApprovalNo), 'zh-Hans-CN')
  ));
  const issueRows = sourceApplications.reduce((sum, record) => sum + numberValue(record.parseSummary?.issueRows), 0);
  return {
    rows,
    sourceApplications,
    qualitySummary: {
      sourceRows: sourceRows.length,
      mergedRows: rows.length,
      duplicateRows: Math.max(0, sourceRows.length - rows.length),
      issueRows,
      unmappedRows: rows.filter((row) => row.mappingStatus !== '完整').length,
      reuploadSources: sourceApplications.filter((source) => source.requiresReupload).length
    }
  };
}

function migrateAppliedFirstMileSources() {
  const records = all(
    `SELECT slot_id, file_name, mapping_json, source_file, source_file_size
     FROM dimension_files
     WHERE applied = 1 AND slot_id IN (${FIRST_MILE_SLOT_IDS.map(() => '?').join(', ')})`,
    FIRST_MILE_SLOT_IDS
  );
  const updates = [];
  let unavailable = 0;
  records.forEach((record) => {
    const mapping = parseJson(record.mapping_json, {});
    if (numberValue(mapping.__firstMileSummary?.parserVersion) >= FIRST_MILE_PARSER_VERSION) return;
    if (!record.source_file || numberValue(record.source_file_size) <= 0) {
      unavailable += 1;
      return;
    }
    try {
      const reparsed = reparseFirstMileSource({
        slotId: record.slot_id,
        fileName: record.file_name,
        sourceFile: record.source_file,
        mapping
      });
      if (reparsed) updates.push({ slotId: record.slot_id, ...reparsed });
    } catch (error) {
      console.error(`[First mile migration] ${record.slot_id} reparse failed:`, error.message);
    }
  });
  if (updates.length) {
    transaction(() => {
      updates.forEach((update) => {
        run(
          `UPDATE dimension_files
           SET sheet_name = '', sheet_names = ?, selected_sheet_names = ?, mapping_json = ?, rows_json = ?
           WHERE slot_id = ? AND applied = 1`,
          [
            JSON.stringify(update.sheetNames),
            JSON.stringify(update.selectedSheetNames),
            JSON.stringify(update.mapping),
            JSON.stringify(update.rows),
            update.slotId
          ]
        );
      });
    });
  }
  return { checked: records.length, reparsed: updates.length, unavailable };
}

function firstMileExpectedSailingMonth(value) {
  const match = normalize(value).match(/^(\d{4})[-/](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}` : '未填写';
}

function filterFirstMileRows(rows, filters = {}) {
  const keyword = normalize(filters.keyword).toLowerCase();
  return rows.filter((row) => (
    (!filters.cargoStatus || row.cargoStatus === filters.cargoStatus)
    && (!filters.businessUnit || row.businessUnit === filters.businessUnit)
    && (!filters.storeName || row.storeName === filters.storeName)
    && (!filters.operatorName || row.operatorName === filters.operatorName)
    && (!filters.productLine || row.productLine === filters.productLine)
    && (!filters.productSeries || row.productSeries === filters.productSeries)
    && (!filters.transportMode || row.transportMode === filters.transportMode)
    && (!filters.expectedSailingMonth || firstMileExpectedSailingMonth(row.expectedSailingAt) === filters.expectedSailingMonth)
    && (!keyword || [
      row.oaApprovalNo, row.materialCode, row.sku, row.materialName, row.shipmentNo,
      row.destinationWarehouse, row.inboundWarehouseType, row.sourceOwner, row.sourceFileText, row.sourceSheetText
    ].join(' ').toLowerCase().includes(keyword))
  ));
}

function splitDelimited(value) {
  return [...new Set(normalize(value).split(/[+、]/).map(normalize).filter(Boolean))];
}

function singlePurchaseOwner(value) {
  return splitDelimited(value).find((item) => item && item !== UNASSIGNED_PURCHASE_OWNER) || '';
}

function assignmentGroup(row) {
  return rowAliasValue(row, ['productLineDetailPurchaseGroup', '产品线明细-采购组', '产品线明细采购组', '产品线明细-采购分组', '产品线明细采购分组', 'purchaseGroup', '采购组', '采购分组']);
}

function assignmentOwner(row) {
  return rowAliasValue(row, ['productLineDetailPurchaseOwner', '产品线明细-采购下单人', '产品线明细采购下单人', '产品线明细-下单人', '产品线明细下单人', 'purchaseOwner', '采购下单人', '下单人', '采购负责人']);
}

function realPurchaseOwner(...values) {
  return values.map(singlePurchaseOwner).find(Boolean) || '';
}

function dimensionDiagnostics(slotId, rows = []) {
  if (slotId === 'purchaseAssignment') {
    const demands = all('SELECT supplier, material_code FROM order_demands WHERE active = 1');
    const lookups = buildAssignmentLookups(rows);
    let ownerRows = 0;
    let keyRows = 0;
    rows.forEach((row) => {
      const owner = assignmentOwner(row);
      const materialCode = assignmentMaterialCode(row);
      const suppliers = assignmentSupplierCandidates(row);
      if (owner) ownerRows++;
      if (materialCode && suppliers.length) keyRows++;
    });
    const matchedRows = demands.filter((demand) => assignmentOwner(resolveAssignment(lookups, demand.supplier, demand.material_code))).length;
    return { totalRows: rows.length, ownerRows, keyRows, matchedRows };
  }
  if (slotId === 'productCategory') {
    const demandMaterials = new Set(all('SELECT material_code FROM order_demands WHERE active = 1').map((row) => normalizeMatchPart(row.material_code)));
    const materialSet = new Set(rows.map((row) => normalizeMatchPart(row.materialCode)).filter(Boolean));
    const matchedRows = [...demandMaterials].filter((key) => materialSet.has(key)).length;
    return { totalRows: rows.length, keyRows: materialSet.size, matchedRows };
  }
  if (slotId === 'spare2' || slotId === 'wangdianDataMain') {
    const merchantCodes = new Set(rows.map((row) => normalize(domesticMerchantCode(row))).filter(Boolean));
    return { totalRows: rows.length, keyRows: merchantCodes.size };
  }
  if (slotId === 'wangdianSpare1') {
    const jdIds = new Set(rows.map((row) => normalize(jdIdValue(row))).filter(Boolean));
    return { totalRows: rows.length, keyRows: jdIds.size };
  }
  if (slotId === 'wangdianSpare2') {
    const jdIds = new Set(rows.map((row) => normalize(jdIdValue(row))).filter(Boolean));
    const materialCodes = new Set(rows.map((row) => normalize(jdMappedMaterialCode(row))).filter(Boolean));
    return { totalRows: rows.length, keyRows: jdIds.size, materialRows: materialCodes.size };
  }
  return { totalRows: rows.length };
}

function domesticMerchantCode(row) {
  return rowAliasValue(row, ['merchantCode', '商家编码', '商家编码 ', '商品编码']);
}

function jdIdValue(row) {
  return rowAliasValue(row, ['jdId', 'SKU', 'sku', '京东SKU', '京东sku', '京东商品SKU', '商品SKU', '系统SKU', '京东编码', '京东商品编码', '京东货号', 'ID', 'id', '京东ID', '京东id']);
}

function jdMappedMaterialCode(row) {
  return rowAliasValue(row, ['materialCode', '品号', '物料编码', '商品编码', '货品编号', '存货编码']);
}

function jdStockQtyValue(row) {
  return rowAliasValue(row, ['jdStockQty', '全国现货库存', '京东库存', '库存数量', '库存', '可用库存', '现货库存']);
}

function jdSelf7dOutQtyValue(row) {
  return rowAliasValue(row, ['self7dOutQty', '全国近7日出库商品件数', '近7日出库商品件数', '全国近7天出库商品件数', '自营近7天出库']);
}

function jdSelf30dOutQtyValue(row) {
  return rowAliasValue(row, ['self30dOutQty', '全国近30日出库商品件数', '近30日出库商品件数', '全国近30天出库商品件数', '自营近30天出库']);
}

function productCategoryModel(row) {
  return rowAliasValue(row, ['model', '型号', '产品型号', '款式', '规格型号', '规格']);
}

function domesticProductLookups(rows) {
  const byMaterial = new Map();
  const nameBuckets = new Map();
  let inheritedBrand = '';
  let inheritedProductType = '';

  rows.forEach((row) => {
    const directBrand = rowAliasValue(row, ['brand', '品牌', '品牌名称', '商品品牌']);
    const directProductType = rowAliasValue(row, [
      'productType', '产品类型', '销售产品分类', '商品类型', '产品类别', '商品类别', '品类', '一级品类'
    ]);
    if (directBrand) inheritedBrand = directBrand;
    if (directProductType) inheritedProductType = directProductType;
    const product = {
      ...row,
      domesticBrand: directBrand || inheritedBrand,
      domesticProductType: directProductType || inheritedProductType
    };
    const materialCode = normalizeMatchPart(rowAliasValue(row, ['materialCode', '物料编码', '品号', '商品编码', '存货编码']));
    if (materialCode && !byMaterial.has(materialCode)) byMaterial.set(materialCode, product);
    const materialName = normalizeMatchPart(rowAliasValue(row, ['materialName', '物料名称', '金蝶名称', '商品名称', '货品名称']));
    if (materialCode && materialName) {
      if (!nameBuckets.has(materialName)) nameBuckets.set(materialName, new Map());
      nameBuckets.get(materialName).set(materialCode, product);
    }
  });

  const byUniqueName = new Map();
  nameBuckets.forEach((products, materialName) => {
    if (products.size === 1) byUniqueName.set(materialName, products.values().next().value);
  });
  return { byMaterial, byUniqueName };
}

function roundQty(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(numberValue(value) * factor) / factor;
}

function dateOnly(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDaysText(days) {
  const numericDays = numberValue(days);
  if (!Number.isFinite(numericDays) || numericDays <= 0) return '';
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + Math.max(Math.ceil(numericDays) - 1, 0));
  return dateOnly(d);
}

function riskLabel(days, wdtStockQty) {
  const stock = numberValue(wdtStockQty);
  const value = numberValue(days);
  if (!value) return '';
  if (value < 15) return '🔴断货风险';
  if (value < 30) return '🟡备货紧张';
  if (value <= 90) return '🟢安全健康';
  if (value <= 150) return '🟡关注/较慢';
  return stock >= 50 ? '🔴严重积压' : '🟡正常库存周转偏慢';
}

function domesticManualPayload(body = {}) {
  const selfDailySalesRaw = normalize(body.selfDailySales ?? body.self_daily_sales ?? '');
  const explicitManual = body.selfDailySalesManual ?? body.self_daily_sales_manual;
  return {
    jdStockQty: numberValue(body.jdStockQty ?? body.jd_stock_qty),
    self7dOutQty: numberValue(body.self7dOutQty ?? body.self_7d_out_qty),
    self30dOutQty: numberValue(body.self30dOutQty ?? body.self_30d_out_qty),
    selfDailySales: numberValue(selfDailySalesRaw),
    selfDailySalesManual: explicitManual === undefined ? (selfDailySalesRaw ? 1 : 0) : (explicitManual ? 1 : 0),
    selfFuture14dInboundQty: numberValue(body.selfFuture14dInboundQty ?? body.self_future_14d_inbound_qty),
    nextSupplyDate: normalize(body.nextSupplyDate ?? body.next_supply_date),
    nextSupplyQty: numberValue(body.nextSupplyQty ?? body.next_supply_qty),
    remark: normalize(body.remark)
  };
}

function saveDomesticManualInput(merchantCode, payload, userName) {
  const now = nowText();
  run(
    `INSERT INTO domestic_board_inputs
      (merchant_code, jd_stock_qty, self_7d_out_qty, self_30d_out_qty, self_daily_sales, self_daily_sales_manual, self_future_14d_inbound_qty, next_supply_date, next_supply_qty, remark, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(merchant_code) DO UPDATE SET
       jd_stock_qty = excluded.jd_stock_qty,
       self_7d_out_qty = excluded.self_7d_out_qty,
       self_30d_out_qty = excluded.self_30d_out_qty,
       self_daily_sales = excluded.self_daily_sales,
       self_daily_sales_manual = excluded.self_daily_sales_manual,
       self_future_14d_inbound_qty = excluded.self_future_14d_inbound_qty,
       next_supply_date = excluded.next_supply_date,
       next_supply_qty = excluded.next_supply_qty,
       remark = excluded.remark,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
    [
      merchantCode,
      payload.jdStockQty,
      payload.self7dOutQty,
      payload.self30dOutQty,
      payload.selfDailySales,
      payload.selfDailySalesManual,
      payload.selfFuture14dInboundQty,
      payload.nextSupplyDate,
      payload.nextSupplyQty,
      payload.remark,
      userName,
      now
    ]
  );
  return now;
}

function domesticRowHasActivity(row) {
  const quantityFields = [
    'wdtStockQty',
    'nonSelf7dOutQty',
    'nonSelf30dOutQty',
    'jdStockQty',
    'self7dOutQty',
    'self30dOutQty',
    'selfFuture14dInboundQty',
    'domesticUndeliveredQty',
    'nextSupplyQty'
  ];
  return quantityFields.some((field) => numberValue(row[field]) !== 0)
    || Boolean(normalize(row.nextSupplyDate) || normalize(row.remark));
}

function domesticBoardRows(demands = null) {
  const defaultRows = getDimensionRows('spare2');
  const wangdianRows = getDimensionRows('wangdianDataMain');
  const productLookups = domesticProductLookups(getDimensionRows('productCategory'));
  const baseRowMap = new Map();
  [...defaultRows, ...wangdianRows].forEach((row) => {
    const merchantCode = normalize(domesticMerchantCode(row));
    if (merchantCode && !baseRowMap.has(merchantCode)) baseRowMap.set(merchantCode, row);
  });
  const baseRows = [...baseRowMap.values()];
  const jdInventoryRows = getDimensionRows('wangdianSpare1');
  const jdMatchRows = getDimensionRows('wangdianSpare2');
  const jdMaterialMap = new Map();
  jdMatchRows.forEach((row) => {
    const jdId = normalize(jdIdValue(row));
    const materialCode = normalize(jdMappedMaterialCode(row));
    if (jdId && materialCode && !jdMaterialMap.has(jdId)) jdMaterialMap.set(jdId, materialCode);
  });
  const resolveDomesticMaterialCode = (row) => {
    const directMaterialCode = normalize(jdMappedMaterialCode(row));
    if (directMaterialCode) return directMaterialCode;
    const jdKey = normalize(jdIdValue(row));
    const merchantCode = normalize(domesticMerchantCode(row));
    const merchantMatch = productLookups.byMaterial.get(normalizeMatchPart(merchantCode));
    const materialName = normalizeMatchPart(rowAliasValue(row, ['materialName', '物料名称', '金蝶名称', '商品名称', '货品名称']));
    const nameMatch = productLookups.byUniqueName.get(materialName);
    return normalize(
      jdMaterialMap.get(jdKey)
      || jdMaterialMap.get(merchantCode)
      || rowAliasValue(merchantMatch || nameMatch, ['materialCode', '物料编码', '品号', '商品编码', '存货编码'])
      || merchantCode
      || jdKey
    );
  };
  const wangdianMap = new Map();
  wangdianRows.forEach((row) => {
    const merchantCode = normalize(domesticMerchantCode(row));
    if (merchantCode && !wangdianMap.has(merchantCode)) wangdianMap.set(merchantCode, row);
  });
  const jdInventoryMap = new Map();
  jdInventoryRows.forEach((row) => {
    const jdId = normalize(jdIdValue(row));
    const materialCode = resolveDomesticMaterialCode(row);
    if (jdId && !jdInventoryMap.has(jdId)) jdInventoryMap.set(jdId, row);
    if (materialCode && !jdInventoryMap.has(materialCode)) jdInventoryMap.set(materialCode, row);
  });
  const manualMap = new Map(all('SELECT * FROM domestic_board_inputs').map((row) => [normalize(row.merchant_code), row]));
  const domesticUndeliveredMap = new Map();
  const domesticMetaMap = new Map();
  (demands || demandRows(false)).forEach((demand) => {
    const businessUnit = normalize(demand.businessUnit);
    if (!businessUnit.includes('国内事业部') && !businessUnit.includes('国内业务部')) return;
    if (numberValue(demand.remainingInboundQty) <= 0) return;
    const materialCode = normalize(demand.materialCode);
    if (!materialCode) return;
    domesticUndeliveredMap.set(materialCode, numberValue(domesticUndeliveredMap.get(materialCode)) + numberValue(demand.remainingInboundQty));
    const existing = domesticMetaMap.get(materialCode) || {};
    domesticMetaMap.set(materialCode, {
      productLine: uniqueDelimitedValues([existing.productLine, demand.productLine]),
      productSeries: uniqueDelimitedValues([existing.productSeries, demand.productSeries]),
      purchaseOwner: uniqueDelimitedValues([existing.purchaseOwner, demand.purchaseOwner])
    });
  });
  return baseRows.map((row) => {
    const merchantCode = normalize(domesticMerchantCode(row));
    const materialCode = resolveDomesticMaterialCode(row);
    const wdt = wangdianMap.get(merchantCode) || {};
    const jdInventory = jdInventoryMap.get(merchantCode) || jdInventoryMap.get(materialCode) || {};
    const manual = manualMap.get(merchantCode) || {};
    const domesticMeta = domesticMetaMap.get(materialCode) || {};
    const product = productLookups.byMaterial.get(normalizeMatchPart(materialCode)) || {};
    const wdtStockQty = numberValue(rowAliasValue(wdt, ['wdtStockQty', '旺店通在库量', '在库量', '库存量', '库存', '可发库存', '可用库存', '现货库存']));
    const nonSelf7dOutQty = numberValue(rowAliasValue(wdt, ['nonSelf7dOutQty', '非自营近7天出库', '非自营7天出库', '非自营近7日出库', '近7天出库', '近7日出库']));
    const nonSelf30dOutQty = numberValue(rowAliasValue(wdt, ['nonSelf30dOutQty', '非自营近30天出库', '非自营30天出库', '非自营近30日出库', '近30天出库', '近30日出库']));
    const nonSelfDailySales = roundQty((nonSelf7dOutQty + nonSelf30dOutQty) / 37);
    const nonSelfFuture14dDemandQty = roundQty(nonSelfDailySales * 14);
    const jdStockQty = numberValue(jdStockQtyValue(jdInventory));
    const self7dOutQty = numberValue(jdSelf7dOutQtyValue(jdInventory));
    const self30dOutQty = numberValue(jdSelf30dOutQtyValue(jdInventory));
    const calculatedSelfDailySales = roundQty((self7dOutQty + self30dOutQty) / 37);
    const selfDailySales = calculatedSelfDailySales;
    const selfFuture14dInboundQty = numberValue(manual.self_future_14d_inbound_qty);
    const allChannelFuture14dMinDemandQty = roundQty(selfFuture14dInboundQty + nonSelfFuture14dDemandQty);
    const sellableDays = (nonSelfDailySales + selfDailySales) > 0 ? roundQty(wdtStockQty / (nonSelfDailySales + selfDailySales)) : 0;
    return {
      stockupStatus: normalize(
        rowAliasValue(row, ['stockupStatus', '是否正常备货', '备货状态'])
        || rowAliasValue(wdt, ['stockupStatus', '是否正常备货', '备货状态'])
        || rowAliasValue(product, ['stockupStatus', '是否正常备货', '备货状态'])
      ),
      brand: normalize(
        rowAliasValue(row, ['brand', '品牌', '品牌名称', '商品品牌'])
        || rowAliasValue(wdt, ['brand', '品牌', '品牌名称', '商品品牌'])
        || product.domesticBrand
        || rowAliasValue(jdInventory, ['brand', '品牌', '品牌名称', '商品品牌'])
      ),
      productType: normalize(
        rowAliasValue(row, ['productType', '产品类型', '销售产品分类', '商品类型', '产品类别', '商品类别', '品类'])
        || rowAliasValue(wdt, ['productType', '产品类型', '销售产品分类', '商品类型', '产品类别', '商品类别', '品类'])
        || product.domesticProductType
        || rowAliasValue(jdInventory, ['productType', '产品类型', '商品类型', '一级类目', '二级类目', '三级类目'])
      ),
      businessUnit: '国内事业部',
      materialCode,
      merchantCode,
      systemSku: normalize(
        rowAliasValue(row, ['systemSku', '系统SKU-必填', '系统SKU', 'SKU', 'sku', '商品SKU'])
        || rowAliasValue(wdt, ['systemSku', '系统SKU-必填', '系统SKU', 'SKU', 'sku', '商品SKU'])
        || rowAliasValue(product, ['sku', 'SKU', 'systemSku', '系统SKU', '商品SKU'])
        || rowAliasValue(jdInventory, ['SKU', 'sku', '商品SKU', '系统SKU'])
      ),
      salesProductLine: normalize(
        domesticMeta.productLine
        || rowAliasValue(product, ['productLine', '销售产品线', '产品线'])
        || rowAliasValue(row, ['销售产品线', '产品线'])
      ),
      salesSeries: normalize(
        domesticMeta.productSeries
        || rowAliasValue(product, ['productSeries', '销售系列', '系列'])
        || rowAliasValue(row, ['销售系列', '系列'])
      ),
      model: normalize(productCategoryModel(product)),
      purchaseOwner: normalize(domesticMeta.purchaseOwner || rowAliasValue(row, ['采购下单人', '下单人', '采购负责人'])),
      wdtStockQty,
      nonSelf7dOutQty,
      nonSelf30dOutQty,
      nonSelfDailySales,
      nonSelfFuture14dDemandQty,
      jdStockQty,
      self7dOutQty,
      self30dOutQty,
      selfDailySales,
      selfDailySalesManual: false,
      selfFuture14dInboundQty,
      allChannelFuture14dMinDemandQty,
      needProduction: wdtStockQty < allChannelFuture14dMinDemandQty ? '需要生产' : '',
      estimatedStockoutDate: sellableDays ? addDaysText(sellableDays) : '',
      sellableDays,
      risk: riskLabel(sellableDays, wdtStockQty),
      domesticUndeliveredQty: numberValue(domesticUndeliveredMap.get(materialCode)),
      nextSupplyDate: normalize(manual.next_supply_date),
      nextSupplyQty: numberValue(manual.next_supply_qty),
      remark: normalize(manual.remark),
      updatedBy: normalize(manual.updated_by),
      updatedAt: normalize(manual.updated_at)
    };
  }).filter((row) => row.merchantCode).sort((left, right) => (
    Number(domesticRowHasActivity(right)) - Number(domesticRowHasActivity(left))
    || normalize(left.merchantCode).localeCompare(normalize(right.merchantCode), 'zh-Hans-CN')
  ));
}

const CROSS_BORDER_TARGETS = {
  dimensionSpare: { title: '领星SKU和物料编码对照', page: 'dimensionLibrary', fields: ['领星SKU', '物料编码'] },
  lingxingWarehouseMap: { title: '领星&金蝶仓库对照', page: 'dimensionLibrary', fields: ['领星仓库名称', '金蝶仓库名称'] },
  productCategory: { title: '商品分类', page: 'dimensionLibrary', fields: ['物料编码', 'SKU', '物料名称', '销售产品线', '销售系列', '型号', '销售区域'] },
  warehouseMaterialMap: { title: '仓库与物料对照表', page: 'dimensionLibrary', fields: ['金蝶仓库名称', '物料编码', '事业部'] },
  spare1: { title: '仓库名称', page: 'dimensionLibrary', fields: ['金蝶仓库名称', '仓位位置', '站点', '一级仓库分类', '二级仓库分类'] }
};

function strictNumberValue(value) {
  const text = normalize(value).replace(/,/g, '');
  if (!text) return { valid: false, value: 0 };
  const parsed = Number(text);
  return Number.isFinite(parsed) ? { valid: true, value: parsed } : { valid: false, value: 0 };
}

function exactDimensionLookup(rows, keyOf, valueOf) {
  const buckets = new Map();
  rows.forEach((row) => {
    const key = normalizeMatchPart(keyOf(row));
    if (!key) return;
    const value = valueOf(row);
    const signature = JSON.stringify(value);
    if (!buckets.has(key)) buckets.set(key, new Map());
    buckets.get(key).set(signature, value);
  });
  return {
    resolve(rawKey) {
      const key = normalizeMatchPart(rawKey);
      const bucket = key ? buckets.get(key) : null;
      if (!bucket?.size) return { status: 'missing', key };
      const values = [...bucket.values()];
      if (values.length > 1) return { status: 'conflict', key, values };
      return { status: 'ok', key, value: values[0] };
    }
  };
}

function crossBorderSourceApplications() {
  return [
    ['lingxingFbaInventory', 'FBA库存'],
    ['lingxingFbmInventory', 'FBM库存'],
    ['lingxingWfsInventory', 'WFS库存'],
    ['dimensionSpare', '领星SKU和物料编码对照'],
    ['lingxingWarehouseMap', '领星&金蝶仓库对照'],
    ['warehouseMaterialMap', '仓库与物料对照表'],
    ['spare1', '仓库名称'],
    ['productCategory', '商品分类']
  ].map(([slotId, label]) => {
    const record = get('SELECT file_name, updated_at, applied FROM dimension_files WHERE slot_id = ?', [slotId]);
    return {
      slotId,
      label,
      fileName: record?.file_name || '未上传',
      appliedAt: record?.applied ? (record.updated_at || '暂无') : '未应用'
    };
  });
}

function buildCrossBorderInventoryModel() {
  const sourceApplications = crossBorderSourceApplications();
  const applicationMap = new Map(sourceApplications.map((item) => [item.slotId, item]));
  const missingMap = new Map();
  const conflictMap = new Map();
  const sourceAnomalies = [];
  let filteredFbaRows = 0;

  const skuLookup = exactDimensionLookup(
    getDimensionRows('dimensionSpare'),
    (row) => rowAliasValue(row, ['lingxingSku', '领星SKU', 'SKU', 'MSKU', 'Seller SKU']),
    (row) => ({ materialCode: rowAliasValue(row, ['materialCode', '物料编码', '品号']) })
  );
  const warehouseLookup = exactDimensionLookup(
    getDimensionRows('lingxingWarehouseMap'),
    (row) => rowAliasValue(row, ['lingxingWarehouseName', '领星仓库名称', '领星仓库']),
    (row) => ({
      kingdeeWarehouseCode: rowAliasValue(row, ['kingdeeWarehouseCode', '金蝶仓库编码']),
      kingdeeWarehouseName: rowAliasValue(row, ['kingdeeWarehouseName', '金蝶仓库名称'])
    })
  );
  const productLookup = exactDimensionLookup(
    getDimensionRows('productCategory'),
    (row) => rowAliasValue(row, ['materialCode', '物料编码', '品号']),
    (row) => ({
      sku: rowAliasValue(row, ['sku', 'SKU']),
      logisticsCode: rowAliasValue(row, ['logisticsCode', '物流编码']),
      materialName: rowAliasValue(row, ['materialName', '物料名称', '产品名称']),
      productLine: rowAliasValue(row, ['productLine', '销售产品线', '产品线']),
      productSeries: rowAliasValue(row, ['productSeries', '销售系列', '系列']),
      model: rowAliasValue(row, ['model', '型号'])
    })
  );
  const warehouseMaterialLookup = exactDimensionLookup(
    getDimensionRows('warehouseMaterialMap'),
    (row) => [
      rowAliasValue(row, ['warehouseName', 'kingdeeWarehouseName', '金蝶仓库名称', '仓库名称']),
      rowAliasValue(row, ['materialCode', '物料编码', '品号'])
    ].map(normalizeMatchPart).join('|'),
    (row) => ({ businessUnit: rowAliasValue(row, ['businessUnit', '事业部']) })
  );
  const warehouseCategoryLookup = exactDimensionLookup(
    getDimensionRows('spare1'),
    (row) => rowAliasValue(row, ['warehouseName', 'kingdeeWarehouseName', '金蝶仓库名称', '仓库名称']),
    (row) => ({
      warehouseCode: rowAliasValue(row, ['warehouseCode', 'kingdeeWarehouseCode', '金蝶仓库编码', '仓库编码']),
      marketplace: rowAliasValue(row, ['marketplace', '站点', '站点名称', '国家站点', '销售站点', '国家/地区']),
      level1WarehouseCategory: rowAliasValue(row, ['level1WarehouseCategory', '一级仓库分类']),
      level2WarehouseCategory: warehouseLevel2CategoryValue(row)
    })
  );

  function appendAggregate(targetMap, targetSlotId, issueCode, missingKey, row, candidates = []) {
    if (row.inventoryQty === 0) return;
    const target = CROSS_BORDER_TARGETS[targetSlotId];
    const key = `${targetSlotId}|${issueCode}|${missingKey}`;
    if (!targetMap.has(key)) {
      targetMap.set(key, {
        id: key,
        targetSlotId,
        targetTitle: target.title,
        maintainPage: target.page,
        requiredFields: target.fields,
        issueCode,
        missingKey,
        affectedRows: 0,
        inventoryQty: 0,
        inventoryTypes: new Set(),
        stores: new Set(),
        marketplaces: new Set(),
        candidates,
        updatedAt: applicationMap.get(targetSlotId)?.appliedAt || '暂无'
      });
    }
    const task = targetMap.get(key);
    task.affectedRows += 1;
    task.inventoryQty += row.inventoryQty;
    if (row.inventoryType) task.inventoryTypes.add(row.inventoryType);
    if (row.storeName) task.stores.add(row.storeName);
    if (row.marketplace) task.marketplaces.add(row.marketplace);
  }

  function addMappingIssue(row, status, targetSlotId, issueCode, missingKey, candidates = []) {
    const target = CROSS_BORDER_TARGETS[targetSlotId];
    if (target && !row.maintenanceTargets.some((item) => item.slotId === targetSlotId)) {
      row.maintenanceTargets.push({
        slotId: targetSlotId,
        title: target.title,
        page: target.page,
        requiredFields: target.fields
      });
    }
    row.problemCodes.push(issueCode);
    if (status === 'conflict') {
      row.hasConflict = true;
      appendAggregate(conflictMap, targetSlotId, issueCode, missingKey, row, candidates);
    } else {
      row.hasMissing = true;
      appendAggregate(missingMap, targetSlotId, issueCode, missingKey, row);
    }
  }

  const sourceDefinitions = [
    { slotId: 'lingxingFbaInventory', inventoryType: 'FBA' },
    { slotId: 'lingxingFbmInventory', inventoryType: 'FBM' },
    { slotId: 'lingxingWfsInventory', inventoryType: 'WFS' }
  ];
  const sourceRows = [];
  sourceDefinitions.forEach(({ slotId, inventoryType }) => {
    const rows = getDimensionRows(slotId);
    const application = applicationMap.get(slotId);
    if (!rows.length) {
      sourceAnomalies.push({
        id: `${slotId}|missing-file`, slotId, sourceTitle: application?.label || inventoryType,
        inventoryType, issueType: '源文件缺失', detail: '未上传已应用的库存文件', sourceKey: '',
        storeName: '', marketplace: '', warehouseName: '', inventoryQty: '', updatedAt: application?.appliedAt || '暂无'
      });
      return;
    }
    rows.forEach((rawRow, index) => {
      const storeName = rowAliasValue(rawRow, ['storeName', '店铺', '店铺名称', '账号', '账号名称']);
      const marketplace = rowAliasValue(rawRow, ['marketplace', '站点', '国家', '国家/地区', '销售平台']);
      const warehouseName = rowAliasValue(rawRow, ['warehouseName', '领星仓库名称', '仓库名称', '仓库名', '仓库']);
      const sourceSku = rowAliasValue(rawRow, ['sku', 'SKU', 'MSKU', 'Seller SKU', '卖家SKU', '商品SKU']);
      const identifier = rowAliasValue(rawRow, ['identifier', '识别码']);
      const fnsku = rowAliasValue(rawRow, ['fnsku', 'FNSKU']);
      const asin = rowAliasValue(rawRow, ['asin', 'ASIN']);
      const itemId = rowAliasValue(rawRow, ['itemId', 'Item ID', 'ItemID', '商品ID', '产品ID']);
      let quantityRaw = '';
      let sourceProductKey = sourceSku;
      if (inventoryType === 'FBA') {
        const inventoryAttribute = rowAliasValue(rawRow, ['inventoryAttribute', '库存属性']);
        if (!inventoryAttribute) {
          sourceAnomalies.push({ id: `${slotId}|${index}|attribute`, slotId, sourceTitle: application?.label, inventoryType, issueType: '必填字段缺失', detail: '缺少“库存属性”字段或字段映射', sourceKey: sourceSku, storeName, marketplace, warehouseName, inventoryQty: '', updatedAt: application?.appliedAt || '暂无' });
          return;
        }
        if (normalizeMatchPart(inventoryAttribute) !== '全部') {
          filteredFbaRows += 1;
          return;
        }
        quantityRaw = rowAliasValue(rawRow, [
          'endingInventoryQty',
          'totalQty',
          '期末库存(含移仓)',
          '期末库存（含移仓）',
          '期末库存(含移仓)-数量',
          '期末库存（含移仓）-数量',
          '期末库存(含移仓)数量'
        ]);
      } else if (inventoryType === 'FBM') {
        sourceProductKey = identifier;
        quantityRaw = rowAliasValue(rawRow, ['actualTotalQty', '实际总量']);
      } else {
        quantityRaw = rowAliasValue(rawRow, ['totalInventoryQty', '总库存(数量)', '总库存（数量）']);
      }
      const quantity = strictNumberValue(quantityRaw);
      const missingFields = [];
      if (!sourceProductKey) missingFields.push(inventoryType === 'FBM' ? '识别码' : 'SKU');
      if (!warehouseName) missingFields.push('仓库名称');
      if (!quantity.valid) missingFields.push(inventoryType === 'FBA' ? '期末库存(含移仓)' : inventoryType === 'FBM' ? '实际总量' : '总库存(数量)');
      if (missingFields.length) {
        sourceAnomalies.push({
          id: `${slotId}|${index}|required`, slotId, sourceTitle: application?.label, inventoryType,
          issueType: quantity.valid ? '必填字段缺失' : '数量无法解析', detail: `缺少或无法解析：${missingFields.join('、')}`,
          sourceKey: sourceProductKey, storeName, marketplace, warehouseName, inventoryQty: quantity.valid ? quantity.value : '', updatedAt: application?.appliedAt || '暂无'
        });
        return;
      }
      sourceRows.push({
        id: `${slotId}|${index}`,
        slotId,
        sourceRow: index + 2,
        inventoryType,
        storeName,
        marketplace,
        sourceSku,
        identifier,
        fnsku,
        asin,
        itemId,
        warehouseName,
        inventoryQty: quantity.value,
        sourceAppliedAt: application?.appliedAt || '暂无',
        problemCodes: [],
        sourceProblemCodes: [],
        maintenanceTargets: [],
        hasMissing: false,
        hasConflict: false
      });
    });
  });

  const duplicateMap = new Map();
  sourceRows.forEach((row) => {
    const productKey = row.inventoryType === 'FBM' ? row.identifier : row.sourceSku;
    const key = [row.inventoryType, row.storeName, row.marketplace, productKey, row.fnsku, row.asin, row.itemId, row.warehouseName].map(normalizeMatchPart).join('|');
    if (!duplicateMap.has(key)) duplicateMap.set(key, []);
    duplicateMap.get(key).push(row);
  });
  duplicateMap.forEach((duplicates, sourceKey) => {
    if (duplicates.length < 2) return;
    duplicates.forEach((row) => row.sourceProblemCodes.push('重复来源业务键'));
    const first = duplicates[0];
    sourceAnomalies.push({
      id: `${first.slotId}|duplicate|${sourceKey}`, slotId: first.slotId,
      sourceTitle: applicationMap.get(first.slotId)?.label, inventoryType: first.inventoryType,
      issueType: '重复来源业务键', detail: `同一来源业务键出现 ${duplicates.length} 行，明细保留且未自动合并`,
      sourceKey, storeName: first.storeName, marketplace: first.marketplace, warehouseName: first.warehouseName,
      inventoryQty: duplicates.reduce((sum, row) => sum + row.inventoryQty, 0), updatedAt: first.sourceAppliedAt
    });
  });

  const rows = sourceRows.map((row) => {
    if (row.inventoryQty < 0) {
      row.sourceProblemCodes.push('负库存');
      sourceAnomalies.push({
        id: `${row.id}|negative`, slotId: row.slotId, sourceTitle: applicationMap.get(row.slotId)?.label,
        inventoryType: row.inventoryType, issueType: '负库存', detail: '库存数量小于0，已计入总量并标记异常',
        sourceKey: row.inventoryType === 'FBM' ? row.identifier : row.sourceSku,
        storeName: row.storeName, marketplace: row.marketplace, warehouseName: row.warehouseName,
        inventoryQty: row.inventoryQty, updatedAt: row.sourceAppliedAt
      });
    }

    let materialCode = row.inventoryType === 'FBM' ? row.identifier : '';
    if (row.inventoryType !== 'FBM') {
      const skuResult = skuLookup.resolve(row.sourceSku);
      if (skuResult.status === 'ok' && normalize(skuResult.value.materialCode)) {
        materialCode = normalize(skuResult.value.materialCode);
      } else {
        addMappingIssue(row, skuResult.status === 'conflict' ? 'conflict' : 'missing', 'dimensionSpare', '领星SKU未映射物料编码', row.sourceSku, skuResult.values || []);
      }
    }

    let warehouse = {};
    const warehouseResult = warehouseLookup.resolve(row.warehouseName);
    if (warehouseResult.status === 'ok' && normalize(warehouseResult.value.kingdeeWarehouseName)) {
      warehouse = warehouseResult.value;
    } else {
      addMappingIssue(row, warehouseResult.status === 'conflict' ? 'conflict' : 'missing', 'lingxingWarehouseMap', '领星仓库未映射金蝶仓库', row.warehouseName, warehouseResult.values || []);
    }

    let product = {};
    if (materialCode) {
      const productResult = productLookup.resolve(materialCode);
      if (productResult.status === 'ok') product = productResult.value;
      else addMappingIssue(row, productResult.status, 'productCategory', '物料编码缺少商品分类', materialCode, productResult.values || []);
    }

    let warehouseMaterial = {};
    const kingdeeWarehouseName = normalize(warehouse.kingdeeWarehouseName);
    if (kingdeeWarehouseName && materialCode) {
      const combinedKey = [kingdeeWarehouseName, materialCode].map(normalizeMatchPart).join('|');
      const result = warehouseMaterialLookup.resolve(combinedKey);
      if (result.status === 'ok' && normalize(result.value.businessUnit)) warehouseMaterial = result.value;
      else addMappingIssue(row, result.status === 'conflict' ? 'conflict' : 'missing', 'warehouseMaterialMap', '仓库与物料缺少事业部', `${kingdeeWarehouseName}+${materialCode}`, result.values || []);
    }

    let warehouseCategory = {};
    if (kingdeeWarehouseName) {
      const result = warehouseCategoryLookup.resolve(kingdeeWarehouseName);
      if (result.status === 'ok' && normalize(result.value.marketplace) && normalize(result.value.level1WarehouseCategory) && normalize(result.value.level2WarehouseCategory)) {
        warehouseCategory = result.value;
      } else {
        addMappingIssue(row, result.status === 'conflict' ? 'conflict' : 'missing', 'spare1', '金蝶仓库缺少站点或仓库分类', kingdeeWarehouseName, result.values || []);
        if (result.status === 'ok') warehouseCategory = result.value;
      }
    }

    return {
      ...row,
      materialCode: materialCode || '未映射',
      sku: normalize(product.sku) || '未映射',
      logisticsCode: normalize(product.logisticsCode) || '未映射',
      materialName: normalize(product.materialName) || '未映射',
      productLine: normalize(product.productLine) || '未映射',
      productSeries: normalize(product.productSeries) || '未映射',
      model: normalize(product.model) || '未映射',
      kingdeeWarehouseCode: normalize(warehouse.kingdeeWarehouseCode) || '未映射',
      kingdeeWarehouseName: kingdeeWarehouseName || '未映射',
      sourceMarketplace: normalize(row.marketplace),
      marketplace: normalize(warehouseCategory.marketplace) || '未映射',
      businessUnit: normalize(warehouseMaterial.businessUnit) || '未映射',
      level1WarehouseCategory: normalize(warehouseCategory.level1WarehouseCategory) || '未映射',
      level2WarehouseCategory: normalize(warehouseCategory.level2WarehouseCategory) || '未映射',
      stockStatus: row.inventoryQty > 0 ? '有库存' : row.inventoryQty < 0 ? '负库存' : '零库存',
      mappingStatus: row.hasConflict ? '映射冲突' : row.hasMissing ? '维度缺失' : '完整',
      sourceStatus: row.sourceProblemCodes.length ? '源文件异常' : '正常',
      availableQty: row.inventoryQty,
      totalQty: row.inventoryQty
    };
  });

  const finalizeAggregates = (map) => [...map.values()].map((task) => ({
    ...task,
    inventoryTypes: [...task.inventoryTypes].sort().join('、'),
    stores: [...task.stores].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')).join('、'),
    marketplaces: [...task.marketplaces].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')).join('、')
  })).sort((a, b) => Math.abs(b.inventoryQty) - Math.abs(a.inventoryQty));
  const missingTasks = finalizeAggregates(missingMap);
  const conflicts = finalizeAggregates(conflictMap);
  const detailedSourceAnomalies = sourceAnomalies.map((row) => ({
    ...row,
    targetSlotId: row.slotId,
    targetTitle: row.sourceTitle || applicationMap.get(row.slotId)?.label || row.inventoryType,
    maintainPage: 'lingxingInventory'
  }));
  const inventoryQty = rows.reduce((sum, row) => sum + row.inventoryQty, 0);
  const completeRows = rows.filter((row) => row.mappingStatus === '完整');
  const completeInventoryQty = completeRows.reduce((sum, row) => sum + row.inventoryQty, 0);
  return {
    rows,
    missingTasks,
    conflicts,
    sourceAnomalies: detailedSourceAnomalies,
    sourceApplications,
    qualitySummary: {
      rowCount: rows.length,
      inventoryQty,
      completeRows: completeRows.length,
      completeInventoryQty,
      issueRows: rows.length - completeRows.length,
      issueInventoryQty: inventoryQty - completeInventoryQty,
      missingTaskCount: missingTasks.length,
      conflictCount: conflicts.length,
      sourceAnomalyCount: detailedSourceAnomalies.length,
      filteredFbaRows
    }
  };
}

let inventorySummaryResultCache = { version: '', main: null, manualCategory: '', manualPayload: null };

function inventorySummarySourceVersion() {
  return all(
    `SELECT slot_id, file_name, updated_at, applied, length(rows_json) AS rows_size
     FROM dimension_files
     WHERE applied = 1 AND (slot_id LIKE 'inventorySummaryFile%' OR slot_id LIKE 'inventoryManualFile%' OR slot_id IN ('productCategory', 'spare1', 'warehouseMaterialMap'))
     ORDER BY slot_id`
  ).map((row) => [row.slot_id, row.file_name, row.updated_at, row.applied, row.rows_size].join(':')).join('|');
}

function inventorySummaryData({ manualCategory = '' } = {}) {
  const version = inventorySummarySourceVersion();
  if (inventorySummaryResultCache.version !== version) {
    inventorySummaryResultCache = { version, main: null, manualCategory: '', manualPayload: null };
  }
  if (!manualCategory && inventorySummaryResultCache.main) return inventorySummaryResultCache.main;
  if (manualCategory === inventorySummaryResultCache.manualCategory && inventorySummaryResultCache.manualPayload) {
    return inventorySummaryResultCache.manualPayload;
  }
  const payload = buildInventorySummaryModel({
    getRows: getDimensionRows,
    getRecord(slotId) {
      const record = get(
        'SELECT rows_json, updated_at FROM dimension_files WHERE slot_id = ? AND applied = 1',
        [slotId]
      );
      return {
        rows: parseJson(record?.rows_json, []),
        updatedAt: record?.updated_at || ''
      };
    },
    includeManualReconciliation: Boolean(manualCategory),
    manualReconciliationCategories: manualCategory ? [manualCategory] : []
  });
  if (manualCategory) {
    const result = { updatedAt: payload.updatedAt, manualReconciliation: payload.manualReconciliation };
    inventorySummaryResultCache.manualCategory = manualCategory;
    inventorySummaryResultCache.manualPayload = result;
    return result;
  }
  inventorySummaryResultCache.main = payload;
  return payload;
}

function fullInventorySummaryData() {
  const inventoryRecord = get(
    `SELECT rows_json, updated_at
     FROM dimension_files
     WHERE slot_id = 'fullInventoryFile1' AND applied = 1`
  );
  const salesRecord = get(
    `SELECT rows_json
     FROM dimension_files
     WHERE slot_id = 'inventorySummaryFile8' AND applied = 1`
  );
  const fulfillmentRecord = get(
    `SELECT rows_json
     FROM dimension_files
     WHERE slot_id = 'fullInventoryFile2' AND applied = 1`
  );
  const undeliveredRows = all(
    `SELECT d.business_unit AS business_unit,
            k.material_code AS material_code,
            SUM(COALESCE(k.remaining_inbound_qty, 0)) AS undelivered_qty
     FROM order_demands d
     JOIN kingdee_orders k
       ON k.demand_key = d.demand_key
      AND k.batch_id = d.source_batch_id
     WHERE d.active = 1
     GROUP BY d.business_unit, k.material_code`
  );
  const summary = buildFullInventorySummary({
    inventoryRows: parseJson(inventoryRecord?.rows_json, []),
    productRows: getDimensionRows('productCategory'),
    salesRows: parseJson(salesRecord?.rows_json, []),
    undeliveredRows,
    updatedAt: inventoryRecord?.updated_at || ''
  });
  const fulfillmentRows = parseJson(fulfillmentRecord?.rows_json, []);
  const undeliveredGroup = summary.groups.find((group) => group.key === 'undelivered');
  if (undeliveredGroup) undeliveredGroup.rows = fulfillmentRows;
  return summary;
}

let inventoryRiskResultCache = { key: '', payload: null };
const INVENTORY_RISK_SETTING_KEY = 'global';
const BEI_HUO_GONG_JU_SETTING_KEY = 'beiHuoGongJu';
let beiHuoGongJuResultCache = { key: '', payload: null };

function currentInventoryRiskSettings() {
  const saved = get(
    'SELECT params_json, updated_by, updated_at FROM inventory_risk_settings WHERE setting_key = ?',
    [INVENTORY_RISK_SETTING_KEY]
  );
  let params;
  try {
    params = normalizeInventoryRiskParams(saved ? JSON.parse(saved.params_json) : {});
  } catch {
    params = normalizeInventoryRiskParams({});
  }
  return {
    params,
    updatedBy: saved?.updated_by || '',
    updatedAt: saved?.updated_at || ''
  };
}

function saveInventoryRiskSettings(input, userName) {
  const params = normalizeInventoryRiskParams(input);
  const paramsJson = JSON.stringify(params);
  const updatedAt = nowText();
  const updatedBy = normalize(userName) || '未知用户';
  transaction(() => {
    run(
      `INSERT INTO inventory_risk_settings (setting_key, params_json, updated_by, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(setting_key) DO UPDATE SET
         params_json = excluded.params_json,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
      [INVENTORY_RISK_SETTING_KEY, paramsJson, updatedBy, updatedAt]
    );
    run(
      `INSERT INTO inventory_risk_setting_history
         (id, setting_key, params_json, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), INVENTORY_RISK_SETTING_KEY, paramsJson, updatedBy, updatedAt]
    );
  });
  return { params, updatedBy, updatedAt };
}

function currentBeiHuoGongJuSettings() {
  const saved = get(
    'SELECT params_json, updated_by, updated_at FROM inventory_risk_settings WHERE setting_key = ?',
    [BEI_HUO_GONG_JU_SETTING_KEY]
  );
  let params;
  try {
    params = normalizeInventoryRiskParams(saved ? JSON.parse(saved.params_json) : {});
  } catch {
    params = normalizeInventoryRiskParams({});
  }
  return {
    params,
    updatedBy: saved?.updated_by || '',
    updatedAt: saved?.updated_at || ''
  };
}

function saveBeiHuoGongJuSettings(input, userName) {
  const params = normalizeInventoryRiskParams(input);
  const paramsJson = JSON.stringify(params);
  const updatedAt = nowText();
  const updatedBy = normalize(userName) || '未知用户';
  transaction(() => {
    run(
      `INSERT INTO inventory_risk_settings (setting_key, params_json, updated_by, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(setting_key) DO UPDATE SET
         params_json = excluded.params_json,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
      [BEI_HUO_GONG_JU_SETTING_KEY, paramsJson, updatedBy, updatedAt]
    );
    run(
      `INSERT INTO inventory_risk_setting_history
         (id, setting_key, params_json, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), BEI_HUO_GONG_JU_SETTING_KEY, paramsJson, updatedBy, updatedAt]
    );
  });
  return { params, updatedBy, updatedAt };
}

const SUPPLY_PLAN_SETTING_KEY = 'supplyPlan';

function currentSupplyPlanSettings() {
  const saved = get(
    'SELECT params_json, updated_by, updated_at FROM inventory_risk_settings WHERE setting_key = ?',
    [SUPPLY_PLAN_SETTING_KEY]
  );
  let params;
  try {
    params = normalizeSupplyPlanParams(saved ? JSON.parse(saved.params_json) : {});
  } catch {
    params = normalizeSupplyPlanParams({});
  }
  return {
    params,
    updatedBy: saved?.updated_by || '',
    updatedAt: saved?.updated_at || ''
  };
}

function saveSupplyPlanSettings(input, userName) {
  const params = normalizeSupplyPlanParams(input);
  const paramsJson = JSON.stringify(params);
  const updatedAt = nowText();
  const updatedBy = normalize(userName) || '未知用户';
  transaction(() => {
    run(
      `INSERT INTO inventory_risk_settings (setting_key, params_json, updated_by, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(setting_key) DO UPDATE SET
         params_json = excluded.params_json,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
      [SUPPLY_PLAN_SETTING_KEY, paramsJson, updatedBy, updatedAt]
    );
  });
  return { params, updatedBy, updatedAt };
}

function inventoryRiskSourceVersion() {
  return all(
    'SELECT slot_id, file_name, updated_at, applied, length(rows_json) AS rows_size FROM dimension_files WHERE applied = 1 ORDER BY slot_id'
  ).map((row) => [row.slot_id, row.file_name, row.updated_at, row.applied, row.rows_size].join(':')).join('|');
}

function inventoryRiskData(input = {}, { force = false } = {}) {
  const params = normalizeInventoryRiskParams(input);
  const sourceVersion = inventoryRiskSourceVersion();
  const key = inventoryRiskCacheKey(sourceVersion, params);
  if (!force && inventoryRiskResultCache.key === key && inventoryRiskResultCache.payload) {
    return inventoryRiskResultCache.payload;
  }
  const forecastRecord = get(
    'SELECT file_name, rows_json, updated_at FROM dimension_files WHERE slot_id = ? AND applied = 1',
    ['inventorySummaryFile15']
  );
  const payload = buildInventoryRiskAnalysis({
    inventoryModel: inventorySummaryData(),
    forecastRows: parseJson(forecastRecord?.rows_json, []),
    forecastSource: {
      fileName: forecastRecord?.file_name || '',
      updatedAt: forecastRecord?.updated_at || ''
    },
    params,
    sourceVersion
  });
  if (payload.ok) inventoryRiskResultCache = { key, payload };
  return payload;
}

function beiHuoGongJuData(input = {}, { force = false } = {}) {
  const params = normalizeInventoryRiskParams(input);
  const mode = input.mode === 'model' ? 'model' : 'materialCode';
  const sourceVersion = inventoryRiskSourceVersion();
  const stockupRecord = get(
    'SELECT rows_json, file_name, updated_at FROM dimension_files WHERE slot_id = ? AND applied = 1',
    ['beiHuoReviewFile1']
  );
  const stockupMaterialCodes = [...new Set(parseJson(stockupRecord?.rows_json, [])
    .map((row) => normalize(pickAny(row, ['物料编码', '品号', '物料编号', '物料代码', 'materialCode'])).replace(/\.0$/, ''))
    .filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { numeric: true }));
  const key = `${inventoryRiskCacheKey(sourceVersion, params)}|${mode}|${stockupMaterialCodes.join(',')}`;
  if (!force && beiHuoGongJuResultCache.key === key && beiHuoGongJuResultCache.payload) {
    return beiHuoGongJuResultCache.payload;
  }
  const forecastRecord = get(
    'SELECT file_name, rows_json, updated_at FROM dimension_files WHERE slot_id = ? AND applied = 1',
    ['inventorySummaryFile15']
  );
  const payload = buildBeiHuoReviewAnalysis({
    inventoryModel: inventorySummaryData(),
    forecastRows: parseJson(forecastRecord?.rows_json, []),
    forecastSource: {
      fileName: forecastRecord?.file_name || '',
      updatedAt: forecastRecord?.updated_at || ''
    },
    params,
    mode,
    stockupMaterialCodes,
    sourceVersion
  });
  if (payload.ok) beiHuoGongJuResultCache = { key, payload };
  return payload;
}

function enrichDemandFields(supplier, materialCode, orderCreator = '', lookups = dimensionLookups()) {
  const { productMap, supplierMap } = lookups;
  const product = productMap.get(normalize(materialCode)) || {};
  const assignment = resolveAssignment(lookups, supplier, materialCode);
  const supplierAssignment = supplierMap.get(normalizeMatchPart(supplier)) || {};
  return {
    sku: normalize(product.sku),
    logisticsCode: normalize(product.logisticsCode),
    materialName: productDimensionMaterialName(product, materialCode),
    productLine: normalize(product.productLine),
    productSeries: normalize(product.productSeries),
    pretaxPrice: numberValue(product.pretaxPrice),
    pretaxPriceMaintained: normalize(product.pretaxPrice) !== '',
    supplierShortName: assignmentSupplierShortName(lookups, materialCode, [assignment, supplierAssignment]),
    purchaseGroup: assignmentGroup(assignment),
    purchaseOwner: realPurchaseOwner(assignmentOwner(assignment)) || UNASSIGNED_PURCHASE_OWNER,
    purchaseOrg: normalize(assignment.purchaseOrg)
  };
}

function applyDimensionEnrichment() {
  const lookups = dimensionLookups();
  const { productMap, supplierMap } = lookups;
  const params = all('SELECT * FROM order_demands').map((demand) => {
    const product = productMap.get(normalize(demand.material_code)) || {};
    const assignment = resolveAssignment(lookups, demand.supplier, demand.material_code);
    const supplierSpecificAssignment = resolveSupplierAssignment(lookups, demand.supplier, demand.material_code);
    const supplierAssignment = supplierMap.get(normalizeMatchPart(demand.supplier)) || {};
    const supplierSpecificShortName = assignmentSupplierDisplayNames(supplierSpecificAssignment).join('&')
      || normalize(demand.supplier_short_name);
    return [
      normalize(product.sku),
      normalize(product.logisticsCode),
      productDimensionMaterialName(product, demand.material_code),
      normalize(product.productLine),
      normalize(product.productSeries),
      supplierSpecificShortName,
      assignmentGroup(assignment),
      realPurchaseOwner(assignmentOwner(assignment)) || UNASSIGNED_PURCHASE_OWNER,
      normalize(assignment.purchaseOrg),
      demand.demand_key
    ];
  });
  runMany(
    `UPDATE order_demands
     SET sku = COALESCE(NULLIF(?, ''), sku),
         logistics_code = COALESCE(NULLIF(?, ''), logistics_code),
         material_name = COALESCE(NULLIF(?, ''), material_name),
         product_line = COALESCE(NULLIF(?, ''), product_line),
         product_series = COALESCE(NULLIF(?, ''), product_series),
         supplier_short_name = ?,
         purchase_group = COALESCE(NULLIF(?, ''), purchase_group),
         purchase_owner = ?,
         purchase_org = COALESCE(NULLIF(?, ''), purchase_org)
     WHERE demand_key = ?`,
    params
  );
}

function progressForDemand(demandKeyValue) {
  return get('SELECT * FROM supplier_progress WHERE demand_key = ?', [demandKeyValue]) || {
    demand_key: demandKeyValue,
    unprepared_qty: 0,
    prepared_not_started_qty: 0,
    in_production_qty: 0,
    finished_qty: 0,
    shipped_qty: 0,
    production_delivery_date: '',
    unproduced_estimated_delivery_date: '',
    fulfillment_status: '',
    unfulfilled_reason: '',
    reason_detail: '',
    remark: '',
    updated_by: '',
    updated_at: ''
  };
}

function progressAfterInbound(remainingQty, progress, inboundQty, options = {}) {
  const hasProgress = Boolean(progress?.demand_key);
  const nextShipped = Math.max(0, numberValue(inboundQty));
  const remainingInboundQty = Math.max(numberValue(remainingQty), 0);
  const unprepared = numberValue(progress?.unprepared_qty);
  const preparedNotStarted = numberValue(progress?.prepared_not_started_qty);
  const inProduction = numberValue(progress?.in_production_qty);
  const finished = numberValue(progress?.finished_qty);
  if (!hasProgress || !options.preserveExistingProgress) {
    return {
      unprepared: remainingInboundQty,
      preparedNotStarted: 0,
      inProduction: 0,
      finished: 0,
      shipped: nextShipped,
      gap: 0
    };
  }
  const gap = productionStageGap(remainingInboundQty, unprepared, preparedNotStarted, inProduction, finished);
  return { unprepared, preparedNotStarted, inProduction, finished, shipped: nextShipped, gap };
}

function hasManualProgressHistory(demandKeyValue) {
  return numberValue(get('SELECT COUNT(*) AS count FROM supplier_progress_snapshots WHERE demand_key = ?', [demandKeyValue])?.count) > 0;
}

function inventoryForDemand(demand) {
  return get('SELECT * FROM inventory WHERE stock_key = ?', [stockKey(demand.business_unit, demand.supplier, demand.material_code)]) || { stock_qty: 0 };
}

function demandBatchKey(batchId, demandKeyValue) {
  return [normalize(batchId), normalize(demandKeyValue)].join('|');
}

function defaultProgress(demandKeyValue) {
  return {
    demand_key: demandKeyValue,
    unprepared_qty: 0,
    prepared_not_started_qty: 0,
    in_production_qty: 0,
    finished_qty: 0,
    shipped_qty: 0,
    production_delivery_date: '',
    unproduced_estimated_delivery_date: '',
    fulfillment_status: '',
    unfulfilled_reason: '',
    reason_detail: '',
    remark: '',
    updated_by: '',
    updated_at: ''
  };
}

function demandLoadContext(demands, { includeInventory = true } = {}) {
  const lookups = dimensionLookups();
  const progressMap = new Map(all('SELECT * FROM supplier_progress').map((row) => [row.demand_key, row]));
  const followupMap = new Map(all('SELECT * FROM production_order_followups').map((row) => [row.tracking_key, row]));
  const inventoryMap = new Map((includeInventory ? all('SELECT * FROM inventory') : []).map((row) => [row.stock_key, row]));
  const batchIds = [...new Set(demands.map((row) => normalize(row.source_batch_id)).filter(Boolean))];
  const demandKeys = new Set(demands.map((row) => normalize(row.demand_key)));
  const orderRowsByDemand = new Map();
  const allOrderRowsByDemand = new Map();
  const currentOrderRows = [];
  if (batchIds.length) {
    const placeholders = batchIds.map(() => '?').join(',');
    all(
      `SELECT k.batch_id, k.demand_key, k.month, k.business_unit, k.supplier, k.material_code,
              k.creator, k.operator_name, k.oa_flow_no, k.order_no,
              k.quantity, k.inbound_qty, k.remaining_inbound_qty, k.purchase_date, k.delivery_date, k.material_name,
              k.document_status, k.close_status, k.business_close, k.order_remark, k.manual_close, k.raw_json,
              COALESCE(b.file_name, '') AS source_file
       FROM kingdee_orders k
       LEFT JOIN kingdee_import_batches b ON b.id = k.batch_id
       WHERE k.batch_id IN (${placeholders})`,
      batchIds
    ).forEach((row, index) => {
      currentOrderRows.push(row);
      if (!demandKeys.has(normalize(row.demand_key))) return;
      const key = demandBatchKey(row.batch_id, row.demand_key);
      if (normalize(row.close_status) && normalize(row.close_status) !== TRACKING_CLOSE_STATUS) return;
      const allRows = allOrderRowsByDemand.get(key) || [];
      allRows.push(orderRowDateSort(row, index));
      allOrderRowsByDemand.set(key, allRows);
      const list = orderRowsByDemand.get(key) || [];
      list.push(orderRowDateSort(row, index));
      orderRowsByDemand.set(key, list);
    });
  }
  return {
    lookups,
    progressMap,
    followupMap,
    inventoryMap,
    orderRowsByDemand,
    allOrderRowsByDemand,
    orderChangeIndex: buildOrderChangeIndex(currentOrderRows)
  };
}

function currentKingdeeNonZeroOrderGroups() {
  return groupCurrentKingdeeOrderRows(all(
    `SELECT k.demand_key, k.order_no, k.remaining_inbound_qty
     FROM kingdee_orders k
     JOIN order_demands d
       ON d.source_batch_id = k.batch_id AND d.demand_key = k.demand_key AND d.active = 1`
  ));
}

function canEditDemand(user, demand) {
  if (user.role === ROLE_ADMIN) return true;
  const owner = normalize(demand.purchase_owner);
  if (!owner || owner === UNASSIGNED_PURCHASE_OWNER) return false;
  return splitDelimited(owner).includes(normalize(user.name));
}

function manualProgressSupplierParts(value) {
  return [...new Set(normalize(value).split(/[&+、,，;；]/).map(normalize).filter(Boolean))];
}

function manualProgressMatchPart(value) {
  return normalizeMatchPart(value);
}

function manualProgressMatchKey(values) {
  return values.map(manualProgressMatchPart).join('|');
}

function manualProgressBusinessUnit(value) {
  return normalize(value).split('*')[0].trim();
}

function manualProgressCandidateMaps() {
  const startedAt = Date.now();
  const demands = all('SELECT * FROM order_demands WHERE active = 1');
  const demandsLoadedAt = Date.now();
  const lookups = dimensionLookups();
  const lookupsLoadedAt = Date.now();
  const demandMap = new Map(demands.map((row) => [row.demand_key, row]));
  const exact = new Map();
  const byFallback = new Map();
  const batchIds = [...new Set(demands.map((row) => normalize(row.source_batch_id)).filter(Boolean))];
  const orderRows = batchIds.length
    ? all(
      `SELECT * FROM kingdee_orders WHERE batch_id IN (${batchIds.map(() => '?').join(',')})`,
      batchIds
    )
    : [];
  const orderRowsLoadedAt = Date.now();
  const rowsByDemand = new Map();
  orderRows.forEach((row) => {
    if (!demandMap.has(row.demand_key)) return;
    const list = rowsByDemand.get(row.demand_key) || [];
    list.push(row);
    rowsByDemand.set(row.demand_key, list);
  });
  const add = (target, key, candidate) => {
    if (!key || key.split('|').some((part) => !part)) return;
    const list = target.get(key) || [];
    if (!list.some((item) => item.demandKey === candidate.demandKey && item.orderNo === candidate.orderNo)) list.push(candidate);
    target.set(key, list);
  };
  demands.forEach((demand) => {
    const demandOrderRows = rowsByDemand.get(demand.demand_key) || [];
    const shortNames = manualProgressSupplierParts(orderSupplierShortName(lookups, demand.supplier, demand.material_code));
    const purchaseOwner = purchaseOwnersForSupplierShortNames(lookups, shortNames, demand.material_code);
    const groupedOrders = new Map();
    demandOrderRows.forEach((row) => {
      const orderNo = normalize(row.order_no);
      if (!orderNo) return;
      const current = groupedOrders.get(orderNo) || {
        demandKey: demand.demand_key,
        orderNo,
        materialCode: demand.material_code,
        businessUnit: demand.business_unit,
        supplier: demand.supplier,
        supplierShortName: shortNames.join('&') || UNMATCHED_SUPPLIER_SHORT_NAME,
        purchaseOwner,
        purchaseOrg: demand.purchase_org || '',
        month: demand.month,
        orderQty: 0,
        inboundQty: 0,
        remainingQty: 0,
        hasOpenRow: false,
        documentStatuses: [],
        closeStatuses: [],
        creators: []
      };
      current.orderQty += numberValue(row.quantity);
      current.inboundQty += numberValue(row.inbound_qty);
      current.remainingQty += Math.max(numberValue(row.remaining_inbound_qty), 0);
      if (normalize(row.close_status) === TRACKING_CLOSE_STATUS) current.hasOpenRow = true;
      if (normalize(row.document_status) && !current.documentStatuses.includes(normalize(row.document_status))) current.documentStatuses.push(normalize(row.document_status));
      if (normalize(row.close_status) && !current.closeStatuses.includes(normalize(row.close_status))) current.closeStatuses.push(normalize(row.close_status));
      if (normalize(row.creator) && !current.creators.includes(normalize(row.creator))) current.creators.push(normalize(row.creator));
      groupedOrders.set(orderNo, current);
    });
    groupedOrders.forEach((candidate) => {
      candidate.isClosed = !candidate.hasOpenRow;
      candidate.weight = candidate.isClosed ? 0 : candidate.remainingQty;
      candidate.orderCreator = candidate.creators.join('、');
      candidate.closeStatus = candidate.closeStatuses.join('、');
      candidate.documentStatus = candidate.documentStatuses.join('、');
      add(exact, manualProgressMatchKey([candidate.orderNo, candidate.materialCode]), candidate);
      shortNames.forEach((shortName) => {
        const parts = [demand.month, manualProgressBusinessUnit(demand.business_unit), demand.material_code];
        add(byFallback, manualProgressMatchKey([...parts, shortName, purchaseOwner]), candidate);
        add(byFallback, manualProgressMatchKey([...parts, shortName, '']), candidate);
        add(byFallback, manualProgressMatchKey([...parts, shortName, UNASSIGNED_PURCHASE_OWNER]), candidate);
      });
    });
    shortNames.forEach((shortName) => {
      if (groupedOrders.size) return;
      const candidate = {
        demandKey: demand.demand_key,
        orderNo: '',
        materialCode: demand.material_code,
        businessUnit: demand.business_unit,
        supplier: demand.supplier,
        supplierShortName: shortName,
        purchaseOwner,
        month: demand.month,
        orderQty: numberValue(demand.tracking_order_qty),
        inboundQty: numberValue(demand.tracking_inbound_qty),
        remainingQty: Math.max(numberValue(demand.tracking_remaining_qty), 0),
        weight: Math.max(numberValue(demand.tracking_remaining_qty), 0),
        isClosed: numberValue(demand.tracking_order_qty) <= 0
      };
      const parts = [demand.month, manualProgressBusinessUnit(demand.business_unit), demand.material_code];
      add(byFallback, manualProgressMatchKey([...parts, shortName, purchaseOwner]), candidate);
      add(byFallback, manualProgressMatchKey([...parts, shortName, '']), candidate);
      add(byFallback, manualProgressMatchKey([...parts, shortName, UNASSIGNED_PURCHASE_OWNER]), candidate);
    });
  });
  console.info(`[Manual progress candidate maps] ${JSON.stringify({
    demands: demands.length,
    orders: orderRows.length,
    demandLoadMs: demandsLoadedAt - startedAt,
    lookupLoadMs: lookupsLoadedAt - demandsLoadedAt,
    orderLoadMs: orderRowsLoadedAt - lookupsLoadedAt,
    mapBuildMs: Date.now() - orderRowsLoadedAt,
    totalMs: Date.now() - startedAt
  })}`);
  return { demandMap, exact, byFallback };
}

function manualProgressCandidatePayload(candidate) {
  return {
    demandKey: candidate.demandKey,
    orderNo: candidate.orderNo,
    materialCode: candidate.materialCode,
    month: candidate.month,
    businessUnit: candidate.businessUnit,
    supplier: candidate.supplier,
    supplierShortName: candidate.supplierShortName,
    purchaseOwner: candidate.purchaseOwner,
    purchaseOrg: candidate.purchaseOrg || '',
    orderCreator: candidate.orderCreator || '',
    documentStatus: candidate.documentStatus || '',
    orderQty: numberValue(candidate.orderQty),
    inboundQty: numberValue(candidate.inboundQty),
    remainingQty: numberValue(candidate.remainingQty),
    isClosed: Boolean(candidate.isClosed)
  };
}

function manualProgressAllocationRows(row, candidates) {
  const allocationItems = candidates.map((candidate) => ({ ...candidate, weight: candidate.isClosed ? 0 : candidate.remainingQty }));
  const allocatedUnprepared = allocateIntegerByWeights(row.unpreparedQty, allocationItems);
  const allocatedPrepared = allocateIntegerByWeights(row.preparedNotStartedQty, allocationItems);
  const allocatedInProduction = allocateIntegerByWeights(row.inProductionQty, allocationItems);
  const allocatedFinished = allocateIntegerByWeights(row.finishedQty, allocationItems);
  return allocationItems.map((candidate, index) => ({
    id: randomUUID(),
    batchId: row.batchId || '',
    sourceRowId: row.id,
    sourceRowNo: row.sourceRowNo,
    orderNo: candidate.orderNo,
    materialCode: row.materialCode,
    demandKey: candidate.demandKey,
    matchStatus: candidate.isClosed ? '采购订单已关闭' : candidate.weight <= 0 ? '采购订单剩余为0' : '已匹配',
    matchReason: candidate.isClosed
      ? '采购订单已关闭，分配数量为0'
      : candidate.weight <= 0
        ? '采购订单当前剩余入库量为0，分配数量为0'
        : '采购订单号+物料编码精确匹配',
    isClosed: Boolean(candidate.isClosed),
    orderQty: candidate.orderQty,
    inboundQty: candidate.inboundQty,
    remainingQty: candidate.remainingQty,
    allocatedUnpreparedQty: allocatedUnprepared[index],
    allocatedPreparedQty: allocatedPrepared[index],
    allocatedInProductionQty: allocatedInProduction[index],
    allocatedFinishedQty: allocatedFinished[index]
  }));
}

function matchManualProgressRows(rows) {
  const maps = manualProgressCandidateMaps();
  rebalanceManualProgressSplitRows(rows, (row) => {
    const candidates = maps.exact.get(manualProgressMatchKey([row.orderNo, row.materialCode])) || [];
    if (candidates.length !== 1 || candidates[0].isClosed) return 0;
    return candidates[0].remainingQty;
  });
  rows.forEach((row) => {
    const retainedMessages = String(row.validationMessage || '')
      .split('；')
      .map((message) => message.trim())
      .filter(Boolean)
      .filter((message) => ![
        '采购订单对应关系缺失',
        '采购订单对应关系不唯一',
        '采购订单已关闭',
        '采购订单当前剩余入库量为0',
        '匹配到',
        '待管理员确认',
        '未匹配到候选采购订单物料',
        '手工已分配数量超过系统未交付数量',
        '手工未交付合计',
        '手工四阶段合计超过金蝶当前未交付数量',
        '手工生产阶段合计超过金蝶当前未交付数量',
        '金蝶未交付增加'
      ].some((prefix) => message.startsWith(prefix)));
    row.validationMessage = retainedMessages.join('；');
    row.validationStatus = retainedMessages.some((message) => [
      '生产中产品、已备料未生产、未备料未生产合计超过未交付数量',
      '完工未发产品不能大于未交付数量',
      '四阶段合计超过未交付数量',
      '必须是整数',
      '是否正常履约只能',
      '非正常履约必须填写未履约原因'
    ].some((errorText) => message.includes(errorText)))
      ? 'error'
      : 'valid';
    row.demandKey = '';
    row.allocations = [];
    row.candidates = [];
    if (row.validationStatus === 'error') {
      row.dataStatus = '校验失败';
      return;
    }
    if (row.rowType === 'company_contract') {
      row.dataStatus = '公司大合同';
      return;
    }
    if (row.deletedAt) {
      row.dataStatus = '已删除';
      row.validationStatus = 'deleted';
      return;
    }
    if ((row.conflictFields || []).length) {
      row.dataStatus = '字段冲突待维护';
      row.validationStatus = 'conflict';
      row.validationMessage = [row.validationMessage, `明细冲突：${row.conflictFields.join('、')}`].filter(Boolean).join('；');
      return;
    }
    let candidates = [];
    const orderNos = manualOrderNumbers(row.orderNo);
    if (orderNos.length && row.materialCode) {
      const missing = [];
      const ambiguous = [];
      orderNos.forEach((orderNo) => {
        const exactCandidates = maps.exact.get(manualProgressMatchKey([orderNo, row.materialCode])) || [];
        if (!exactCandidates.length) missing.push(orderNo);
        else if (exactCandidates.length > 1) ambiguous.push(orderNo);
        else candidates.push(exactCandidates[0]);
      });
      if (missing.length || ambiguous.length) {
        row.dataStatus = '手工待匹配';
        row.validationStatus = 'pending';
        const messages = [];
        if (missing.length) messages.push(`采购订单对应关系缺失：${missing.join('、')}`);
        if (ambiguous.length) messages.push(`采购订单对应关系不唯一：${ambiguous.join('、')}`);
        row.validationMessage = [row.validationMessage, ...messages].filter(Boolean).join('；');
        row.candidates = candidates.map(manualProgressCandidatePayload);
        return;
      }
    } else {
      candidates = manualProgressSupplierParts(row.supplierShortName).flatMap((shortName) => {
        const parts = [row.month, row.businessUnit, row.materialCode, shortName];
        return maps.byFallback.get(manualProgressMatchKey([...parts, row.purchaseOwner]))
          || maps.byFallback.get(manualProgressMatchKey([...parts, UNASSIGNED_PURCHASE_OWNER]))
          || maps.byFallback.get(manualProgressMatchKey([...parts, '']))
          || [];
      });
      candidates = [...new Map(candidates.map((candidate) => [`${candidate.demandKey}|${candidate.orderNo}`, candidate])).values()];
      row.candidates = candidates.map(manualProgressCandidatePayload);
      const confirmed = candidates.find((candidate) => (
        row.confirmedDemandKey
        && candidate.demandKey === row.confirmedDemandKey
        && (!row.confirmedOrderNo || candidate.orderNo === row.confirmedOrderNo)
      ));
      if (!confirmed) {
        row.dataStatus = '手工待匹配';
        row.validationStatus = 'pending';
        const reason = candidates.length
          ? `待管理员确认，可匹配 ${candidates.length} 个采购订单物料`
          : '未匹配到候选采购订单物料';
        row.validationMessage = [row.validationMessage, reason].filter(Boolean).join('；');
        return;
      }
      candidates = [confirmed];
    }
    row.allocations = manualProgressAllocationRows(row, candidates);
    row.candidates = candidates.map(manualProgressCandidatePayload);
    const demandKeys = [...new Set(candidates.map((candidate) => candidate.demandKey))];
    row.demandKey = demandKeys.length === 1 ? demandKeys[0] : '';
    row.dataStatus = candidates.every((candidate) => candidate.isClosed)
      ? '采购订单已关闭'
      : candidates.every((candidate) => numberValue(candidate.weight) <= 0)
        ? '采购订单剩余为0'
        : '手工已匹配';
    const closedOrders = candidates.filter((candidate) => candidate.isClosed).map((candidate) => candidate.orderNo);
    if (closedOrders.length) row.validationMessage = [row.validationMessage, `采购订单已关闭：${closedOrders.join('、')}，分配数量为0`].filter(Boolean).join('；');
    if (row.dataStatus === '采购订单剩余为0') {
      row.validationMessage = [row.validationMessage, '采购订单当前剩余入库量为0，生产阶段及完工未发分配数量为0'].filter(Boolean).join('；');
    }
  });

  return rows;
}

function manualProgressSummary(rows, baseSummary = {}) {
  const count = (status) => rows.filter((row) => row.dataStatus === status).length;
  return {
    ...baseSummary,
    matchedRows: count('手工已匹配'),
    manualUnmatchedRows: count('手工待匹配'),
    companyContractRows: count('公司大合同'),
    validationErrorRows: count('校验失败'),
    pendingAdjustmentRows: count('待人工调整'),
    closedOrderRows: count('采购订单已关闭'),
    zeroRemainingOrderRows: count('采购订单剩余为0'),
    conflictRows: count('字段冲突待维护'),
    deletedRows: count('已删除'),
    allocationRows: rows.reduce((sum, row) => sum + (row.allocations || []).length, 0),
    staleRows: count('本次手工表未出现')
  };
}

function manualProgressRowParams(batchId, row, now, userName) {
  row.id ||= randomUUID();
  return [
    row.id, batchId, row.sourceRowNo, row.sourceKey, row.groupKey || '', row.rowType,
    row.dataStatus, row.demandKey || '', row.orderNo, row.month, row.businessUnit,
    row.supplierShortName, row.purchaseOwner, row.purchaseGroup, row.oaFlowNo, row.operatorName,
    row.productLine, row.productSeries, row.materialCode, row.sku, row.materialName,
    row.manualRemainingQty, row.unpreparedQty, row.preparedNotStartedQty, row.inProductionQty,
    row.finishedQty, row.sourceShippedQty, row.sourceContractDeliveryDate,
    row.productionDeliveryDate, row.unproducedEstimatedDeliveryDate, row.fulfillmentStatus,
    row.unfulfilledReason, row.reasonDetail, row.remark, row.validationStatus,
    row.validationMessage, JSON.stringify(row.conflictFields || []), JSON.stringify(row.raw || {}),
    JSON.stringify(row.candidates || []), row.confirmedDemandKey || '', row.confirmedOrderNo || '',
    row.confirmedBy || '', row.confirmedAt || '', row.deletedBy || '', row.deletedAt || '', row.deleteReason || '',
    userName, now
  ];
}

function manualProgressDbModel(row) {
  const raw = parseJson(row.raw_json, {});
  const sourceValues = manualProgressSourceValues(raw);
  const storedDate = (stored, source) => /^\d{4}-\d{2}-\d{2}$/.test(normalize(stored)) ? normalize(stored) : source || normalize(stored);
  return {
    id: row.id,
    batchId: row.batch_id,
    sourceRowNo: numberValue(row.source_row_no),
    sourceKey: row.source_key,
    groupKey: row.group_key,
    rowType: row.row_type,
    dataStatus: row.data_status,
    demandKey: row.demand_key,
    orderNo: row.order_no,
    month: row.month,
    businessUnit: row.business_unit,
    supplierShortName: row.supplier_short_name,
    purchaseOwner: row.purchase_owner,
    purchaseGroup: row.purchase_group,
    oaFlowNo: row.oa_flow_no,
    operatorName: row.operator_name,
    productLine: row.product_line,
    productSeries: row.product_series,
    materialCode: row.material_code,
    sku: row.sku,
    materialName: row.material_name,
    manualRemainingQty: numberValue(row.manual_remaining_qty),
    unpreparedQty: numberValue(row.unprepared_qty),
    preparedNotStartedQty: numberValue(row.prepared_not_started_qty),
    inProductionQty: numberValue(row.in_production_qty),
    finishedQty: numberValue(row.finished_qty),
    sourceShippedQty: numberValue(row.source_shipped_qty),
    sourcePretaxPrice: sourceValues.sourcePretaxPrice,
    sourceNormalQty: sourceValues.sourceNormalQty,
    sourceNormalAmount: sourceValues.sourceNormalAmount,
    sourceAbnormalQty: sourceValues.sourceAbnormalQty,
    sourceAbnormalAmount: sourceValues.sourceAbnormalAmount,
    sourceContractDeliveryDate: storedDate(row.source_contract_delivery_date, sourceValues.sourceContractDeliveryDate),
    productionDeliveryDate: storedDate(row.production_delivery_date, sourceValues.productionDeliveryDate),
    unproducedEstimatedDeliveryDate: storedDate(row.unproduced_estimated_delivery_date, sourceValues.unproducedEstimatedDeliveryDate),
    fulfillmentStatus: row.fulfillment_status,
    unfulfilledReason: row.unfulfilled_reason,
    reasonDetail: row.reason_detail,
    remark: row.remark,
    validationStatus: row.validation_status,
    validationMessage: row.validation_message,
    conflictFields: parseJson(row.conflict_fields_json, []),
    raw,
    candidates: parseJson(row.candidate_json, []),
    confirmedDemandKey: row.confirmed_demand_key,
    confirmedOrderNo: row.confirmed_order_no,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    deletedBy: row.deleted_by,
    deletedAt: row.deleted_at,
    deleteReason: row.delete_reason,
    active: Boolean(row.active),
    stale: Boolean(row.stale)
  };
}

function manualProgressAllocationParams(batchId, allocation, now) {
  return [
    allocation.id || randomUUID(), batchId, allocation.sourceRowId, allocation.sourceRowNo,
    allocation.orderNo, allocation.materialCode, allocation.demandKey, allocation.matchStatus,
    allocation.matchReason, allocation.isClosed ? 1 : 0, numberValue(allocation.orderQty),
    numberValue(allocation.inboundQty), numberValue(allocation.remainingQty),
    numberValue(allocation.allocatedUnpreparedQty), numberValue(allocation.allocatedPreparedQty),
    numberValue(allocation.allocatedInProductionQty), numberValue(allocation.allocatedFinishedQty), now, now
  ];
}

function replaceManualProgressAllocations(rows, batchId, now) {
  run('DELETE FROM manual_progress_allocations WHERE batch_id = ?', [batchId]);
  const allocations = rows.flatMap((row) => (row.allocations || []).map((allocation) => ({
    ...allocation,
    batchId,
    sourceRowId: row.id,
    sourceRowNo: row.sourceRowNo
  })));
  if (!allocations.length) return;
  runMany(
    `INSERT INTO manual_progress_allocations (
       id, batch_id, source_row_id, source_row_no, order_no, material_code, demand_key,
       match_status, match_reason, is_closed, order_qty, inbound_qty, remaining_qty,
       allocated_unprepared_qty, allocated_prepared_qty, allocated_in_production_qty,
       allocated_finished_qty, active, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    allocations.map((allocation) => manualProgressAllocationParams(batchId, allocation, now))
  );
}

function uniqueManualField(rows, key) {
  const values = [...new Set(rows.map((row) => normalize(row[key])).filter(Boolean))];
  return values.length === 1 ? values[0] : null;
}

function joinedManualField(rows, key) {
  return [...new Set(rows.map((row) => normalize(row[key])).filter(Boolean))].sort().join('、');
}

function manualProgressValuesChanged(existing, values) {
  if (!existing) return true;
  const numericFields = [
    ['unprepared_qty', 'unprepared'],
    ['prepared_not_started_qty', 'prepared'],
    ['in_production_qty', 'inProduction'],
    ['finished_qty', 'finished'],
    ['shipped_qty', 'shipped']
  ];
  if (numericFields.some(([stored, next]) => Math.abs(numberValue(existing[stored]) - numberValue(values[next])) > 0.000001)) {
    return true;
  }
  return [
    ['production_delivery_date', 'productionDeliveryDate'],
    ['unproduced_estimated_delivery_date', 'unproducedEstimatedDeliveryDate'],
    ['fulfillment_status', 'fulfillmentStatus'],
    ['unfulfilled_reason', 'unfulfilledReason'],
    ['reason_detail', 'reasonDetail'],
    ['remark', 'remark']
  ].some(([stored, next]) => normalize(existing[stored]) !== normalize(values[next]));
}

function manualProgressWriteParams(demandKeyValue, values, userName, now) {
  return [
    demandKeyValue, values.unprepared, values.prepared, values.inProduction, values.finished, values.shipped,
    values.productionDeliveryDate, values.unproducedEstimatedDeliveryDate, values.fulfillmentStatus,
    values.unfulfilledReason, values.reasonDetail, values.remark, userName, now
  ];
}

function latestAppliedManualProgressBatch() {
  return get(
    `SELECT * FROM manual_progress_import_batches
     WHERE status = 'applied'
     ORDER BY applied_at DESC, imported_at DESC, rowid DESC
     LIMIT 1`
  );
}

function rollupManualProgress(userName, now, demandKeys = null, batchId = '') {
  if (!batchId) return;
  const rawActiveRows = all(
    `SELECT r.*, a.source_row_id AS allocation_source_row_id,
            a.order_no AS allocation_order_no, a.remaining_qty AS allocation_remaining_qty,
            a.demand_key AS allocation_demand_key,
            a.allocated_unprepared_qty, a.allocated_prepared_qty,
            a.allocated_in_production_qty, a.allocated_finished_qty
     FROM manual_progress_allocations a
     JOIN manual_progress_rows r ON r.id = a.source_row_id
     WHERE a.batch_id = ? AND r.batch_id = ?
       AND a.active = 1 AND r.active = 1 AND r.stale = 0 AND r.deleted_at = ''
       AND r.validation_status = 'valid' AND a.demand_key <> '' AND a.is_closed = 0`,
    [batchId, batchId]
  ).map((row) => ({
    ...manualProgressDbModel(row),
    demandKey: row.allocation_demand_key,
    allocationUnpreparedQty: numberValue(row.allocated_unprepared_qty),
    allocationPreparedQty: numberValue(row.allocated_prepared_qty),
    allocationInProductionQty: numberValue(row.allocated_in_production_qty),
    allocationFinishedQty: numberValue(row.allocated_finished_qty),
    allocationRemainingQty: numberValue(row.allocation_remaining_qty),
    allocationOrderNo: row.allocation_order_no,
    allocationSourceRowId: row.allocation_source_row_id
  }));
  const rowsBySource = new Map();
  rawActiveRows.forEach((row) => {
    const rows = rowsBySource.get(row.allocationSourceRowId) || [];
    rows.push(row);
    rowsBySource.set(row.allocationSourceRowId, rows);
  });
  rowsBySource.forEach((rows) => {
    const shipped = allocateIntegerByWeights(rows[0].sourceShippedQty, rows.map((row) => ({
      orderNo: row.allocationOrderNo,
      weight: row.allocationRemainingQty
    })));
    rows.forEach((row, index) => { row.allocationShippedQty = shipped[index]; });
  });
  const activeRows = rawActiveRows;
  const grouped = new Map();
  activeRows.forEach((row) => {
    if (demandKeys && !demandKeys.has(row.demandKey)) return;
    const list = grouped.get(row.demandKey) || [];
    list.push(row);
    grouped.set(row.demandKey, list);
  });
  const demandMap = new Map(all('SELECT * FROM order_demands WHERE active = 1').map((row) => [row.demand_key, row]));
  const progressMap = new Map(all('SELECT * FROM supplier_progress').map((row) => [row.demand_key, row]));
  const progressWrites = [];
  const snapshotWrites = [];
  grouped.forEach((rows, demandKeyValue) => {
    const demand = demandMap.get(demandKeyValue);
    if (!demand) return;
    const existing = progressMap.get(demandKeyValue);
    const allocatedUnprepared = rows.reduce((sum, row) => sum + row.allocationUnpreparedQty, 0);
    const prepared = rows.reduce((sum, row) => sum + row.allocationPreparedQty, 0);
    const inProduction = rows.reduce((sum, row) => sum + row.allocationInProductionQty, 0);
    const finished = rows.reduce((sum, row) => sum + row.allocationFinishedQty, 0);
    const unprepared = allocatedUnprepared;
    const field = (key, fallback) => {
      const value = uniqueManualField(rows, key);
      return value === null ? fallback : value;
    };
    const values = {
      unprepared,
      prepared,
      inProduction,
      finished,
      shipped: rows.reduce((sum, row) => sum + numberValue(row.allocationShippedQty), 0),
      productionDeliveryDate: field('productionDeliveryDate', existing?.production_delivery_date || ''),
      unproducedEstimatedDeliveryDate: field('unproducedEstimatedDeliveryDate', existing?.unproduced_estimated_delivery_date || ''),
      fulfillmentStatus: field('fulfillmentStatus', existing?.fulfillment_status || ''),
      unfulfilledReason: field('unfulfilledReason', existing?.unfulfilled_reason || ''),
      reasonDetail: field('reasonDetail', existing?.reason_detail || ''),
      remark: field('remark', existing?.remark || '')
    };
    if (!manualProgressValuesChanged(existing, values)) return;
    const writeParams = manualProgressWriteParams(demandKeyValue, values, userName, now);
    progressWrites.push(writeParams);
    snapshotWrites.push([randomUUID(), ...writeParams]);
  });
  if (!demandKeys) {
    const currentManualKeys = new Set(grouped.keys());
    const staleDemandKeys = all(
      `SELECT DISTINCT demand_key
       FROM manual_progress_allocations
       WHERE batch_id <> ? AND demand_key <> ''`,
      [batchId]
    ).map((row) => row.demand_key).filter((key) => !currentManualKeys.has(key));
    staleDemandKeys.forEach((demandKeyValue) => {
      const demand = demandMap.get(demandKeyValue);
      if (!demand) return;
      const remaining = Math.max(numberValue(demand.tracking_remaining_qty), 0);
      const values = {
        unprepared: remaining,
        prepared: 0,
        inProduction: 0,
        finished: 0,
        shipped: numberValue(demand.tracking_inbound_qty),
        productionDeliveryDate: '',
        unproducedEstimatedDeliveryDate: '',
        fulfillmentStatus: '',
        unfulfilledReason: '',
        reasonDetail: '',
        remark: ''
      };
      if (manualProgressValuesChanged(progressMap.get(demandKeyValue), values)) {
        progressWrites.push(manualProgressWriteParams(demandKeyValue, values, userName, now));
      }
    });
  }
  runMany(
    `INSERT INTO supplier_progress (
       demand_key, unprepared_qty, prepared_not_started_qty, in_production_qty, finished_qty, shipped_qty,
       production_delivery_date, unproduced_estimated_delivery_date, fulfillment_status,
       unfulfilled_reason, reason_detail, remark, updated_by, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(demand_key) DO UPDATE SET
       unprepared_qty = excluded.unprepared_qty,
       prepared_not_started_qty = excluded.prepared_not_started_qty,
       in_production_qty = excluded.in_production_qty,
       finished_qty = excluded.finished_qty,
       shipped_qty = excluded.shipped_qty,
       production_delivery_date = excluded.production_delivery_date,
       unproduced_estimated_delivery_date = excluded.unproduced_estimated_delivery_date,
       fulfillment_status = excluded.fulfillment_status,
       unfulfilled_reason = excluded.unfulfilled_reason,
       reason_detail = excluded.reason_detail,
       remark = excluded.remark,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
    progressWrites
  );
  runMany(
    `INSERT INTO supplier_progress_snapshots (
       id, demand_key, unprepared_qty, prepared_not_started_qty, in_production_qty, finished_qty, shipped_qty,
       production_delivery_date, unproduced_estimated_delivery_date, fulfillment_status,
       unfulfilled_reason, reason_detail, remark, updated_by, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    snapshotWrites
  );
}

function reconcileActiveManualProgress(userName, now = nowText(), requestedBatchId = '') {
  const startedAt = Date.now();
  const batchId = normalize(requestedBatchId) || normalize(latestAppliedManualProgressBatch()?.id);
  if (!batchId) return { checked: 0, matched: 0, allocations: 0 };
  const dbRows = all(
    `SELECT * FROM manual_progress_rows
     WHERE batch_id = ? AND active = 1 AND stale = 0 AND deleted_at = '' AND row_type <> 'company_contract'`,
    [batchId]
  );
  const models = dbRows.map(manualProgressDbModel);
  matchManualProgressRows(models);
  const matchedAt = Date.now();
  const matched = models.filter((row) => (row.allocations || []).length).length;
  runMany(
    `UPDATE manual_progress_rows
     SET demand_key = ?, data_status = ?, validation_status = ?, validation_message = ?, candidate_json = ?, updated_by = ?, updated_at = ?
     WHERE id = ?`,
    models.map((row) => [
      row.demandKey || '', row.dataStatus, row.validationStatus, row.validationMessage,
      JSON.stringify(row.candidates || []), userName, now, row.id
    ])
  );
  const rowsUpdatedAt = Date.now();
  replaceManualProgressAllocations(models, batchId, now);
  run(
    `UPDATE manual_progress_allocations SET active = 1, updated_at = ?
     WHERE batch_id = ? AND source_row_id IN (
       SELECT id FROM manual_progress_rows
       WHERE batch_id = ? AND active = 1 AND stale = 0 AND deleted_at = '' AND validation_status = 'valid'
     )`,
    [now, batchId, batchId]
  );
  const allocationsUpdatedAt = Date.now();
  rollupManualProgress(userName, now, null, batchId);
  const finishedAt = Date.now();
  const result = {
    checked: models.length,
    matched,
    allocations: models.reduce((sum, row) => sum + (row.allocations || []).length, 0),
    timings: {
      matchMs: matchedAt - startedAt,
      rowWriteMs: rowsUpdatedAt - matchedAt,
      allocationWriteMs: allocationsUpdatedAt - rowsUpdatedAt,
      rollupMs: finishedAt - allocationsUpdatedAt,
      totalMs: finishedAt - startedAt
    }
  };
  console.info(`[Manual progress reconcile stages] ${JSON.stringify(result.timings)}`);
  return result;
}

function manualProgressSourcePayload(row) {
  return {
    id: row.id,
    sourceRowNo: row.sourceRowNo,
    dataStatus: row.dataStatus,
    orderNo: row.orderNo,
    oaFlowNo: row.oaFlowNo,
    businessUnit: row.businessUnit,
    supplierShortName: row.supplierShortName,
    purchaseOwner: row.purchaseOwner,
    materialCode: row.materialCode,
    sku: row.sku,
    materialName: row.materialName,
    manualRemainingQty: row.manualRemainingQty,
    unpreparedQty: row.unpreparedQty,
    preparedNotStartedQty: row.preparedNotStartedQty,
    inProductionQty: row.inProductionQty,
    finishedQty: row.finishedQty,
    sourceShippedQty: row.sourceShippedQty,
    sourceNormalQty: row.sourceNormalQty,
    sourceNormalAmount: row.sourceNormalAmount,
    sourceAbnormalQty: row.sourceAbnormalQty,
    sourceAbnormalAmount: row.sourceAbnormalAmount,
    sourceContractDeliveryDate: row.sourceContractDeliveryDate,
    productionDeliveryDate: row.productionDeliveryDate,
    unproducedEstimatedDeliveryDate: row.unproducedEstimatedDeliveryDate,
    fulfillmentStatus: row.fulfillmentStatus,
    unfulfilledReason: row.unfulfilledReason,
    reasonDetail: row.reasonDetail,
    remark: row.remark,
    validationStatus: row.validationStatus,
    validationMessage: row.validationMessage,
    conflictFields: row.conflictFields,
    candidates: row.candidates,
    confirmedDemandKey: row.confirmedDemandKey,
    confirmedOrderNo: row.confirmedOrderNo,
    confirmedBy: row.confirmedBy,
    confirmedAt: row.confirmedAt,
    deletedBy: row.deletedBy,
    deletedAt: row.deletedAt,
    deleteReason: row.deleteReason,
    allocations: row.allocations || [],
    original: row.raw
  };
}

function systemOrderDetails(demandKeyValue, orderNo, materialCode) {
  const demand = get('SELECT source_batch_id FROM order_demands WHERE demand_key = ?', [demandKeyValue]);
  if (!orderNo || !materialCode) return null;
  const selectFields = `k.demand_key, k.quantity, k.inbound_qty, k.remaining_inbound_qty, k.close_status,
    k.supplier, k.creator, k.purchase_org, k.document_status, k.business_close,
    COALESCE(b.file_name, '') AS source_file`;
  const matchesOrderMaterial = (row) => (
    normalizeMatchPart(row.order_no) === normalizeMatchPart(orderNo)
    && normalizeMatchPart(row.material_code) === normalizeMatchPart(materialCode)
  );
  let rows = demand?.source_batch_id
    ? all(
      `SELECT ${selectFields}, k.order_no, k.material_code
       FROM kingdee_orders k
       LEFT JOIN kingdee_import_batches b ON b.id = k.batch_id
       WHERE k.batch_id = ? AND k.demand_key = ?`,
      [demand.source_batch_id, demandKeyValue]
    ).filter(matchesOrderMaterial)
    : [];
  if (!rows.length) {
    rows = all(
      `SELECT ${selectFields}, k.order_no, k.material_code
       FROM kingdee_orders k
       JOIN order_demands d
         ON d.demand_key = k.demand_key AND d.source_batch_id = k.batch_id AND d.active = 1
       LEFT JOIN kingdee_import_batches b ON b.id = k.batch_id
       WHERE k.order_no = ? OR k.material_code = ?`,
      [orderNo, materialCode]
    ).filter(matchesOrderMaterial);
  }
  if (!rows.length) return null;
  const quantityRows = rows.filter((row) => !normalize(row.close_status) || normalize(row.close_status) === TRACKING_CLOSE_STATUS);
  const quantities = quantityRows.reduce((result, row) => ({
    orderQty: result.orderQty + numberValue(row.quantity),
    inboundQty: result.inboundQty + numberValue(row.inbound_qty),
    remainingQty: result.remainingQty + numberValue(row.remaining_inbound_qty)
  }), { orderQty: 0, inboundQty: 0, remainingQty: 0 });
  return {
    ...quantities,
    hasQuantityRows: quantityRows.length > 0,
    demandKey: uniqueDelimitedValues(rows.map((row) => row.demand_key)),
    suppliers: [...new Set(rows.map((row) => normalize(row.supplier)).filter(Boolean))],
    supplier: uniqueDelimitedValues(rows.map((row) => row.supplier)),
    orderCreator: uniqueDelimitedValues(rows.map((row) => row.creator)),
    purchaseOrg: uniqueDelimitedValues(rows.map((row) => row.purchase_org)),
    documentStatus: uniqueDelimitedValues(rows.map((row) => row.document_status)),
    closeStatus: uniqueDelimitedValues(rows.map((row) => row.close_status)),
    businessClose: uniqueDelimitedValues(rows.map((row) => row.business_close)),
    sourceFile: uniqueDelimitedValues(rows.map((row) => row.source_file)),
    effectiveOrderCondition: rows.some(isEffectivePurchaseOrder) ? '有效订单' : '非有效订单'
  };
}

function firstMatchedSupplierShortName(...values) {
  for (const value of values) {
    const names = manualProgressSupplierParts(value)
      .filter((name) => name !== UNMATCHED_SUPPLIER_SHORT_NAME);
    if (names.length) return [...new Set(names)].join('&');
  }
  return UNMATCHED_SUPPLIER_SHORT_NAME;
}

function systemOrderQuantities(demandKeyValue, orderNo, materialCode) {
  const details = systemOrderDetails(demandKeyValue, orderNo, materialCode);
  return details?.hasQuantityRows ? details : null;
}

function distributedManualProgressAllocations(row) {
  const allocations = row.allocations || [];
  const weighted = allocations.map((allocation) => ({
    ...allocation,
    weight: allocation.isClosed ? 0 : allocation.remainingQty
  }));
  const shipped = allocateIntegerByWeights(row.sourceShippedQty, weighted);
  const normalQty = allocateIntegerByWeights(row.sourceNormalQty, weighted);
  const abnormalQty = allocateIntegerByWeights(row.sourceAbnormalQty, weighted);
  const normalAmount = allocateNumberByWeights(row.sourceNormalAmount, weighted);
  const abnormalAmount = allocateNumberByWeights(row.sourceAbnormalAmount, weighted);
  return weighted.map((allocation, index) => ({
    ...allocation,
    sourceShippedQty: shipped[index],
    sourceNormalQty: normalQty[index],
    sourceNormalAmount: normalAmount[index],
    sourceAbnormalQty: abnormalQty[index],
    sourceAbnormalAmount: abnormalAmount[index],
    matchCandidate: (row.candidates || []).find((candidate) => (
      candidate.demandKey === allocation.demandKey && candidate.orderNo === allocation.orderNo
    )) || null
  }));
}

function manualProgressDisplayRows(systemRows, user = null, followupMap = new Map()) {
  const manualBatch = latestAppliedManualProgressBatch();
  const batchId = normalize(manualBatch?.id);
  const manualSourceFile = normalize(manualBatch?.file_name);
  if (!batchId) return systemRows.map((row) => ({ ...row, dataStatus: '采购订单数据', manualSourceRows: [] }));
  const sourceRows = all(
    `SELECT * FROM manual_progress_rows
     WHERE batch_id = ? AND active = 1 AND stale = 0 AND deleted_at = ''
     ORDER BY group_key, source_row_no`,
    [batchId]
  ).map(manualProgressDbModel);
  const allocationMap = new Map();
  if (sourceRows.length) {
    all(
      `SELECT * FROM manual_progress_allocations
       WHERE source_row_id IN (${sourceRows.map(() => '?').join(',')})
       ORDER BY source_row_no, order_no`,
      sourceRows.map((row) => row.id)
    ).forEach((allocation) => {
      const list = allocationMap.get(allocation.source_row_id) || [];
      list.push({
        orderNo: allocation.order_no,
        demandKey: allocation.demand_key,
        status: allocation.match_status,
        reason: allocation.match_reason,
        isClosed: Boolean(allocation.is_closed),
        orderQty: numberValue(allocation.order_qty),
        inboundQty: numberValue(allocation.inbound_qty),
        remainingQty: numberValue(allocation.remaining_qty),
        unpreparedQty: numberValue(allocation.allocated_unprepared_qty),
        preparedNotStartedQty: numberValue(allocation.allocated_prepared_qty),
        inProductionQty: numberValue(allocation.allocated_in_production_qty),
        finishedQty: numberValue(allocation.allocated_finished_qty)
      });
      allocationMap.set(allocation.source_row_id, list);
    });
    sourceRows.forEach((row) => { row.allocations = allocationMap.get(row.id) || []; });
  }
  if (!sourceRows.length) return systemRows.map((row) => ({ ...row, dataStatus: '采购订单数据', manualSourceRows: [] }));
  const displaySourceRows = sourceRows.flatMap((row) => {
    if (!row.allocations.length) return [row];
    return distributedManualProgressAllocations(row).map((allocation) => ({
      ...row,
      groupKey: `allocation|${allocation.orderNo}|${row.materialCode}|${allocation.demandKey}`,
      demandKey: allocation.demandKey,
      orderNo: allocation.orderNo,
      manualRemainingQty: allocation.unpreparedQty + allocation.preparedNotStartedQty
        + allocation.inProductionQty,
      unpreparedQty: allocation.unpreparedQty,
      preparedNotStartedQty: allocation.preparedNotStartedQty,
      inProductionQty: allocation.inProductionQty,
      finishedQty: allocation.finishedQty,
      sourceShippedQty: allocation.sourceShippedQty,
      sourceNormalQty: allocation.sourceNormalQty,
      sourceNormalAmount: allocation.sourceNormalAmount,
      sourceAbnormalQty: allocation.sourceAbnormalQty,
      sourceAbnormalAmount: allocation.sourceAbnormalAmount,
      matchCandidate: allocation.matchCandidate,
      allocations: [allocation]
    }));
  });
  const systemMap = new Map(systemRows.map((row) => [
    kingdeeOrderIdentity(row.underlyingDemandKey || row.demandKey, row.orderNo),
    row
  ]));
  const systemByDemand = new Map(systemRows.map((row) => [row.underlyingDemandKey || row.demandKey, row]));
  // 当前采购订单表中存在的订单一律以金蝶为准；剩余为0的金蝶订单也不能回退成手工行。
  const currentKingdeeOrders = all(
    `SELECT k.demand_key, k.order_no
     FROM kingdee_orders k
     JOIN order_demands d
       ON d.source_batch_id = k.batch_id AND d.demand_key = k.demand_key AND d.active = 1`
  );
  const currentKingdeeOrderKeys = new Set(currentKingdeeOrders.map((row) => kingdeeOrderIdentity(row.demand_key, row.order_no)));
  const currentKingdeeOrderNos = new Set(currentKingdeeOrders.map((row) => normalize(row.order_no)).filter(Boolean));
  const groups = new Map();
  displaySourceRows.forEach((row) => {
    const key = `${row.batchId}|${row.groupKey}`;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  });
  const visibleSystemRows = systemRows.map((row) => ({
    ...row,
    dataSource: row.dataSource || '金蝶系统',
    dataStatus: '采购订单数据',
    manualSourceRows: []
  }));
  const lookups = dimensionLookups();
  const manualRows = [...groups.values()].map((rows) => {
    const first = rows[0];
    const initialSystem = first.demandKey
      ? (first.orderNo
        ? systemMap.get(kingdeeOrderIdentity(first.demandKey, first.orderNo))
        : systemByDemand.get(first.demandKey))
      : null;
    const orderDetails = systemOrderDetails(first.demandKey, first.orderNo, first.materialCode);
    const system = initialSystem || (orderDetails?.demandKey
      ? systemMap.get(kingdeeOrderIdentity(orderDetails.demandKey, first.orderNo))
      : null);
    // 以金蝶数据为准：金蝶有的订单号，手工行一律跳过
    if (system || (first.orderNo && (
      currentKingdeeOrderKeys.has(kingdeeOrderIdentity(first.demandKey, first.orderNo))
      || currentKingdeeOrderNos.has(first.orderNo)
    ))) return null;
    const orderQty = orderDetails?.hasQuantityRows ? orderDetails : null;
    const candidate = first.matchCandidate || first.candidates?.find((item) => (
      item.demandKey === first.demandKey && (!first.orderNo || item.orderNo === first.orderNo)
    )) || null;
    // 金蝶无对应数据时，以手工表自有数据为准
    const remainingInboundQty = rows.reduce((sum, r) => sum + numberValue(r.manualRemainingQty), 0);
    const shippedQty = rows.reduce((sum, r) => sum + numberValue(r.sourceShippedQty), 0);
    const unpreparedQty = rows.reduce((sum, r) => sum + numberValue(r.unpreparedQty), 0);
    const preparedNotStartedQty = rows.reduce((sum, r) => sum + numberValue(r.preparedNotStartedQty), 0);
    const inProductionQty = rows.reduce((sum, r) => sum + numberValue(r.inProductionQty), 0);
    const finishedQty = rows.reduce((sum, r) => sum + numberValue(r.finishedQty), 0);
    const progressTotal = unpreparedQty + preparedNotStartedQty + inProductionQty + finishedQty;
    const finishedExceedsRemaining = finishedQty - remainingInboundQty > 0.000001;
    const conflictFields = [...new Set(rows.flatMap((row) => row.conflictFields || []))];
    const field = (key, fallback = '') => {
      const value = uniqueManualField(rows, key);
      return value === null ? fallback : value;
    };
    const currentSupplier = orderDetails?.supplier || candidate?.supplier || system?.supplier || '';
    const orderMatchedSupplierShortName = [...new Set(
      (orderDetails?.suppliers || (currentSupplier ? [currentSupplier] : []))
        .flatMap((supplier) => manualProgressSupplierParts(orderSupplierShortName(lookups, supplier, first.materialCode)))
        .filter((name) => name !== UNMATCHED_SUPPLIER_SHORT_NAME)
    )].join('&');
    const currentSupplierShortName = firstMatchedSupplierShortName(
      orderMatchedSupplierShortName,
      first.supplierShortName,
      candidate?.supplierShortName,
      system?.orderSupplierShortName,
      system?.supplierShortName
    );
    const currentPurchaseOwner = purchaseOwnersForSupplierShortNames(
      lookups,
      manualProgressSupplierParts(currentSupplierShortName),
      first.materialCode
    );
    const enriched = enrichDemandFields(currentSupplier, first.materialCode, orderDetails?.orderCreator || '', lookups);
    const fulfillmentStatus = field('fulfillmentStatus');
    const pretaxPrice = numberValue(enriched.pretaxPrice);
    const normalFulfillmentQty = rows.reduce((sum, row) => sum + row.sourceNormalQty, 0);
    const abnormalFulfillmentQty = rows.reduce((sum, row) => sum + row.sourceAbnormalQty, 0);
    const normalFulfillmentAmount = rows.reduce((sum, row) => sum + row.sourceNormalAmount, 0);
    const abnormalFulfillmentAmount = rows.reduce((sum, row) => sum + row.sourceAbnormalAmount, 0);
    const validationMessages = [...new Set(rows.map((row) => row.validationMessage).filter(Boolean))];
    const trackingKey = `manual:${first.id}:${encodeURIComponent(first.orderNo || first.groupKey)}`;
    return {
      ...(system || {}),
      ...progressFollowupPayload(followupMap, trackingKey),
      followupKey: trackingKey,
      demandKey: trackingKey,
      underlyingDemandKey: first.demandKey || '',
      manualGroupId: first.id,
      manualBatchId: first.batchId,
      displayKey: first.orderNo || first.oaFlowNo || `手工-${first.sourceRowNo}`,
      month: system?.month || first.month,
      businessUnit: candidate?.businessUnit || system?.businessUnit || first.businessUnit,
      operatorName: system?.operatorName || first.operatorName,
      supplier: currentSupplier,
      supplierShortName: currentSupplierShortName,
      orderSupplierShortName: currentSupplierShortName,
      supplierCount: system?.supplierCount || 0,
      materialCode: first.materialCode,
      sku: enriched.sku || '',
      materialName: enriched.materialName || '',
      productLine: enriched.productLine || '',
      productSeries: enriched.productSeries || '',
      purchaseGroup: '',
      purchaseOwner: realPurchaseOwner(currentPurchaseOwner)
        || realPurchaseOwner(candidate?.purchaseOwner)
        || realPurchaseOwner(system?.purchaseOwner)
        || UNASSIGNED_PURCHASE_OWNER,
      purchaseOrg: orderDetails?.purchaseOrg || candidate?.purchaseOrg || system?.purchaseOrg || '',
      orderNo: first.orderNo,
      sourceFile: orderDetails?.sourceFile || manualSourceFile,
      effectiveOrderCondition: orderDetails?.effectiveOrderCondition || '非有效订单',
      businessClose: orderDetails?.businessClose || '',
      closeStatus: orderDetails?.closeStatus || candidate?.closeStatus || system?.closeStatus || '',
      documentStatus: orderDetails?.documentStatus || candidate?.documentStatus || system?.documentStatus || '',
      contractDeliveryDates: joinedManualField(rows, 'sourceContractDeliveryDate'),
      oaFlowNo: first.oaFlowNo || system?.oaFlowNo || '',
      orderCreator: orderDetails?.orderCreator || candidate?.orderCreator || system?.orderCreator || '',
      orderType: orderTypeForSupplier(currentSupplier, NORMAL_ORDER_TYPE, currentSupplierShortName),
      orderRemark: '',
      reportingMonth: system?.reportingMonth || system?.month || first.month,
      reportingPurchaseQty: orderQty?.orderQty ?? numberValue(system?.currentOrderQty),
      currentOrderDate: system?.currentOrderDate || system?.orderDates || '',
      currentPurchaseQty: orderQty?.orderQty ?? numberValue(system?.currentOrderQty),
      originalOrderNo: '',
      originalOrderDate: '',
      originalOrderMonth: '',
      originalPurchaseQty: 0,
      originalManualClose: '',
      changeValidationStatus: 'normal',
      changeValidationMessage: '手工录入记录按正常订单统计',
      currentOrderQty: orderQty?.orderQty ?? numberValue(system?.currentOrderQty),
      totalPurchaseQty: orderQty?.orderQty ?? numberValue(system?.totalPurchaseQty),
      totalInboundQty: shippedQty,
      trackingOrderQty: orderQty?.orderQty ?? numberValue(system?.trackingOrderQty),
      trackingInboundQty: shippedQty,
      remainingInboundQty,
      operationStockQty: remainingInboundQty + shippedQty,
      active: true,
      unpreparedQty,
      preparedNotStartedQty,
      inProductionQty,
      finishedQty,
      shippedQty,
      progressTotal,
      gap: productionStageGap(remainingInboundQty, unpreparedQty, preparedNotStartedQty, inProductionQty, finishedQty),
      progressAdjustmentRequired: productionStageNeedsAdjustment(remainingInboundQty, unpreparedQty, preparedNotStartedQty, inProductionQty, finishedQty) || finishedExceedsRemaining,
      productionDeliveryDate: field('productionDeliveryDate'),
      unproducedEstimatedDeliveryDate: field('unproducedEstimatedDeliveryDate'),
      fulfillmentStatus,
      pretaxPrice,
      pretaxPriceMaintained: Boolean(enriched.pretaxPriceMaintained),
      normalFulfillmentQty,
      abnormalFulfillmentQty,
      normalFulfillmentAmount,
      abnormalFulfillmentAmount,
      unfulfilledReason: field('unfulfilledReason'),
      reasonDetail: field('reasonDetail'),
      remark: field('remark'),
      progressUpdatedBy: first.raw?.updatedBy || '',
      progressUpdatedAt: '',
      dataSource: '手工录入',
      dataStatus: first.stale ? '本次手工表未出现' : first.dataStatus,
      validationStatus: rows.some((row) => row.validationStatus === 'error')
        ? 'error'
        : conflictFields.length
          ? 'conflict'
          : rows.some((row) => row.validationStatus === 'pending')
            ? 'pending'
            : 'valid',
      validationMessage: [...validationMessages, ...(conflictFields.length ? [`明细冲突：${conflictFields.join('、')}`] : [])].join('；'),
      conflictFields,
      manualSourceRows: rows.map(manualProgressSourcePayload),
      operationOrderLevel: true,
      operationOrderRows: [],
      adminOnly: first.stale || !first.orderNo || !system,
      canEdit: !first.stale && !first.deletedAt && (user?.role === ROLE_ADMIN || Boolean(system?.canEdit))
    };
  }).filter(Boolean);
  return [...visibleSystemRows, ...manualRows];
}

function operationOrderBreakdown(baseRow, sourceRows, orderChangeIndex) {
  const details = groupCurrentKingdeeOrderRows(sourceRows).map(({ orderNo, rows, remainingInboundQty }) => {
    const effectiveOrder = rows.some(isEffectivePurchaseOrder);
    const orderChange = classifyOrderChange({
      currentRows: rows,
      batchId: rows[0]?.batch_id,
      supplier: baseRow.supplier,
      supplierShortName: baseRow.orderSupplierShortName,
      materialCode: baseRow.materialCode,
      fallbackMonth: baseRow.month,
      index: orderChangeIndex
    });
    return {
      orderNo,
      ...orderChange,
      sourceFile: uniqueDelimitedValues(rows.map((row) => row.sourceFile || row.source_file)),
      effectiveOrderCondition: effectiveOrder ? '有效订单' : '非有效订单',
      businessClose: uniqueDelimitedValues(rows.map((row) => row.businessClose || row.business_close)),
      closeStatus: uniqueCloseStatuses(rows),
      documentStatus: uniqueDocumentStatuses(rows),
      operatorName: uniqueOperatorNames(rows),
      orderCreator: uniqueCreators(rows),
      oaFlowNo: orderedOaFlowNos(rows, rawOaFlowNo),
      orderDates: uniqueOrderDates(rows),
      contractDeliveryDates: uniqueDeliveryDates(rows),
      currentOrderQty: rows.reduce((sum, row) => sum + numberValue(row.quantity), 0),
      totalPurchaseQty: rows.reduce((sum, row) => sum + numberValue(row.quantity), 0),
      totalInboundQty: rows.reduce((sum, row) => sum + numberValue(row.inboundQty ?? row.inbound_qty), 0),
      trackingOrderQty: rows.reduce((sum, row) => sum + numberValue(row.quantity), 0),
      trackingInboundQty: rows.reduce((sum, row) => sum + numberValue(row.inboundQty ?? row.inbound_qty), 0),
      remainingInboundQty
    };
  }).sort((left, right) => left.orderNo.localeCompare(right.orderNo, 'zh-Hans-CN'));
  const weighted = details.map((detail) => ({ ...detail, weight: Math.abs(detail.remainingInboundQty) }));
  const unprepared = allocateIntegerByWeights(baseRow.unpreparedQty, weighted);
  const preparedNotStarted = allocateIntegerByWeights(baseRow.preparedNotStartedQty, weighted);
  const inProduction = allocateIntegerByWeights(baseRow.inProductionQty, weighted);
  const finished = allocateIntegerByWeights(baseRow.finishedQty, weighted);
  const stock = allocateIntegerByWeights(baseRow.stockQty, weighted);
  const normalFulfillment = allocateIntegerByWeights(baseRow.normalFulfillmentQty, weighted);
  const abnormalFulfillment = allocateIntegerByWeights(baseRow.abnormalFulfillmentQty, weighted);
  const normalAmount = allocateNumberByWeights(baseRow.normalFulfillmentAmount, weighted);
  const abnormalAmount = allocateNumberByWeights(baseRow.abnormalFulfillmentAmount, weighted);
  return weighted.map((detail, index) => ({
    ...detail,
    rowKey: kingdeeOrderIdentity(baseRow.demandKey, detail.orderNo),
    underlyingDemandKey: baseRow.demandKey,
    displayKey: detail.orderNo || baseRow.displayKey,
    operationOrderLevel: true,
    operationOrderRows: [],
    dataSource: '金蝶系统',
    unpreparedQty: unprepared[index],
    preparedNotStartedQty: preparedNotStarted[index],
    inProductionQty: inProduction[index],
    finishedQty: finished[index],
    shippedQty: detail.trackingInboundQty,
    operationStockQty: detail.remainingInboundQty + detail.trackingInboundQty,
    progressTotal: unprepared[index] + preparedNotStarted[index] + inProduction[index] + finished[index],
    gap: productionStageGap(detail.remainingInboundQty, unprepared[index], preparedNotStarted[index], inProduction[index], finished[index]),
    progressAdjustmentRequired: productionStageNeedsAdjustment(detail.remainingInboundQty, unprepared[index], preparedNotStarted[index], inProduction[index], finished[index])
      || finished[index] - detail.remainingInboundQty > 0.000001,
    stockQty: stock[index],
    demandAfterStock: Math.max(detail.remainingInboundQty - stock[index], 0),
    shortageAfterStock: Math.max(detail.remainingInboundQty - stock[index], 0)
      - unprepared[index] - preparedNotStarted[index] - inProduction[index] - finished[index],
    normalFulfillmentQty: normalFulfillment[index],
    abnormalFulfillmentQty: abnormalFulfillment[index],
    normalFulfillmentAmount: normalAmount[index],
    abnormalFulfillmentAmount: abnormalAmount[index]
  }));
}

function demandRows(includeInactive = false, user = null, options = {}) {
  const where = includeInactive ? '' : 'WHERE active = 1';
  const demands = all(`SELECT * FROM order_demands ${where} ORDER BY month DESC, business_unit, supplier, material_code`);
  const context = demandLoadContext(demands, { includeInventory: options.includeInventory !== false });
  const rows = demands.map((demand) => {
    const progress = context.progressMap.get(demand.demand_key) || defaultProgress(demand.demand_key);
    const stock = context.inventoryMap.get(stockKey(demand.business_unit, demand.supplier, demand.material_code)) || { stock_qty: 0 };
    const batchDemandKey = demandBatchKey(demand.source_batch_id, demand.demand_key);
    const orderRows = context.orderRowsByDemand.get(batchDemandKey) || [];
    const allOrderRows = context.allOrderRowsByDemand.get(batchDemandKey) || orderRows;
    const orderCreator = uniqueCreators(allOrderRows);
    const operatorName = uniqueOperatorNames(allOrderRows);
    const orderNo = uniqueOrderNos(allOrderRows);
    const closeStatus = uniqueCloseStatuses(allOrderRows);
    const documentStatus = uniqueDocumentStatuses(allOrderRows);
    const orderDates = uniqueOrderDates(allOrderRows);
    const contractDeliveryDates = uniqueDeliveryDates(allOrderRows);
    const oaFlowNo = demand.oa_flow_no || orderedOaFlowNos(allOrderRows, rawOaFlowNo);
    const enriched = enrichDemandFields(demand.supplier, demand.material_code, orderCreator, context.lookups);
    const matchedSupplierShortName = orderSupplierShortName(context.lookups, demand.supplier, demand.material_code);
    const purchaseOwner = realPurchaseOwner(enriched.purchaseOwner) || UNASSIGNED_PURCHASE_OWNER;
    const purchaseGroup = enriched.purchaseGroup || '';
    const shippedQty = allOrderRows.reduce((sum, orderRow) => sum + numberValue(orderRow.inbound_qty), 0);
    const remainingInboundQty = allOrderRows.reduce((sum, orderRow) => sum + numberValue(orderRow.remaining_inbound_qty), 0);
    const unpreparedQty = numberValue(progress.unprepared_qty);
    const preparedNotStartedQty = numberValue(progress.prepared_not_started_qty);
    const inProductionQty = numberValue(progress.in_production_qty);
    const finishedQty = numberValue(progress.finished_qty);
    const progressTotal = unpreparedQty + preparedNotStartedQty + inProductionQty + finishedQty;
    const progressGap = productionStageGap(remainingInboundQty, unpreparedQty, preparedNotStartedQty, inProductionQty, finishedQty);
    const finishedExceedsRemaining = finishedQty - remainingInboundQty > 0.000001;
    const fulfillmentStatus = ['是', '否'].includes(normalize(progress.fulfillment_status)) ? normalize(progress.fulfillment_status) : '';
    const pretaxPrice = numberValue(enriched.pretaxPrice);
    const normalFulfillmentQty = fulfillmentStatus === '是' ? remainingInboundQty : 0;
    const abnormalFulfillmentQty = fulfillmentStatus === '否' ? remainingInboundQty : 0;
    const stockQty = numberValue(stock.stock_qty);
    const demandAfterStock = Math.max(remainingInboundQty - stockQty, 0);
    const row = {
      demandKey: demand.demand_key,
      displayKey: displayDemandKey(demand),
      month: demand.month,
      businessUnit: demand.business_unit,
      operatorName,
      supplier: demand.supplier,
      supplierShortName: enriched.supplierShortName || '',
      orderSupplierShortName: matchedSupplierShortName,
      supplierCount: assignmentSupplierCount(context.lookups, demand.material_code),
      materialCode: demand.material_code,
      currentOrderQty: numberValue(demand.current_order_qty),
      totalPurchaseQty: numberValue(demand.current_order_qty),
      totalInboundQty: numberValue(demand.current_inbound_qty),
      trackingOrderQty: numberValue(demand.tracking_order_qty),
      trackingInboundQty: numberValue(demand.tracking_inbound_qty),
      remainingInboundQty,
      operationStockQty: remainingInboundQty + shippedQty,
      active: Boolean(demand.active),
      sku: demand.sku || enriched.sku || '',
      logisticsCode: demand.logistics_code || enriched.logisticsCode || '',
      materialName: enriched.materialName || demand.material_name || '',
      productLine: demand.product_line || enriched.productLine || '',
      productSeries: demand.product_series || enriched.productSeries || '',
      purchaseGroup,
      purchaseOwner,
      purchaseOrg: demand.purchase_org || '',
      orderNo,
      closeStatus,
      documentStatus,
      orderDates,
      contractDeliveryDates,
      oaFlowNo,
      orderCreator,
      orderType: orderTypeForSupplier(demand.supplier, NORMAL_ORDER_TYPE, matchedSupplierShortName),
      orderRemark: '',
      reportingMonth: demand.month,
      reportingPurchaseQty: numberValue(demand.current_order_qty),
      currentOrderDate: orderDates,
      currentPurchaseQty: numberValue(demand.current_order_qty),
      originalOrderNo: '',
      originalOrderDate: '',
      originalOrderMonth: '',
      originalPurchaseQty: 0,
      originalManualClose: '',
      changeValidationStatus: 'normal',
      changeValidationMessage: '备注未引用原采购订单，按正常订单统计',
      stockQty,
      demandAfterStock,
      unpreparedQty,
      preparedNotStartedQty,
      inProductionQty,
      finishedQty,
      shippedQty,
      progressTotal,
      gap: progressGap,
      progressAdjustmentRequired: productionStageNeedsAdjustment(remainingInboundQty, unpreparedQty, preparedNotStartedQty, inProductionQty, finishedQty) || finishedExceedsRemaining,
      shortageAfterStock: demandAfterStock - progressTotal,
      productionDeliveryDate: progress.production_delivery_date || '',
      unproducedEstimatedDeliveryDate: progress.unproduced_estimated_delivery_date || '',
      fulfillmentStatus,
      pretaxPrice,
      pretaxPriceMaintained: Boolean(enriched.pretaxPriceMaintained),
      normalFulfillmentQty,
      abnormalFulfillmentQty,
      normalFulfillmentAmount: normalFulfillmentQty * pretaxPrice,
      abnormalFulfillmentAmount: abnormalFulfillmentQty * pretaxPrice,
      unfulfilledReason: progress.unfulfilled_reason || '',
      reasonDetail: progress.reason_detail || '',
      remark: progress.remark || '',
      progressUpdatedBy: progress.updated_by || '',
      progressUpdatedAt: progress.updated_at || '',
      canEdit: user ? canEditDemand(user, { ...demand, purchase_owner: purchaseOwner, order_creator: orderCreator }) : false
    };
    if (includeInactive) return row;
    if (!allOrderRows.length) return {
      ...row,
      rowKey: row.demandKey,
      followupKey: progressFollowupTrackingKey(row.demandKey),
      operationOrderLevel: false,
      operationOrderRows: [],
      dataSource: '手工录入',
      ...progressFollowupPayload(context.followupMap, progressFollowupTrackingKey(row.demandKey))
    };
    return operationOrderBreakdown(row, allOrderRows, context.orderChangeIndex).map((orderRow) => {
      const followupKey = progressFollowupTrackingKey(row.demandKey, orderRow.orderNo, row.materialCode);
      return {
        ...row,
        ...orderRow,
        followupKey,
        ...progressFollowupPayload(context.followupMap, followupKey)
      };
    });
  }).flat();
  const displayRows = includeInactive
    ? rows
    : options.currentKingdeeOnly
      ? rows
        .filter((row) => row.operationOrderLevel)
        .map((row) => ({
          ...row,
          dataSource: '金蝶系统',
          dataStatus: '采购订单数据',
          manualSourceRows: []
        }))
      : manualProgressDisplayRows(rows, user, context.followupMap);
  return displayRows;
}

function uniqueOrderNos(rows) {
  return uniqueDelimitedValues(rows.map((row) => row.orderNo || row.order_no));
}

function uniqueDocumentStatuses(rows) {
  return uniqueDelimitedValues([...rows].sort(compareOaRows).map((row) => row.documentStatus || row.document_status));
}

function uniqueCloseStatuses(rows) {
  return uniqueDelimitedValues([...rows].sort(compareOaRows).map((row) => row.closeStatus || row.close_status));
}

function rawOrderDate(row) {
  const raw = parseJson(row.raw_json, row.raw || {});
  return normalize(row.purchaseDate || row.purchase_date || row.createDate || row.create_date)
    || pickAny(raw, ['采购日期', '创建日期', '下单日期', '订单日期', '日期', 'createDate', 'purchaseDate', 'orderDate', 'date']);
}

function uniqueOrderDates(rows) {
  return uniqueDelimitedValues([...rows].sort(compareOaRows).map(rawOrderDate));
}

function contractDateOnly(value) {
  const text = normalize(value);
  if (!text) return '';
  const matched = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (matched) {
    const p = (part) => String(part).padStart(2, '0');
    return `${matched[1]}-${p(matched[2])}-${p(matched[3])}`;
  }
  return dateOnly(text);
}

function uniqueDeliveryDates(rows) {
  return [...new Set(rows.map((row) => contractDateOnly(row.deliveryDate || row.delivery_date)).filter(Boolean))]
    .sort((left, right) => dateSortValue(left) - dateSortValue(right) || left.localeCompare(right, 'zh-Hans-CN'))
    .join('、');
}

function oldOrderNosForDemand(demandKeyValue) {
  const demand = get('SELECT source_batch_id FROM order_demands WHERE demand_key = ?', [demandKeyValue]);
  if (!demand?.source_batch_id) return '';
  return uniqueOrderNos(all('SELECT order_no FROM kingdee_orders WHERE batch_id = ? AND demand_key = ?', [demand.source_batch_id, demandKeyValue]));
}

function oldOrderDatesForDemand(demandKeyValue) {
  const demand = get('SELECT source_batch_id FROM order_demands WHERE demand_key = ?', [demandKeyValue]);
  if (!demand?.source_batch_id) return '';
  const rows = all('SELECT order_no, raw_json FROM kingdee_orders WHERE batch_id = ? AND demand_key = ?', [demand.source_batch_id, demandKeyValue])
    .map(orderRowDateSort);
  return uniqueOrderDates(rows);
}

function rawOaFlowNo(row) {
  const raw = parseJson(row.raw_json, {});
  return normalize(row.oaFlowNo || row.oa_flow_no)
    || pickAny(raw, ['OA备货流程号', 'OA流程号', '备货流程号', 'OA申请号', 'OA申请流程号', 'OA流程编号']);
}

function orderRowDateSort(row, index = 0) {
  const raw = parseJson(row.raw_json, {});
  return {
    ...row,
    dateSort: rawDateSortValue(raw),
    sourceIndex: index
  };
}

function oldOaFlowNosForDemand(demandKeyValue) {
  const demand = get('SELECT source_batch_id FROM order_demands WHERE demand_key = ?', [demandKeyValue]);
  if (!demand?.source_batch_id) return '';
  const rows = all('SELECT id, oa_flow_no, raw_json FROM kingdee_orders WHERE batch_id = ? AND demand_key = ?', [demand.source_batch_id, demandKeyValue])
    .map(orderRowDateSort);
  return orderedOaFlowNos(rows, rawOaFlowNo);
}

function uniqueCreators(rows) {
  return uniqueDelimitedValues(rows.map((row) => row.creator));
}

function normalizeOperatorName(value) {
  return normalize(normalize(value).replace(/[0-9０-９]{1,2}月柜[0-9０-９]*.*$/u, ''));
}

function uniqueOperatorNames(rows) {
  return uniqueDelimitedValues(rows.map((row) => normalizeOperatorName(row.operatorName || row.operator_name)));
}

function oldCreatorsForDemand(demandKeyValue) {
  const demand = get('SELECT source_batch_id FROM order_demands WHERE demand_key = ?', [demandKeyValue]);
  if (!demand?.source_batch_id) return '';
  return uniqueCreators(all('SELECT creator FROM kingdee_orders WHERE batch_id = ? AND demand_key = ?', [demand.source_batch_id, demandKeyValue]));
}

function currentAppliedAt() {
  const batch = get(
    `SELECT b.applied_at, b.imported_at
     FROM order_demands d
     JOIN kingdee_import_batches b ON b.id = d.source_batch_id
     WHERE d.active = 1
     ORDER BY COALESCE(NULLIF(b.applied_at, ''), b.imported_at) DESC
     LIMIT 1`
  );
  return normalize(batch?.applied_at) || normalize(batch?.imported_at);
}

function purchaseOrderLineKey(row) {
  const orderNo = normalize(row.orderNo || row.order_no);
  const materialCode = normalize(row.materialCode || row.material_code);
  return `${orderNo}|${materialCode}`;
}

function summarizePurchaseOrderLines(rows) {
  const map = new Map();
  [...rows].sort(compareOaRows).forEach((row) => {
    const orderNo = normalize(row.orderNo || row.order_no);
    const materialCode = normalize(row.materialCode || row.material_code);
    if (!orderNo || !materialCode) return;
    const key = purchaseOrderLineKey(row);
    const current = map.get(key) || {
      key,
      orderNo,
      materialCode,
      demandKey: normalize(row.demandKey || row.demand_key),
      month: normalize(row.month),
      businessUnit: normalize(row.businessUnit || row.business_unit),
      supplier: normalize(row.supplier),
      purchaseOrg: normalize(row.purchaseOrg || row.purchase_org),
      creator: '',
      orderDate: '',
      materialName: normalize(row.materialName || row.material_name),
      quantity: 0,
      inboundQty: 0
    };
    current.quantity += numberValue(row.quantity);
    current.inboundQty += numberValue(row.inboundQty ?? row.inbound_qty);
    current.creator = appendUniqueDelimited(current.creator, row.creator);
    current.orderDate = appendUniqueDelimited(current.orderDate, rawOrderDate(row));
    current.materialName ||= normalize(row.materialName || row.material_name);
    map.set(key, current);
  });
  return map;
}

function compareRowsFromSummary(summary, sourceRows, user, options = {}) {
  const currentRows = options.currentRows || demandRows(false, user);
  const currentMap = new Map(currentRows.map((row) => [row.demandKey, row]));
  const nextRows = options.nextRows || summary;
  const nextMap = new Map(nextRows.map((row) => [row.demandKey, row]));
  const lookups = dimensionLookups();
  const inventoryMap = new Map(all('SELECT * FROM inventory').map((row) => [row.stock_key, row]));
  const currentSourceMap = new Map(
    all('SELECT demand_key, source_batch_id FROM order_demands WHERE active = 1')
      .map((row) => [row.demand_key, row.source_batch_id])
  );
  const currentBatchIds = [...new Set([...currentSourceMap.values()].map(normalize).filter(Boolean))];
  const hasOldSourceOverride = Array.isArray(options.oldSourceRows);
  const oldOrderRows = hasOldSourceOverride ? options.oldSourceRows : [];
  if (!hasOldSourceOverride && currentBatchIds.length) {
    const placeholders = currentBatchIds.map(() => '?').join(',');
    all(
      `SELECT batch_id, demand_key, month, business_unit, supplier, material_code, purchase_org,
              creator, order_no, quantity, inbound_qty, purchase_date, material_name, raw_json
       FROM kingdee_orders
       WHERE batch_id IN (${placeholders})`,
      currentBatchIds
    ).forEach((row, index) => {
      if (normalize(currentSourceMap.get(row.demand_key)) !== normalize(row.batch_id)) return;
      oldOrderRows.push(orderRowDateSort(row, index));
    });
  }
  const oldLines = summarizePurchaseOrderLines(oldOrderRows);
  const newLines = summarizePurchaseOrderLines(sourceRows);
  const keys = [...new Set([...oldLines.keys(), ...newLines.keys()])];
  return keys.map((key) => {
    const oldLine = oldLines.get(key);
    const newLine = newLines.get(key);
    const oldQty = numberValue(oldLine?.quantity);
    const newQty = numberValue(newLine?.quantity);
    const oldInboundQty = numberValue(oldLine?.inboundQty);
    const newInboundQty = numberValue(newLine?.inboundQty);
    const deltaQty = newQty - oldQty;
    const inboundDeltaQty = newInboundQty - oldInboundQty;
    const purchaseQtyChanged = Math.abs(deltaQty) >= 0.000001;
    const inboundQtyChanged = Math.abs(inboundDeltaQty) >= 0.000001;
    if (!purchaseQtyChanged && !inboundQtyChanged) return null;

    const current = currentMap.get(oldLine?.demandKey || newLine?.demandKey);
    const next = nextMap.get(newLine?.demandKey || oldLine?.demandKey);
    const metadata = newLine || oldLine;
    const month = newLine?.month || oldLine?.month || next?.month || current?.month || '';
    const businessUnit = newLine?.businessUnit || oldLine?.businessUnit || next?.businessUnit || current?.businessUnit || '';
    const supplier = newLine?.supplier || oldLine?.supplier || next?.supplier || current?.supplier || '';
    const materialCode = metadata?.materialCode || next?.materialCode || current?.materialCode || '';
    const purchaseOrg = newLine?.purchaseOrg || oldLine?.purchaseOrg || next?.purchaseOrg || current?.purchaseOrg || '';
    const demandKeyValue = newLine?.demandKey || oldLine?.demandKey || demandKey(purchaseOrg, month, businessUnit, supplier, materialCode);
    const orderCreator = newLine?.creator || oldLine?.creator || current?.orderCreator || '';
    const enriched = enrichDemandFields(supplier, materialCode, orderCreator, lookups);
    const progressInput = current ? {
      demand_key: current.demandKey,
      unprepared_qty: current.unpreparedQty,
      prepared_not_started_qty: current.preparedNotStartedQty,
      in_production_qty: current.inProductionQty,
      finished_qty: current.finishedQty,
      shipped_qty: current.shippedQty
    } : null;
    const projectedProgress = next
      ? progressAfterInbound(next.trackingRemainingQty, progressInput, next.trackingInboundQty, { preserveExistingProgress: Boolean(current) })
      : progressAfterInbound(0, progressInput, 0, { preserveExistingProgress: Boolean(current) });
    const stock = current
      ? { stock_qty: current.stockQty }
      : inventoryMap.get(stockKey(businessUnit, supplier, materialCode)) || { stock_qty: 0 };
    const handlingType = !purchaseQtyChanged
      ? 'auto_inbound'
      : oldQty === 0 && newQty > 0
        ? 'auto_new'
        : oldQty > 0 && newQty === 0 && Math.abs(oldQty - oldInboundQty) < 0.000001
          ? 'auto_closed'
          : 'pending';
    const displayBase = { purchaseOrg, month, businessUnit, supplier };
    return {
      demandKey: demandKeyValue,
      displayKey: displayDemandKey(displayBase),
      month,
      businessUnit,
      supplier,
      supplierShortName: enriched.supplierShortName || '',
      materialCode,
      sku: current?.sku || enriched.sku || '',
      logisticsCode: current?.logisticsCode || enriched.logisticsCode || '',
      materialName: newLine?.materialName || oldLine?.materialName || next?.materialName || current?.materialName || enriched.materialName || '',
      productLine: current?.productLine || enriched.productLine || '',
      productSeries: current?.productSeries || enriched.productSeries || '',
      purchaseGroup: current?.purchaseGroup || enriched.purchaseGroup || '',
      purchaseOwner: current?.purchaseOwner || enriched.purchaseOwner || UNASSIGNED_PURCHASE_OWNER,
      purchaseOrg,
      orderCreator,
      orderNo: newLine?.orderNo || oldLine?.orderNo || '',
      oldQty,
      newQty,
      oldInboundQty,
      newInboundQty,
      inboundDeltaQty,
      deltaQty,
      diffQty: Math.abs(deltaQty),
      diffType: !purchaseQtyChanged ? '累计入库变化' : !oldLine ? '新增' : !newLine ? '消失' : deltaQty > 0 ? '数量增加' : '数量减少',
      oldOrderNos: oldLine?.orderNo || '',
      newOrderNos: newLine?.orderNo || '',
      oldOrderDates: oldLine?.orderDate || '',
      newOrderDates: newLine?.orderDate || '',
      inboundQty: newInboundQty,
      handlingType,
      automaticAction: handlingType === 'auto_new' ? '新增订单' : handlingType === 'auto_closed' ? '正常业务关闭' : handlingType === 'auto_inbound' ? '累计入库变化' : '',
      automaticReason: handlingType === 'auto_new' ? '新增订单' : handlingType === 'auto_closed' ? '正常业务关闭' : handlingType === 'auto_inbound' ? '累计入库变化' : '',
      stockQty: numberValue(stock?.stock_qty),
      unpreparedQty: numberValue(projectedProgress.unprepared),
      preparedNotStartedQty: numberValue(projectedProgress.preparedNotStarted),
      inProductionQty: numberValue(projectedProgress.inProduction),
      finishedQty: numberValue(projectedProgress.finished),
      shippedQty: numberValue(projectedProgress.shipped),
      progressTotal: numberValue(projectedProgress.unprepared) + numberValue(projectedProgress.preparedNotStarted)
        + numberValue(projectedProgress.inProduction) + numberValue(projectedProgress.finished),
      newSnapshot: next || null
    };
  }).filter(Boolean).sort((a, b) => (
    b.month.localeCompare(a.month)
    || (a.newOrderNos || a.oldOrderNos).localeCompare(b.newOrderNos || b.oldOrderNos, 'zh-Hans-CN')
    || a.materialCode.localeCompare(b.materialCode, 'zh-Hans-CN')
  ));
}

function writeDifferenceRows(sessionId, rows, now, automaticCreatedBy = '系统自动') {
  rows.forEach((row) => {
    if (normalize(row.oldOrderNos).includes('+') || normalize(row.newOrderNos).includes('+')) {
      throw new Error(`采购订单差异必须按单一订单号保存：${row.oldOrderNos || '空'} -> ${row.newOrderNos || '空'}`);
    }
    row.id ||= randomUUID();
    row.sessionId = sessionId;
  });
  runMany(
    `INSERT INTO difference_compare_rows (
       id, session_id, demand_key, month, business_unit, supplier, supplier_short_name, material_code,
       purchase_org, order_creator, old_qty, new_qty, delta_qty, diff_type,
       old_order_nos, new_order_nos, old_order_dates, new_order_dates,
       old_inbound_qty, inbound_qty, handling_type, progress_total, stock_qty, new_snapshot_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    rows.map((row) => [
      row.id, sessionId, row.demandKey, row.month, row.businessUnit, row.supplier, row.supplierShortName,
      row.materialCode, row.purchaseOrg, row.orderCreator || '', row.oldQty, row.newQty, row.deltaQty,
      row.diffType, row.oldOrderNos, row.newOrderNos, row.oldOrderDates, row.newOrderDates,
      row.oldInboundQty, row.newInboundQty, row.handlingType, row.progressTotal, row.stockQty,
      JSON.stringify(row.newSnapshot), now
    ])
  );
  runMany(
    `INSERT INTO difference_allocations (
       id, session_id, row_id, demand_key, action_type, allocated_qty, reason, remark,
       old_order_nos, new_order_nos, old_qty, new_qty, delta_qty, progress_total, stock_qty,
       automatic, created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    rows.filter((row) => row.handlingType !== 'pending').map((row) => [
      randomUUID(), sessionId, row.id, row.demandKey, row.automaticAction, Math.abs(row.deltaQty),
      row.automaticReason, row.oldOrderNos, row.newOrderNos, row.oldQty, row.newQty,
      row.deltaQty, row.progressTotal, row.stockQty, automaticCreatedBy, now
    ])
  );
}

function persistDifferenceCompare({
  file,
  sheetName,
  mapping,
  parsed,
  result,
  summary,
  user,
  transactionManaged = false,
  storeSnapshotPayload = true
}) {
  const rows = compareRowsFromSummary(summary, result.rows, user);
  const sessionId = randomUUID();
  const now = nowText();
  const oldAppliedAt = currentAppliedAt();
  const writeRecords = () => {
    run(
      `INSERT INTO difference_compare_sessions (id, file_name, sheet_name, mapping_json, summary_json, source_rows_json, total_rows, valid_rows, skipped_rows, status, old_applied_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        sessionId,
        safeFilename(file),
        sheetName,
        JSON.stringify(mapping),
        storeSnapshotPayload ? JSON.stringify(summary) : '[]',
        storeSnapshotPayload ? JSON.stringify(result.rows) : '[]',
        parsed.rowCount ?? parsed.rows.length,
        result.validRows,
        result.skippedRows,
        oldAppliedAt,
        user.name,
        now
      ]
    );
    writeDifferenceRows(sessionId, rows, now);
  };
  if (transactionManaged) writeRecords();
  else transaction(writeRecords);
  return { sessionId, rows };
}

function allocationRows(sessionId = '') {
  const params = sessionId ? [sessionId] : [];
  const where = sessionId ? 'WHERE a.session_id = ?' : '';
  const demandMap = new Map(all('SELECT * FROM order_demands').map((row) => [row.demand_key, row]));
  const lookups = dimensionLookups();
  return all(
    `SELECT a.*, r.month, r.business_unit, r.supplier, r.supplier_short_name, r.material_code, r.purchase_org,
            r.order_creator, r.old_inbound_qty, r.inbound_qty, r.handling_type, r.old_order_dates, r.new_order_dates
     FROM difference_allocations a
     LEFT JOIN difference_compare_rows r ON r.id = a.row_id
     ${where}
     ORDER BY a.created_at DESC LIMIT 500`,
    params
  ).map((row) => {
    const materialCode = row.material_code || normalize(row.demand_key).split('|')[4] || '';
    const demand = demandMap.get(row.demand_key);
    const enriched = enrichDemandFields(row.supplier, materialCode, row.order_creator || '', lookups);
    return {
      id: row.id,
      sessionId: row.session_id,
      rowId: row.row_id,
      demandKey: row.demand_key,
      displayKey: row.month ? displayKeyForCompareRow(row) : displayKeyFromDemandKey(row.demand_key),
      month: row.month || demand?.month || '',
      businessUnit: row.business_unit || demand?.business_unit || '',
      supplier: row.supplier || demand?.supplier || '',
      supplierShortName: enriched.supplierShortName || '',
      materialCode,
      oaFlowNo: demand?.oa_flow_no || normalize(row.demand_key).split('|')[5] || '',
      sku: demand?.sku || enriched.sku || '',
      logisticsCode: demand?.logistics_code || enriched.logisticsCode || '',
      materialName: demand?.material_name || enriched.materialName || '',
      productLine: demand?.product_line || enriched.productLine || '',
      productSeries: demand?.product_series || enriched.productSeries || '',
      purchaseOwner: realPurchaseOwner(enriched.purchaseOwner) || UNASSIGNED_PURCHASE_OWNER,
      orderCreator: normalize(row.order_creator || demand?.order_creator),
      actionType: row.action_type,
      allocatedQty: numberValue(row.allocated_qty),
      reason: row.reason,
      remark: row.remark || '',
      oldOrderNos: row.old_order_nos || '',
      newOrderNos: row.new_order_nos || '',
      oldOrderDates: row.old_order_dates || '',
      newOrderDates: row.new_order_dates || '',
      oldQty: numberValue(row.old_qty),
      newQty: numberValue(row.new_qty),
      inboundQty: numberValue(row.inbound_qty),
      oldInboundQty: numberValue(row.old_inbound_qty),
      inboundDeltaQty: numberValue(row.inbound_qty) - numberValue(row.old_inbound_qty),
      deltaQty: numberValue(row.delta_qty),
      progressTotal: numberValue(row.progress_total),
      stockQty: numberValue(row.stock_qty),
      handlingType: row.handling_type || 'pending',
      automatic: Boolean(row.automatic),
      createdBy: row.created_by,
      createdAt: row.created_at
    };
  });
}

function backfillCompareRowsFromSnapshot(session) {
  if (!session?.applied_batch_id) return;
  const existingCount = numberValue(get('SELECT COUNT(*) AS count FROM difference_compare_rows WHERE session_id = ?', [session.id])?.count);
  if (existingCount > 0) return;
  const diffs = all('SELECT * FROM demand_snapshot_diffs WHERE batch_id = ? ORDER BY created_at', [session.applied_batch_id]);
  if (diffs.length === 0) return;
  transaction(() => {
    diffs.forEach((diff) => {
      const demand = get('SELECT * FROM order_demands WHERE demand_key = ?', [diff.demand_key]);
      const parts = normalize(diff.demand_key).split('|');
      const purchaseOrg = demand?.purchase_org || parts[0] || '';
      const month = demand?.month || parts[1] || '';
      const businessUnit = demand?.business_unit || parts[2] || '';
      const supplier = demand?.supplier || parts[3] || '';
      const materialCode = demand?.material_code || parts[4] || '';
      const newOrderRows = all('SELECT order_no, creator, raw_json FROM kingdee_orders WHERE batch_id = ? AND demand_key = ?', [session.applied_batch_id, diff.demand_key]).map(orderRowDateSort);
      const progress = progressForDemand(diff.demand_key);
      const stock = demand ? inventoryForDemand(demand) : { stock_qty: 0 };
      run(
        `INSERT INTO difference_compare_rows (id, session_id, demand_key, month, business_unit, supplier, supplier_short_name, material_code, purchase_org, order_creator, old_qty, new_qty, delta_qty, diff_type, old_order_nos, new_order_nos, old_order_dates, new_order_dates, progress_total, stock_qty, new_snapshot_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(), session.id, diff.demand_key, month, businessUnit, supplier, demand?.supplier_short_name || '', materialCode, purchaseOrg,
          uniqueCreators(newOrderRows) || oldCreatorsForDemand(diff.demand_key),
          numberValue(diff.old_qty), numberValue(diff.new_qty), numberValue(diff.new_qty) - numberValue(diff.old_qty), diff.diff_type,
          oldOrderNosForDemand(diff.demand_key), uniqueOrderNos(newOrderRows), oldOrderDatesForDemand(diff.demand_key), uniqueOrderDates(newOrderRows),
          numberValue(progress.unprepared_qty) + numberValue(progress.prepared_not_started_qty)
            + numberValue(progress.in_production_qty) + numberValue(progress.finished_qty),
          numberValue(stock.stock_qty), '{}', session.created_at || diff.created_at
        ]
      );
    });
  });
}

function compareRowsForSession(sessionId, user) {
  const demandMap = new Map(all('SELECT * FROM order_demands').map((row) => [row.demand_key, row]));
  const progressMap = new Map(all('SELECT * FROM supplier_progress').map((row) => [row.demand_key, row]));
  const lookups = dimensionLookups();
  return all(
    `SELECT r.*
     FROM difference_compare_rows r
     WHERE r.session_id = ?
       AND r.handling_type = 'pending'
       AND NOT EXISTS (
         SELECT 1 FROM difference_allocations a
         WHERE a.session_id = r.session_id AND a.row_id = r.id
       )
     ORDER BY r.month DESC, r.business_unit, r.supplier, r.material_code`,
    [sessionId]
  ).map((row) => {
    const demand = demandMap.get(row.demand_key);
    const progress = progressMap.get(row.demand_key) || {};
    const orderCreator = row.order_creator || demand?.order_creator || '';
    const enriched = enrichDemandFields(row.supplier, row.material_code, orderCreator, lookups);
    const purchaseOwner = realPurchaseOwner(enriched.purchaseOwner) || UNASSIGNED_PURCHASE_OWNER;
    const permissionDemand = demand
      ? { ...demand, order_creator: orderCreator, purchase_owner: purchaseOwner }
      : { purchase_owner: purchaseOwner, order_creator: orderCreator, supplier: row.supplier, material_code: row.material_code };
    if (!canEditDemand(user, permissionDemand)) return null;
    return {
      id: row.id,
      sessionId: row.session_id,
      demandKey: row.demand_key,
      displayKey: displayKeyForCompareRow(row),
      month: row.month,
      businessUnit: row.business_unit,
      supplier: row.supplier,
      supplierShortName: enriched.supplierShortName || '',
      materialCode: row.material_code,
      oaFlowNo: demand?.oa_flow_no || '',
      sku: demand?.sku || enriched.sku || '',
      logisticsCode: demand?.logistics_code || enriched.logisticsCode || '',
      materialName: demand?.material_name || enriched.materialName || '',
      productLine: demand?.product_line || enriched.productLine || '',
      productSeries: demand?.product_series || enriched.productSeries || '',
      purchaseOwner,
      purchaseOrg: row.purchase_org,
      orderCreator,
      oldQty: numberValue(row.old_qty),
      newQty: numberValue(row.new_qty),
      deltaQty: numberValue(row.delta_qty),
      diffQty: Math.abs(numberValue(row.delta_qty)),
      availableActions: actionsForDelta(row.delta_qty),
      diffType: row.diff_type,
      oldOrderNos: row.old_order_nos || '',
      newOrderNos: row.new_order_nos || '',
      oldOrderDates: row.old_order_dates || '',
      newOrderDates: row.new_order_dates || '',
      shippedQty: numberValue(demand?.tracking_inbound_qty),
      inboundQty: numberValue(row.inbound_qty),
      oldInboundQty: numberValue(row.old_inbound_qty),
      inboundDeltaQty: numberValue(row.inbound_qty) - numberValue(row.old_inbound_qty),
      handlingType: row.handling_type || 'pending',
      unpreparedQty: numberValue(progress.unprepared_qty),
      preparedNotStartedQty: numberValue(progress.prepared_not_started_qty),
      inProductionQty: numberValue(progress.in_production_qty),
      finishedQty: numberValue(progress.finished_qty),
      progressTotal: numberValue(progress.unprepared_qty) + numberValue(progress.prepared_not_started_qty)
        + numberValue(progress.in_production_qty) + numberValue(progress.finished_qty),
      stockQty: numberValue(row.stock_qty)
    };
  }).filter(Boolean);
}

function unassignedPurchaseOrderRows() {
  const lookups = dimensionLookups();
  const batches = all(
    `SELECT id
     FROM kingdee_import_batches
     WHERE applied_at <> ''
     ORDER BY applied_at DESC, imported_at DESC, rowid DESC
     LIMIT 2`
  );
  const currentBatchId = normalize(batches[0]?.id);
  const previousBatchId = normalize(batches[1]?.id);
  if (!currentBatchId) return [];
  const rowKey = (row) => [row.purchase_org, row.supplier, row.order_no, row.material_code].map(normalize).join('|');
  const previousQuantities = new Map();
  if (previousBatchId) {
    all(
      `SELECT purchase_org, supplier, order_no, material_code, quantity
       FROM kingdee_orders
       WHERE batch_id = ?`,
      [previousBatchId]
    ).forEach((row) => {
      const key = rowKey(row);
      previousQuantities.set(key, numberValue(previousQuantities.get(key)) + numberValue(row.quantity));
    });
  }
  const grouped = new Map();
  all(
    `SELECT k.purchase_org, k.supplier, k.creator, k.purchase_date, k.order_no, k.material_code, k.material_name, k.quantity
     FROM kingdee_orders k
     WHERE k.batch_id = ?
     ORDER BY k.supplier, k.order_no, k.material_code`,
    [currentBatchId]
  ).forEach((row) => {
    const enriched = enrichDemandFields(row.supplier, row.material_code, row.creator, lookups);
    if (realPurchaseOwner(enriched.purchaseOwner)) return;
    const key = rowKey(row);
    const current = grouped.get(key) || {
      purchaseOrg: normalize(row.purchase_org),
      supplier: normalize(row.supplier),
      creator: normalize(row.creator),
      purchaseDate: normalize(row.purchase_date),
      orderNo: normalize(row.order_no),
      materialCode: normalize(row.material_code),
      materialName: normalize(row.material_name) || enriched.materialName || '',
      oldPurchaseQty: numberValue(previousQuantities.get(key)),
      newPurchaseQty: 0
    };
    current.creator = appendUniqueDelimited(current.creator, row.creator);
    current.purchaseDate = appendUniqueDelimited(current.purchaseDate, row.purchase_date);
    current.newPurchaseQty += numberValue(row.quantity);
    grouped.set(key, current);
  });
  return [...grouped.values()].sort((left, right) => (
    left.purchaseOrg.localeCompare(right.purchaseOrg, 'zh-Hans-CN')
    || left.supplier.localeCompare(right.supplier, 'zh-Hans-CN')
    || left.creator.localeCompare(right.creator, 'zh-Hans-CN')
    || left.orderNo.localeCompare(right.orderNo, 'zh-Hans-CN')
    || left.materialCode.localeCompare(right.materialCode, 'zh-Hans-CN')
  ));
}

function storedOrderRows(batchId) {
  if (!batchId) return [];
  return all('SELECT * FROM kingdee_orders WHERE batch_id = ? ORDER BY rowid', [batchId])
    .map((row, index) => orderRowDateSort(row, index));
}

function previousBatchForCompareSession(session) {
  const newBatchId = normalize(session.applied_batch_id);
  const oldAppliedAt = normalize(session.old_applied_at);
  if (!newBatchId) return null;
  if (oldAppliedAt) {
    const exact = get(
      `SELECT * FROM kingdee_import_batches
       WHERE id <> ? AND COALESCE(NULLIF(applied_at, ''), imported_at) = ?
       ORDER BY rowid DESC LIMIT 1`,
      [newBatchId, oldAppliedAt]
    );
    if (exact) return exact;
  }
  return get(
    `SELECT * FROM kingdee_import_batches
     WHERE id <> ?
       AND rowid < COALESCE((SELECT rowid FROM kingdee_import_batches WHERE id = ?), 9223372036854775807)
     ORDER BY rowid DESC LIMIT 1`,
    [newBatchId, newBatchId]
  );
}

function allocationOrderKey(oldOrderNo, newOrderNo, materialCode, deltaQty) {
  return [oldOrderNo, newOrderNo, materialCode, numberValue(deltaQty)].map(normalize).join('|');
}

function copyCompatibleManualAllocations(oldSessionId, newSessionId, rows) {
  const targetRows = new Map(
    rows.filter((row) => row.handlingType === 'pending').map((row) => [
      allocationOrderKey(row.oldOrderNos, row.newOrderNos, row.materialCode, row.deltaQty),
      row
    ])
  );
  const copiedRowIds = new Set();
  const manualRows = all(
    `SELECT a.*, r.material_code
     FROM difference_allocations a
     JOIN difference_compare_rows r ON r.id = a.row_id
     WHERE a.session_id = ? AND a.automatic = 0
     ORDER BY a.created_at`,
    [oldSessionId]
  );
  manualRows.forEach((allocation) => {
    if (normalize(allocation.old_order_nos).includes('+') || normalize(allocation.new_order_nos).includes('+')) return;
    const target = targetRows.get(allocationOrderKey(
      allocation.old_order_nos,
      allocation.new_order_nos,
      allocation.material_code,
      allocation.delta_qty
    ));
    if (!target || copiedRowIds.has(target.id)) return;
    run(
      `INSERT INTO difference_allocations (
         id, session_id, row_id, demand_key, action_type, allocated_qty, reason, remark,
         old_order_nos, new_order_nos, old_qty, new_qty, delta_qty, progress_total, stock_qty,
         automatic, created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        randomUUID(), newSessionId, target.id, target.demandKey, allocation.action_type,
        allocation.allocated_qty, allocation.reason, allocation.remark || '', target.oldOrderNos,
        target.newOrderNos, target.oldQty, target.newQty, target.deltaQty, target.progressTotal,
        target.stockQty, allocation.created_by, allocation.created_at
      ]
    );
    copiedRowIds.add(target.id);
  });
  return copiedRowIds.size;
}

function rebuildLegacyOrderCompareSession(session, user) {
  if (!session?.id || !session.applied_batch_id) return session;
  const combinedCount = numberValue(get(
    `SELECT COUNT(*) AS count
     FROM difference_compare_rows
     WHERE session_id = ? AND (INSTR(old_order_nos, '+') > 0 OR INSTR(new_order_nos, '+') > 0)`,
    [session.id]
  )?.count);
  if (!combinedCount) return session;
  const oldBatch = previousBatchForCompareSession(session);
  if (!oldBatch?.id) {
    throw new Error(`无法找到差异会话 ${session.id} 对应的原采购订单批次`);
  }
  const oldRows = storedOrderRows(oldBatch.id);
  const newRows = storedOrderRows(session.applied_batch_id);
  if (!oldRows.length || !newRows.length) {
    throw new Error(`差异会话 ${session.id} 的原、新采购订单批次明细不完整`);
  }
  const currentRows = demandRows(false, user);
  const rows = compareRowsFromSummary([], newRows, user, {
    oldSourceRows: oldRows,
    currentRows,
    nextRows: currentRows
  });
  const rebuiltSessionId = randomUUID();
  const now = nowText();
  let copiedManualCount = 0;
  transaction(() => {
    run(
      `INSERT INTO difference_compare_sessions (
         id, file_name, sheet_name, mapping_json, summary_json, source_rows_json,
         total_rows, valid_rows, skipped_rows, status, applied_batch_id, applied_at,
         old_applied_at, new_applied_at, created_by, created_at
       ) VALUES (?, ?, ?, ?, '[]', '[]', ?, ?, ?, 'snapshot_applied', ?, ?, ?, ?, ?, ?)`,
      [
        rebuiltSessionId, session.file_name, session.sheet_name || '', session.mapping_json || '{}',
        numberValue(session.total_rows) || newRows.length, numberValue(session.valid_rows) || newRows.length,
        numberValue(session.skipped_rows), session.applied_batch_id, session.applied_at || session.new_applied_at || now,
        session.old_applied_at || oldBatch.applied_at || oldBatch.imported_at || '',
        session.new_applied_at || session.applied_at || now, '系统按采购订单重建', now
      ]
    );
    writeDifferenceRows(rebuiltSessionId, rows, now, '系统自动');
    copiedManualCount = copyCompatibleManualAllocations(session.id, rebuiltSessionId, rows);
    run('UPDATE difference_compare_sessions SET status = ? WHERE id = ?', ['legacy_replaced', session.id]);
  });
  console.info(`[Difference repair] rebuilt ${session.id} as ${rebuiltSessionId}: ${rows.length} rows, ${copiedManualCount} manual allocations retained`);
  return get('SELECT * FROM difference_compare_sessions WHERE id = ?', [rebuiltSessionId]);
}

function latestComparePayload(user) {
  let session = get('SELECT * FROM difference_compare_sessions ORDER BY created_at DESC, rowid DESC LIMIT 1');
  if (!session) {
    return { sessionId: '', diffRows: [], allocations: allocationRows(), status: { total: 0, allocated: 0, complete: false }, actions: DIFF_ALLOCATION_ACTIONS, reasons: DIFF_ALLOCATION_REASONS };
  }
  session = rebuildLegacyOrderCompareSession(session, user) || session;
  backfillCompareRowsFromSnapshot(session);
  return {
    sessionId: session.id,
    fileName: session.file_name,
    totalRows: numberValue(session.total_rows),
    validRows: numberValue(session.valid_rows),
    skippedRows: numberValue(session.skipped_rows),
    createdAt: session.created_at,
    oldAppliedAt: session.old_applied_at || '',
    newAppliedAt: session.new_applied_at || session.applied_at || '',
    status: allocationStatus(session.id),
    diffRows: compareRowsForSession(session.id, user),
    allocations: allocationRows(session.id),
    actions: DIFF_ALLOCATION_ACTIONS,
    reasons: DIFF_ALLOCATION_REASONS
  };
}

function allocationStatus(sessionId) {
  const total = numberValue(get("SELECT COUNT(*) AS count FROM difference_compare_rows WHERE session_id = ? AND handling_type = 'pending'", [sessionId])?.count);
  const allocated = numberValue(get(
    `SELECT COUNT(DISTINCT a.row_id) AS count
     FROM difference_allocations a
     JOIN difference_compare_rows r ON r.id = a.row_id
     WHERE a.session_id = ? AND r.handling_type = 'pending'`,
    [sessionId]
  )?.count);
  return { total, allocated, complete: total === 0 || allocated >= total };
}

function snapshotChangeEvents(summary, sourceRows) {
  const currentRows = all('SELECT * FROM order_demands WHERE active = 1');
  const currentMap = new Map(currentRows.map((row) => [row.demand_key, row]));
  const nextMap = new Map(summary.map((row) => [row.demandKey, row]));
  const batchIds = [...new Set(currentRows.map((row) => normalize(row.source_batch_id)).filter(Boolean))];
  const oldCloseStatusMap = new Map();
  const oldOrderStatusMap = new Map();
  const addOrderStatus = (target, demandKeyValue, orderNo, closeStatus) => {
    const orderKey = normalize(orderNo);
    if (!orderKey) return;
    const demandStatuses = target.get(demandKeyValue) || new Map();
    demandStatuses.set(orderKey, appendUniqueDelimited(demandStatuses.get(orderKey), closeStatus));
    target.set(demandKeyValue, demandStatuses);
  };
  if (batchIds.length) {
    const placeholders = batchIds.map(() => '?').join(',');
    all(`SELECT demand_key, order_no, close_status FROM kingdee_orders WHERE batch_id IN (${placeholders})`, batchIds).forEach((row) => {
      oldCloseStatusMap.set(row.demand_key, appendUniqueDelimited(oldCloseStatusMap.get(row.demand_key), row.close_status));
      addOrderStatus(oldOrderStatusMap, row.demand_key, row.order_no, row.close_status);
    });
  }
  const newOrderStatusMap = new Map();
  sourceRows.forEach((row) => addOrderStatus(newOrderStatusMap, row.demandKey, row.orderNo, row.closeStatus));
  const events = [];
  currentMap.forEach((current, key) => {
    const next = nextMap.get(key);
    if (!next) return;
    const base = {
      demandKey: key,
      month: next.month || current.month,
      businessUnit: next.businessUnit || current.business_unit,
      supplier: next.supplier || current.supplier,
      materialCode: next.materialCode || current.material_code,
      purchaseOrg: next.purchaseOrg || current.purchase_org || ''
    };
    const oldInbound = numberValue(current.current_inbound_qty);
    const newInbound = numberValue(next.currentInboundQty);
    if (Math.abs(oldInbound - newInbound) > 0.000001) {
      events.push({ ...base, eventType: '累计入库变化', oldValue: String(oldInbound), newValue: String(newInbound) });
    }
    const canonicalStatuses = (value) => splitDelimited(value).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')).join('+');
    const oldCloseStatuses = canonicalStatuses(oldCloseStatusMap.get(key));
    const newCloseStatuses = canonicalStatuses(next.closeStatuses);
    const oldOrders = oldOrderStatusMap.get(key) || new Map();
    const newOrders = newOrderStatusMap.get(key) || new Map();
    const changedOrderNos = [...oldOrders.keys()].filter((orderNo) => (
      newOrders.has(orderNo) && canonicalStatuses(oldOrders.get(orderNo)) !== canonicalStatuses(newOrders.get(orderNo))
    ));
    if (oldCloseStatuses && newCloseStatuses && (oldCloseStatuses !== newCloseStatuses || changedOrderNos.length)) {
      const oldValue = changedOrderNos.length
        ? changedOrderNos.map((orderNo) => `${orderNo}:${canonicalStatuses(oldOrders.get(orderNo))}`).join('；')
        : oldCloseStatuses;
      const newValue = changedOrderNos.length
        ? changedOrderNos.map((orderNo) => `${orderNo}:${canonicalStatuses(newOrders.get(orderNo))}`).join('；')
        : newCloseStatuses;
      events.push({ ...base, eventType: '关闭状态变化', oldValue, newValue });
    }
  });
  return events;
}

function compactKingdeeRaw(row) {
  return {
    createDate: row.createDate || '',
    purchaseDate: row.purchaseDate || '',
    deliveryDate: row.deliveryDate || '',
    orderDate: row.purchaseDate || row.createDate || '',
    oaFlowNo: row.oaFlowNo || '',
    orderRemark: row.orderRemark || '',
    manualClose: row.manualClose || ''
  };
}

function applyKingdeeSnapshot({
  fileName,
  sourceRows,
  summary,
  diffs,
  mapping,
  userName,
  now,
  importMode = 'snapshot',
  skippedRows = 0,
  skipped = []
}) {
  const batchId = randomUUID();
  const changeEvents = importMode === 'baseline' ? [] : snapshotChangeEvents(summary, sourceRows);
  run(
    `DELETE FROM kingdee_orders
     WHERE batch_id NOT IN (
       SELECT DISTINCT source_batch_id
       FROM order_demands
       WHERE active = 1 AND COALESCE(source_batch_id, '') <> ''
     )`
  );
  run(
    `INSERT INTO kingdee_import_batches
      (id, file_name, import_mode, imported_by, imported_at, applied_at, row_count, skipped_rows, skipped_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [batchId, fileName, importMode, userName, now, now, sourceRows.length, numberValue(skippedRows), JSON.stringify(skipped.slice(0, 100))]
  );
  runMany(
    `INSERT INTO kingdee_orders (
       id, batch_id, demand_key, month, business_unit, supplier, material_code, purchase_org,
       creator, oa_flow_no, order_no, quantity, inbound_qty, remaining_inbound_qty,
       purchase_date, delivery_date, material_name, operator_name, document_status, close_status,
       is_gift, business_close, order_remark, manual_close, raw_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sourceRows.map((row) => [
      randomUUID(), batchId, row.demandKey, row.month, row.businessUnit, row.supplier, row.materialCode,
      row.purchaseOrg || '', row.creator || '', row.oaFlowNo || '', row.orderNo || '', row.quantity,
      numberValue(row.inboundQty), numberValue(row.remainingInboundQty), row.purchaseDate || row.createDate || '',
      row.deliveryDate || '', row.materialName || '', row.operatorName || '', row.documentStatus || '',
      row.closeStatus || '', row.isGift || '', row.businessClose || '', row.orderRemark || '', row.manualClose || '',
      JSON.stringify(compactKingdeeRaw(row))
    ])
  );
  const progressMap = new Map(all('SELECT * FROM supplier_progress').map((row) => [row.demand_key, row]));
  const demandParams = [];
  const progressParams = [];
  summary.forEach((row) => {
    demandParams.push([
      row.demandKey, row.month, row.businessUnit, row.supplier, row.materialCode,
      row.currentOrderQty, row.currentInboundQty, row.trackingOrderQty, row.trackingInboundQty,
      row.trackingRemainingQty, row.materialName || '', row.purchaseOrg || '', row.oaFlowNo || '', batchId, now
    ]);
    const progress = progressMap.get(row.demandKey);
    const nextProgress = progressAfterInbound(row.trackingRemainingQty, progress, row.trackingInboundQty, {
      preserveExistingProgress: Boolean(progress)
    });
    progressParams.push([
      row.demandKey,
      nextProgress.unprepared,
      nextProgress.preparedNotStarted,
      nextProgress.inProduction,
      nextProgress.finished,
      nextProgress.shipped,
      progress?.production_delivery_date || '',
      progress?.unproduced_estimated_delivery_date || '',
      progress?.fulfillment_status || '',
      progress?.unfulfilled_reason || '',
      progress?.reason_detail || '',
      progress?.remark || '',
      userName,
      now
    ]);
  });
  runMany(
    `INSERT INTO order_demands (
       demand_key, month, business_unit, supplier, material_code,
       current_order_qty, current_inbound_qty, tracking_order_qty, tracking_inbound_qty, tracking_remaining_qty,
       active, material_name, purchase_org, oa_flow_no, source_batch_id, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
     ON CONFLICT(demand_key) DO UPDATE SET
       current_order_qty = excluded.current_order_qty,
       current_inbound_qty = excluded.current_inbound_qty,
       tracking_order_qty = excluded.tracking_order_qty,
       tracking_inbound_qty = excluded.tracking_inbound_qty,
       tracking_remaining_qty = excluded.tracking_remaining_qty,
       material_name = COALESCE(NULLIF(excluded.material_name, ''), order_demands.material_name),
       purchase_org = COALESCE(NULLIF(excluded.purchase_org, ''), order_demands.purchase_org),
       oa_flow_no = excluded.oa_flow_no,
       active = 1,
       source_batch_id = excluded.source_batch_id,
       updated_at = excluded.updated_at`,
    demandParams
  );
  run(
    `UPDATE order_demands
     SET active = 0
     WHERE COALESCE(source_batch_id, '') <> ?`,
    [batchId]
  );
  runMany(
    `INSERT INTO supplier_progress (
       demand_key, unprepared_qty, prepared_not_started_qty, in_production_qty, finished_qty, shipped_qty,
       production_delivery_date, unproduced_estimated_delivery_date, fulfillment_status,
       unfulfilled_reason, reason_detail, remark, updated_by, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(demand_key) DO UPDATE SET
       unprepared_qty = excluded.unprepared_qty,
       prepared_not_started_qty = excluded.prepared_not_started_qty,
       in_production_qty = excluded.in_production_qty,
       finished_qty = excluded.finished_qty,
       shipped_qty = excluded.shipped_qty,
       production_delivery_date = supplier_progress.production_delivery_date,
       unproduced_estimated_delivery_date = supplier_progress.unproduced_estimated_delivery_date,
       fulfillment_status = supplier_progress.fulfillment_status,
       unfulfilled_reason = supplier_progress.unfulfilled_reason,
       reason_detail = supplier_progress.reason_detail,
       remark = supplier_progress.remark,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
    progressParams
  );
  if (importMode !== 'baseline') {
    runMany(
      'INSERT INTO demand_snapshot_diffs (id, batch_id, demand_key, diff_type, old_qty, new_qty, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      diffs.map((diff) => [randomUUID(), batchId, diff.demandKey, diff.diffType, diff.oldQty, diff.newQty, now])
    );
  }
  runMany(
    `INSERT INTO kingdee_order_events (
       id, batch_id, demand_key, month, business_unit, supplier, material_code, purchase_org,
       event_type, old_value, new_value, created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    changeEvents.map((event) => [
      randomUUID(), batchId, event.demandKey, event.month, event.businessUnit, event.supplier,
      event.materialCode, event.purchaseOrg, event.eventType, event.oldValue, event.newValue, userName, now
    ])
  );
  run(
    `INSERT INTO import_mappings (kind, mapping_json, updated_by, updated_at)
     VALUES ('kingdee', ?, ?, ?)
     ON CONFLICT(kind) DO UPDATE SET mapping_json = excluded.mapping_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [JSON.stringify(mapping), userName, now]
  );
  applyDimensionEnrichment();
  reconcileActiveManualProgress(userName, now);
  return batchId;
}

app.get('/api/bootstrap', requireAuth, (req, res) => {
  res.json({ user: userPayload(req.user), pages: PAGE_LABELS, dimensionSlots: DIMENSION_SLOTS, currentAppliedAt: currentAppliedAt() });
});

app.get('/api/inventory-summary', requireAuth, requirePage('inventorySummary'), (req, res) => {
  res.json(inventorySummaryData());
});

app.get('/api/full-inventory-summary', requireAuth, requirePage('fullInventorySummary'), (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(fullInventorySummaryData());
});

const INVENTORY_MANUAL_RECONCILIATION_CATEGORIES = ['全部', '成品+配件', '成品', '配件', '不可售'];

function inventoryManualReconciliationNoteKey(category, businessUnit, materialCode) {
  return JSON.stringify([category, businessUnit, materialCode]);
}

const PROGRESS_CLEAR_FILTER_FIELDS = Object.freeze({
  purchaseOwners: 'purchaseOwner',
  suppliers: 'supplierDisplayName',
  productLines: 'productLine',
  productSeries: 'productSeries'
});

function progressClearFilters(body = {}) {
  return Object.fromEntries(Object.keys(PROGRESS_CLEAR_FILTER_FIELDS).map((key) => [
    key,
    [...new Set((Array.isArray(body[key]) ? body[key] : []).map(normalize).filter(Boolean))].slice(0, 500)
  ]));
}

function progressClearSelection(user, filters) {
  if (!Object.values(filters).some((values) => values.length)) {
    const error = new Error('请至少选择一个采购下单人、供应商、产品线或系列');
    error.status = 400;
    throw error;
  }
  const selected = Object.fromEntries(Object.entries(filters).map(([key, values]) => [key, new Set(values)]));
  return demandRows(false, user)
    .filter((row) => numberValue(row.remainingInboundQty) > 0)
    .filter((row) => {
      const values = {
        purchaseOwner: normalize(row.purchaseOwner),
        supplierDisplayName: normalize(row.orderSupplierShortName) || UNMATCHED_SUPPLIER_SHORT_NAME,
        productLine: normalize(row.productLine),
        productSeries: normalize(row.productSeries)
      };
      return Object.entries(PROGRESS_CLEAR_FILTER_FIELDS).every(([filterKey, rowKey]) => (
        selected[filterKey].size === 0 || selected[filterKey].has(values[rowKey])
      ));
    });
}

function progressClearPreview(user, filters) {
  const rows = progressClearSelection(user, filters);
  const keys = new Set(rows.map((row) => row.demandKey));
  const currentProgressCount = all('SELECT demand_key FROM supplier_progress').filter((row) => keys.has(row.demand_key)).length;
  const snapshotCount = all('SELECT demand_key FROM supplier_progress_snapshots').filter((row) => keys.has(row.demand_key)).length;
  return {
    matchedDemands: rows.length,
    currentProgressCount,
    snapshotCount,
    sampleRows: rows.slice(0, 10).map((row) => ({
      demandKey: row.demandKey,
      purchaseOwner: row.purchaseOwner,
      supplier: normalize(row.orderSupplierShortName) || UNMATCHED_SUPPLIER_SHORT_NAME,
      productLine: row.productLine,
      productSeries: row.productSeries,
      materialCode: row.materialCode
    }))
  };
}

function inventoryManualReconciliationNotes(category) {
  return all(
    `SELECT category, business_unit, material_code, remark, updated_by, updated_at
     FROM inventory_manual_reconciliation_notes
     WHERE category = ?
     ORDER BY business_unit, material_code`,
    [category]
  ).map((row) => ({
    category: row.category,
    businessUnit: row.business_unit,
    materialCode: row.material_code,
    remark: row.remark,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at
  }));
}

app.get('/api/inventory-summary/manual-reconciliation', requireAuth, requirePage('inventorySummary'), (req, res) => {
  const category = normalize(req.query.category);
  if (!INVENTORY_MANUAL_RECONCILIATION_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: '库存分类参数无效' });
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    ...inventorySummaryData({ manualCategory: category }),
    notes: inventoryManualReconciliationNotes(category)
  });
});

app.put('/api/inventory-summary/manual-reconciliation/note', requireAuth, requirePage('inventorySummary'), (req, res) => {
  const category = normalize(req.body?.category);
  const businessUnit = normalize(req.body?.businessUnit);
  const materialCode = normalize(req.body?.materialCode);
  const remark = normalize(req.body?.remark);
  if (!INVENTORY_MANUAL_RECONCILIATION_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: '库存分类参数无效' });
  }
  if (!businessUnit || !materialCode) {
    return res.status(400).json({ error: '事业部和物料编码不能为空' });
  }
  if (remark.length > 500) {
    return res.status(400).json({ error: '备注不能超过500个字符' });
  }
  const updatedAt = nowText();
  const updatedBy = req.user.name;
  run(
    `INSERT INTO inventory_manual_reconciliation_notes
       (note_key, category, business_unit, material_code, remark, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(note_key) DO UPDATE SET
       remark = excluded.remark,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
    [inventoryManualReconciliationNoteKey(category, businessUnit, materialCode), category, businessUnit, materialCode, remark, updatedBy, updatedAt]
  );
  saveDatabase();
  return res.json({
    ok: true,
    note: { category, businessUnit, materialCode, remark, updatedBy, updatedAt }
  });
});

app.get('/api/inventory-risk/params', requireAuth, requirePage('inventoryRisk'), (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json(currentInventoryRiskSettings());
});

app.get('/api/supply-plan/summary', requireAuth, requirePage('supplyPlanBoard'), (_req, res) => {
  try {
    const settings = currentSupplyPlanSettings();
    const payload = buildSupplyPlanSummary({
      inventoryModel: inventorySummaryData(),
      params: settings.params
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ...payload,
      params: settings.params,
      updatedBy: settings.updatedBy,
      updatedAt: settings.updatedAt
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || '供应计划数据生成失败' });
  }
});

app.get('/api/supply-plan/params', requireAuth, requirePage('supplyPlanBoard'), (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json(currentSupplyPlanSettings());
});

app.post('/api/supply-plan/params', requireAuth, requirePage('supplyPlanBoard'), (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    return res.json(saveSupplyPlanSettings(req.body || {}, req.user.name));
  } catch (error) {
    return res.status(400).json({ error: error.message || '供应计划参数无效' });
  }
});

app.post('/api/inventory-risk/query', requireAuth, requirePage('inventoryRisk'), (req, res) => {
  try {
    const payload = inventoryRiskData(req.body, { force: Boolean(req.body?.force) });
    res.setHeader('Cache-Control', 'no-store');
    if (!payload.ok) {
      return res.status(payload.status === 'invalid_params' ? 400 : 422).json(payload);
    }
    const parameterSettings = req.body?.saveParams
      ? saveInventoryRiskSettings(payload.params || req.body, req.user.name)
      : currentInventoryRiskSettings();
    return res.json({ ...payload, parameterSettings });
  } catch (error) {
    return res.status(400).json({ error: error.message || '供应计划分析参数无效' });
  }
});

app.post('/api/inventory-risk/export', requireAuth, requirePage('inventoryRisk'), async (req, res) => {
  try {
    const payload = inventoryRiskData(req.body);
    if (!payload.ok) {
      return res.status(payload.status === 'invalid_params' ? 400 : 422).json(payload);
    }
    const workbook = buildInventoryRiskWorkbook({
      ...payload,
      includeDataSource: Boolean(req.body?.includeDataSource)
    });
    const buffer = Buffer.from(await buildStyledExcelBuffer(xlsx, workbook));
    const fileName = `供应计划分析_${nowText().slice(0, 10).replaceAll('-', '')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="inventory-risk.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.send(buffer);
  } catch (error) {
    return res.status(400).json({ error: error.message || '供应计划分析参数无效' });
  }
});

app.get('/api/bei-huo-gong-ju/params', requireAuth, requirePage('beiHuoGongJu'), (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json(currentBeiHuoGongJuSettings());
});

app.post('/api/bei-huo-gong-ju/query', requireAuth, requirePage('beiHuoGongJu'), (req, res) => {
  try {
    const payload = beiHuoGongJuData(req.body, { force: Boolean(req.body?.force) });
    res.setHeader('Cache-Control', 'no-store');
    if (!payload.ok) {
      return res.status(payload.status === 'invalid_params' ? 400 : 422).json(payload);
    }
    const parameterSettings = req.body?.saveParams
      ? saveBeiHuoGongJuSettings(payload.params || req.body, req.user.name)
      : currentBeiHuoGongJuSettings();
    return res.json({ ...payload, parameterSettings });
  } catch (error) {
    return res.status(400).json({ error: error.message || '备货工具参数无效' });
  }
});

app.post('/api/bei-huo-gong-ju/export', requireAuth, requirePage('beiHuoGongJu'), async (req, res) => {
  try {
    const payload = beiHuoGongJuData(req.body);
    if (!payload.ok) {
      return res.status(payload.status === 'invalid_params' ? 400 : 422).json(payload);
    }
    const workbook = buildInventoryRiskWorkbook({
      ...payload,
      includeDataSource: Boolean(req.body?.includeDataSource)
    });
    const buffer = Buffer.from(await buildStyledExcelBuffer(xlsx, workbook));
    const fileName = `备货工具_${nowText().slice(0, 10).replaceAll('-', '')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="bei-huo-gong-ju.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.send(buffer);
  } catch (error) {
    return res.status(400).json({ error: error.message || '备货工具参数无效' });
  }
});

app.get('/api/inventory-purchase-summary', requireAuth, requirePage('inventoryPurchase'), (req, res) => {
  const model = inventorySummaryData();
  res.json({
    updatedAt: model.updatedAt,
    months: model.months,
    rows: model.rows.filter((row) => (
      row.deliveryStatuses?.length
      || numberValue(row.unfulfilledQty)
      || numberValue(row.finishedNotShippedQty)
      || numberValue(row.unpreparedQty)
      || numberValue(row.preparedNotStartedQty)
      || numberValue(row.inProductionQty)
    ))
  });
});

app.get('/api/cross-border-inventory', requireAuth, requirePage('crossBorderInventory'), (req, res) => {
  const model = buildCrossBorderInventoryModel();
  res.json({ rows: model.rows, sourceApplications: model.sourceApplications, qualitySummary: model.qualitySummary });
});

app.get('/api/first-mile-board', requireAuth, requirePage('firstMileBoard'), (req, res) => {
  res.json(firstMileBoardModel());
});

app.post('/api/first-mile-board/export', requireAuth, requirePage('firstMileBoard'), async (req, res) => {
  const rows = filterFirstMileRows(firstMileBoardModel().rows, req.body?.filters || {});
  const headers = [
    '运输方式', '货物状态', '事业部', '店铺', '目的仓库', '入仓类型', '运营', '销售产品线', '销售系列',
    '来源负责人', 'OA审批单号', '物料编码', 'SKU', '物料名称', '数量',
    '预计开船时间', '实际开船时间', '预计到港时间', '到港时间',
    '预计派送时间', '实际派送时间', '上架时间', '来源文件', '来源Sheet'
  ];
  const data = rows.map((row) => [
    row.transportMode, row.cargoStatus, row.businessUnit, row.storeName, row.destinationWarehouse,
    row.inboundWarehouseType, row.operatorName,
    row.productLine, row.productSeries, row.sourceOwner, row.oaApprovalNo, row.materialCode,
    row.sku, row.materialName, row.quantity, row.expectedSailingAt, row.actualSailingAt,
    row.expectedArrivalAt, row.actualArrivalAt, row.expectedDeliveryAt, row.actualDeliveryAt,
    row.listingAt, row.sourceFileText, row.sourceSheetText
  ]);
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.aoa_to_sheet([headers, ...data]);
  worksheet['!cols'] = headers.map((header) => ({ wch: Math.max(12, Math.min(30, header.length * 2 + 4)) }));
  xlsx.utils.book_append_sheet(workbook, worksheet, '头程数据明细');
  const buffer = Buffer.from(await buildStyledExcelBuffer(xlsx, workbook));
  const fileName = `头程数据看板_${nowText().slice(0, 10).replace(/-/g, '')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="first-mile-board.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.send(buffer);
});

app.get('/api/dimension-missing/cross-border', requireAuth, requirePage('dimensionMissing'), (req, res) => {
  const model = buildCrossBorderInventoryModel();
  const inventoryDiagnostics = buildInventoryDimensionDiagnostics(inventorySummaryData());
  const inventoryFactSlotByType = {
    FBA库存: 'inventorySummaryFile1',
    FBM库存: 'inventorySummaryFile2',
    WFS库存: 'inventorySummaryFile3',
    FBA在途: 'inventorySummaryFile4',
    FBM在途: 'inventorySummaryFile5',
    WFS在途: 'inventorySummaryFile17',
    国内在库: 'inventorySummaryFile6',
    京东在库: 'inventorySummaryFile7',
    京东在途: 'inventorySummaryFile14',
    销售数据: 'inventorySummaryFile8',
    采购未交付: 'inventorySummaryFile12'
  };
  const inventoryFactApplications = [...new Set(inventoryDiagnostics.issues
    .map((row) => inventoryFactSlotByType[row.sourceType])
    .filter(Boolean))]
    .map((slotId) => {
      const record = get(
        'SELECT file_name, mapping_json, updated_at FROM dimension_files WHERE slot_id = ? AND applied = 1',
        [slotId]
      );
      const mapping = parseJson(record?.mapping_json, {});
      return {
        slotId,
        label: DIMENSION_SLOTS[slotId] || slotId,
        fileName: record?.file_name || '未上传',
        appliedAt: record?.updated_at || '暂无',
        parseSummary: mapping.__inventorySummary || null,
        requiresReupload: slotId === 'inventorySummaryFile1'
          && numberValue(mapping.__inventorySummary?.parserVersion) < 3
      };
    });
  const inventorySourceApplications = [...new Set(inventoryDiagnostics.issues.map((row) => row.targetSlotId))]
    .map((slotId) => {
      const record = get(
        'SELECT file_name, updated_at FROM dimension_files WHERE slot_id = ? AND applied = 1',
        [slotId]
      );
      return {
        slotId,
        label: DIMENSION_SLOTS[slotId] || slotId,
        fileName: record?.file_name || '未上传',
        appliedAt: record?.updated_at || '暂无'
      };
    });
  const sourceApplications = [...inventoryFactApplications, ...model.sourceApplications, ...inventorySourceApplications]
    .filter((row, index, rows) => rows.findIndex((item) => item.slotId === row.slotId) === index);
  res.json({
    matchRows: model.rows,
    missingTasks: model.missingTasks,
    conflicts: model.conflicts,
    sourceAnomalies: model.sourceAnomalies,
    sourceApplications,
    qualitySummary: model.qualitySummary,
    inventorySummaryIssues: inventoryDiagnostics.issues,
    inventorySummaryTasks: inventoryDiagnostics.tasks,
    inventorySummaryQuality: inventoryDiagnostics.qualitySummary
  });
});

app.get('/api/domestic-board', requireAuth, requirePage('domesticBoard'), (req, res) => {
  const sourceSlots = [
    ['spare2', '国内商品资料'],
    ['wangdianDataMain', '国内数据'],
    ['wangdianSpare1', '京东库存'],
    ['wangdianSpare2', '京东ID与品号匹配'],
    ['productCategory', '商品分类']
  ];
  const sourceApplications = sourceSlots.map(([slotId, label]) => {
    const record = get('SELECT file_name, updated_at FROM dimension_files WHERE slot_id = ? AND applied = 1', [slotId]);
    return { slotId, label, fileName: record?.file_name || '未上传', appliedAt: record?.updated_at || '暂无' };
  });
  res.json({
    rows: domesticBoardRows(),
    sourceApplications: [
      ...sourceApplications,
      { slotId: 'kingdeeOrders', label: '采购订单列表', fileName: '当前应用采购订单', appliedAt: currentAppliedAt() || '暂无' }
    ]
  });
});

app.patch('/api/domestic-board/:merchantCode', requireAuth, requirePage('domesticBoard'), (req, res) => {
  const merchantCode = normalize(req.params.merchantCode);
  if (!merchantCode) return res.status(400).json({ error: '商家编码不能为空' });
  const updatedAt = saveDomesticManualInput(merchantCode, domesticManualPayload(req.body), req.user.name);
  saveDatabase();
  res.json({ ok: true, merchantCode, updatedAt, rows: domesticBoardRows() });
});

app.post('/api/domestic-board/bulk', requireAuth, requirePage('domesticBoard'), (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  let updated = 0;
  transaction(() => {
    rows.forEach((row) => {
      const merchantCode = normalize(row.merchantCode || row.merchant_code);
      if (!merchantCode) return;
      saveDomesticManualInput(merchantCode, domesticManualPayload(row), req.user.name);
      updated++;
    });
  });
  res.json({ ok: true, updated, rows: domesticBoardRows() });
});

app.get('/api/mappings/:kind', requireAuth, (req, res) => {
  const row = get('SELECT * FROM import_mappings WHERE kind = ?', [req.params.kind]);
  res.json({ mapping: parseJson(row?.mapping_json, {}) });
});

app.put('/api/mappings/:kind', requireAuth, (req, res) => {
  const mapping = req.body?.mapping || {};
  const now = nowText();
  run(
    `INSERT INTO import_mappings (kind, mapping_json, updated_by, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(kind) DO UPDATE SET mapping_json = excluded.mapping_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [req.params.kind, JSON.stringify(mapping), req.user.name, now]
  );
  saveDatabase();
  res.json({ mapping });
});

app.post('/api/workbook/inspect', requireAuth, kingdeeUpload.single('file'), cleanupKingdeeUpload, async (req, res) => {
  const sheetName = normalize(req.body.sheetName);
  const slotId = normalize(req.body.slotId);
  const baseSlotId = inventoryLibraryBaseSlotId(slotId);
  if (isFirstMileSlot(slotId)) {
    const file = { ...req.file, buffer: await fs.promises.readFile(req.file.path) };
    return res.json(inspectFirstMileWorkbook(file));
  }
  if (slotId === 'fullInventoryFile1') {
    const file = { ...req.file, buffer: await fs.promises.readFile(req.file.path) };
    return res.json(inspectFullInventoryWorkbook(file));
  }
  if (slotId === 'fullInventoryFile2') {
    const file = { ...req.file, buffer: await fs.promises.readFile(req.file.path) };
    return res.json(inspectOrderFulfillmentWorkbook(file));
  }
  if (['inventorySummaryFile15', 'inventorySummaryFile16'].includes(baseSlotId)) {
    return res.json(await workbookChoiceInspect(req.file));
  }
  if (isInventoryLibrarySlot(slotId)) {
    return res.json(await streamingWorkbookInspect(req.file, sheetName || null));
  }
  const file = { ...req.file, buffer: await fs.promises.readFile(req.file.path) };
  if (slotId === PRODUCT_PROJECT_SLOT_ID) return res.json(inspectProductProjectWorkbook(file));
  res.json(workbookInspect(file, sheetName || null));
});

function kingdeeImportMapping(body = {}) {
  if (normalize(body.mapping)) return parseJson(body.mapping, {});
  const saved = get('SELECT mapping_json FROM import_mappings WHERE kind = ?', ['kingdee']);
  return parseJson(saved?.mapping_json, {});
}

app.get('/api/imports/kingdee/current-status', requireAuth, requirePage('kingdeeImport'), (req, res) => {
  const batch = get(
    `SELECT b.*
     FROM order_demands d
     JOIN kingdee_import_batches b ON b.id = d.source_batch_id
     WHERE d.active = 1
     ORDER BY COALESCE(NULLIF(b.applied_at, ''), b.imported_at) DESC
     LIMIT 1`
  );
  const history = all('SELECT id, file_name, import_mode, imported_by, imported_at, applied_at, row_count, skipped_rows, skipped_json FROM kingdee_import_batches ORDER BY imported_at DESC LIMIT 10')
    .map((row) => ({
      batchId: row.id,
      fileName: row.file_name,
      importMode: row.import_mode || 'snapshot',
      importedBy: row.imported_by,
      importedAt: row.imported_at,
      appliedAt: row.applied_at || row.imported_at,
      rowCount: numberValue(row.row_count),
      skippedRows: numberValue(row.skipped_rows),
      skipped: parseJson(row.skipped_json, [])
    }));
  if (!batch) return res.json({ current: null, history });
  const activeRows = numberValue(get('SELECT COUNT(*) AS count FROM order_demands WHERE active = 1')?.count);
  res.json({
    current: {
      batchId: batch.id,
      fileName: batch.file_name,
      importedBy: batch.imported_by,
      importedAt: batch.imported_at,
      appliedAt: batch.applied_at || batch.imported_at,
      rowCount: numberValue(batch.row_count),
      importMode: batch.import_mode || 'snapshot',
      activeRows
    },
    history
  });
});

function clearKingdeeCache(req, res) {
  if (normalize(req.user.name) !== normalize(ADMIN_NAME)) {
    return res.status(403).json({ error: `仅${ADMIN_NAME}可以清除采购订单缓存` });
  }
  const preserved = {
    dimensionFiles: numberValue(get('SELECT COUNT(*) AS count FROM dimension_files')?.count),
    progress: numberValue(get('SELECT COUNT(*) AS count FROM supplier_progress')?.count),
    progressSnapshots: numberValue(get('SELECT COUNT(*) AS count FROM supplier_progress_snapshots')?.count)
  };
  const counts = {
    kingdeeOrders: numberValue(get('SELECT COUNT(*) AS count FROM kingdee_orders')?.count),
    importBatches: numberValue(get('SELECT COUNT(*) AS count FROM kingdee_import_batches')?.count),
    demands: numberValue(get('SELECT COUNT(*) AS count FROM order_demands')?.count),
    snapshotDiffs: numberValue(get('SELECT COUNT(*) AS count FROM demand_snapshot_diffs')?.count),
    compareSessions: numberValue(get('SELECT COUNT(*) AS count FROM difference_compare_sessions')?.count),
    compareRows: numberValue(get('SELECT COUNT(*) AS count FROM difference_compare_rows')?.count),
    allocations: numberValue(get('SELECT COUNT(*) AS count FROM difference_allocations')?.count),
    orderEvents: numberValue(get('SELECT COUNT(*) AS count FROM kingdee_order_events')?.count)
  };
  transaction(() => {
    run('DELETE FROM kingdee_order_events');
    run('DELETE FROM difference_allocations');
    run('DELETE FROM difference_compare_rows');
    run('DELETE FROM difference_compare_sessions');
    run('DELETE FROM demand_snapshot_diffs');
    run('DELETE FROM kingdee_orders');
    run('DELETE FROM order_demands');
    run('DELETE FROM kingdee_import_batches');
    const dimensionFilesAfter = numberValue(get('SELECT COUNT(*) AS count FROM dimension_files')?.count);
    if (dimensionFilesAfter !== preserved.dimensionFiles) {
      throw new Error('维度表保护校验失败，清除缓存已回滚');
    }
    const progressAfter = numberValue(get('SELECT COUNT(*) AS count FROM supplier_progress')?.count);
    const progressSnapshotsAfter = numberValue(get('SELECT COUNT(*) AS count FROM supplier_progress_snapshots')?.count);
    if (progressAfter !== preserved.progress || progressSnapshotsAfter !== preserved.progressSnapshots) {
      throw new Error('生产跟进保护校验失败，清除缓存已回滚');
    }
  });
  res.json({ ok: true, cleared: counts, preserved });
}

app.delete('/api/imports/kingdee/cache', requireAuth, requirePage('kingdeeImport'), clearKingdeeCache);

app.delete('/api/imports/kingdee/test-cache', requireAuth, requirePage('kingdeeImport'), (req, res) => {
  clearKingdeeCache(req, res);
});

app.post('/api/imports/kingdee/preview', requireAuth, requirePage('kingdeeImport'), kingdeeUpload.single('file'), cleanupKingdeeUpload, async (req, res) => {
  const mapping = kingdeeImportMapping(req.body);
  const sheetName = normalize(req.body.sheetName);
  const parsed = await streamingKingdeeWorkbookRows(req.file, sheetName || null, {
    includePreviews: false,
    mapping,
    preferredSheetPatterns: [/Fac\s*-\s*采购订单列表/i, /采购订单列表/i]
  });
  const result = mappedKingdeeRows(parsed.rows, mapping, { retainRaw: false });
  parsed.rowCount = parsed.rows.length;
  parsed.rows = [];
  const summary = summarizeDemands(result.rows);
  const stats = kingdeeImportStats(result, summary);
  res.json({
    fileName: safeFilename(req.file),
    ...stats,
    skipped: result.skipped.slice(0, 10),
    summaryRowsDetail: result.summary.slice(0, 10),
    rowCount: result.rows.length,
    summary: summary.slice(0, 100),
    diffs: diffAgainstCurrent(summary)
  });
});

app.post('/api/imports/kingdee/apply', requireAuth, requirePage('kingdeeImport'), (_req, res) => {
  res.status(410).json({ error: '当前应用采购订单已改为只读，请通过“新采购订单上传”自动解析并应用。' });
});

app.post('/api/imports/kingdee/new-snapshot', requireAuth, requirePage('kingdeeImport'), kingdeeUpload.single('file'), cleanupKingdeeUpload, async (req, res) => {
  const startedAt = Date.now();
  const mapping = kingdeeImportMapping(req.body);
  const sheetName = normalize(req.body.sheetName);
  const parsed = await streamingKingdeeWorkbookRows(req.file, sheetName || null, {
    includePreviews: false,
    mapping,
    preferredSheetPatterns: [/Fac\s*-\s*采购订单列表/i, /采购订单列表/i]
  });
  const result = mappedKingdeeRows(parsed.rows, mapping, { retainRaw: false });
  parsed.rowCount = parsed.rows.length;
  parsed.rows = [];
  if (!result.validRows) {
    return res.status(400).json({
      error: `未解析到有效采购订单，已停止应用。共读取 ${result.totalRows} 行，跳过 ${result.skippedRows} 行，请检查文件格式和必填字段。`
    });
  }
  const summary = summarizeDemands(result.rows);
  const stats = kingdeeImportStats(result, summary);
  const diffs = diffAgainstCurrent(summary);
  const now = nowText();
  let compare;
  let batchId = '';
  transaction(() => {
    compare = persistDifferenceCompare({
      file: req.file,
      sheetName,
      mapping,
      parsed,
      result,
      summary,
      user: req.user,
      transactionManaged: true,
      storeSnapshotPayload: false
    });
    batchId = applyKingdeeSnapshot({ fileName: safeFilename(req.file), sourceRows: result.rows, summary, diffs, mapping, userName: req.user.name, now, skippedRows: result.skippedRows, skipped: result.skipped });
    run('UPDATE difference_compare_sessions SET status = ?, applied_batch_id = ?, applied_at = ?, new_applied_at = ? WHERE id = ?', ['snapshot_applied', batchId, now, now, compare.sessionId]);
  });
  const durationMs = Date.now() - startedAt;
  console.info(`[Kingdee snapshot] ${safeFilename(req.file)}: ${result.rows.length} rows, ${compare.rows.length} differences, ${durationMs}ms`);
  res.json({
    batchId,
    sessionId: compare.sessionId,
    importedAt: now,
    appliedAt: now,
    rowCount: result.rows.length,
    totalRows: parsed.rowCount,
    ...stats,
    skipped: result.skipped.slice(0, 10),
    diffRows: compareRowsForSession(compare.sessionId, req.user),
    allocations: allocationRows(compare.sessionId),
    actions: DIFF_ALLOCATION_ACTIONS,
    reasons: DIFF_ALLOCATION_REASONS,
    status: allocationStatus(compare.sessionId),
    durationMs
  });
});

app.get('/api/demands', requireAuth, (req, res) => {
  res.json({
    rows: demandRows(req.query.includeInactive === '1', req.user, {
      includeOperationOrders: req.query.orderLevel === '1'
    }),
    currentAppliedAt: currentAppliedAt()
  });
});

app.get('/api/progress/demands', requireAuth, requirePage('progressRefresh'), (req, res) => {
  const startedAt = Date.now();
  const rows = demandRows(false, req.user, { includeInventory: false });
  const durationMs = Date.now() - startedAt;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Server-Timing', `progress-demands;dur=${durationMs}`);
  res.json({
    rows,
    currentAppliedAt: currentAppliedAt(),
    dataScope: 'progress',
    durationMs
  });
});

app.get('/api/operation-board/demands', requireAuth, requirePage('operationBoard'), (req, res) => {
  res.json({
    rows: demandRows(false, null, { includeOperationOrders: true, currentKingdeeOnly: true }),
    currentAppliedAt: currentAppliedAt()
  });
});

app.get('/api/table-relationships', requireAuth, (req, res) => {
  const tables = [
    { name: 'kingdee_import_batches', label: '金蝶导入批次', group: '金蝶数据', groupColor: '#3b82f6' },
    { name: 'kingdee_orders', label: '金蝶采购订单', group: '金蝶数据', groupColor: '#3b82f6' },
    { name: 'kingdee_order_events', label: '金蝶变更事件', group: '金蝶数据', groupColor: '#3b82f6' },
    { name: 'order_demands', label: '运营需求汇总', group: '核心数据', groupColor: '#ef4444' },
    { name: 'supplier_progress', label: '生产进度', group: '进度数据', groupColor: '#10b981' },
    { name: 'supplier_progress_snapshots', label: '进度快照', group: '进度数据', groupColor: '#10b981' },
    { name: 'manual_progress_import_batches', label: '手工导入批次', group: '手工数据', groupColor: '#f59e0b' },
    { name: 'manual_progress_rows', label: '手工登记行', group: '手工数据', groupColor: '#f59e0b' },
    { name: 'manual_progress_allocations', label: '手工进度分配', group: '手工数据', groupColor: '#f59e0b' },
    { name: 'inventory', label: '库存', group: '库存数据', groupColor: '#8b5cf6' },
    { name: 'inventory_logs', label: '库存日志', group: '库存数据', groupColor: '#8b5cf6' },
    { name: 'inventory_manual_reconciliation_notes', label: '手工对账备注', group: '库存数据', groupColor: '#8b5cf6' },
    { name: 'difference_compare_sessions', label: '差异对比会话', group: '差异数据', groupColor: '#ec4899' },
    { name: 'difference_compare_rows', label: '差异对比行', group: '差异数据', groupColor: '#ec4899' },
    { name: 'difference_allocations', label: '差异分配', group: '差异数据', groupColor: '#ec4899' },
    { name: 'demand_snapshot_diffs', label: '快照差异', group: '差异数据', groupColor: '#ec4899' },
    { name: 'dimension_files', label: '维度表文件', group: '维度数据', groupColor: '#06b6d4' },
    { name: 'import_mappings', label: '导入映射配置', group: '维度数据', groupColor: '#06b6d4' },
    { name: 'demand_change_notes', label: '需求变更备注', group: '其他', groupColor: '#6b7280' },
    { name: 'domestic_board_inputs', label: '国内事业部', group: '其他', groupColor: '#6b7280' }
  ];
  const counts = {};
  for (const t of tables) {
    try { const r = all('SELECT COUNT(*) as cnt FROM ' + t.name); counts[t.name] = r[0]?.cnt || 0; }
    catch { counts[t.name] = 0; }
  }
  const relationships = [
    { from: 'kingdee_import_batches', fromCol: 'id', to: 'kingdee_orders', toCol: 'batch_id', label: '1:N' },
    { from: 'kingdee_orders', fromCol: 'demand_key', to: 'order_demands', toCol: 'demand_key', label: 'N:1' },
    { from: 'kingdee_orders', fromCol: 'demand_key', to: 'kingdee_order_events', toCol: 'demand_key', label: '1:N' },
    { from: 'order_demands', fromCol: 'demand_key', to: 'supplier_progress', toCol: 'demand_key', label: '1:1' },
    { from: 'order_demands', fromCol: 'demand_key', to: 'manual_progress_rows', toCol: 'demand_key', label: '1:N' },
    { from: 'order_demands', fromCol: 'demand_key', to: 'demand_change_notes', toCol: 'demand_key', label: '1:N' },
    { from: 'order_demands', fromCol: 'demand_key', to: 'demand_snapshot_diffs', toCol: 'demand_key', label: '1:N' },
    { from: 'order_demands', fromCol: 'source_batch_id', to: 'kingdee_import_batches', toCol: 'id', label: 'N:1' },
    { from: 'supplier_progress', fromCol: 'demand_key', to: 'supplier_progress_snapshots', toCol: 'demand_key', label: '1:N' },
    { from: 'manual_progress_import_batches', fromCol: 'id', to: 'manual_progress_rows', toCol: 'batch_id', label: '1:N' },
    { from: 'manual_progress_rows', fromCol: 'demand_key', to: 'manual_progress_allocations', toCol: 'demand_key', label: '1:N' },
    { from: 'difference_compare_sessions', fromCol: 'id', to: 'difference_compare_rows', toCol: 'session_id', label: '1:N' },
    { from: 'difference_compare_sessions', fromCol: 'id', to: 'difference_allocations', toCol: 'session_id', label: '1:N' },
    { from: 'difference_compare_rows', fromCol: 'id', to: 'difference_allocations', toCol: 'row_id', label: '1:N' }
  ];
  res.json({ tables: tables.map(t => ({ ...t, rowCount: counts[t.name] })), relationships });
});

function manualProgressPreviewRows(batchId, limit = 80) {
  const rows = all(
    `SELECT id, source_row_no, data_status, order_no, oa_flow_no, business_unit, supplier_short_name,
            purchase_owner, material_code, sku, manual_remaining_qty, validation_status,
            validation_message, conflict_fields_json, candidate_json, deleted_at, delete_reason
     FROM manual_progress_rows
     WHERE batch_id = ?
     ORDER BY CASE WHEN validation_status = 'error' THEN 0 WHEN data_status = '手工待匹配' THEN 1 ELSE 2 END,
              source_row_no
     LIMIT ?`,
    [batchId, limit]
  );
  const allocationMap = new Map();
  all(
    `SELECT * FROM manual_progress_allocations WHERE batch_id = ? ORDER BY source_row_no, order_no`,
    [batchId]
  ).forEach((allocation) => {
    const list = allocationMap.get(allocation.source_row_id) || [];
    list.push({
      orderNo: allocation.order_no,
      demandKey: allocation.demand_key,
      status: allocation.match_status,
      reason: allocation.match_reason,
      isClosed: Boolean(allocation.is_closed),
      orderQty: numberValue(allocation.order_qty),
      inboundQty: numberValue(allocation.inbound_qty),
      remainingQty: numberValue(allocation.remaining_qty),
      unpreparedQty: numberValue(allocation.allocated_unprepared_qty),
      preparedNotStartedQty: numberValue(allocation.allocated_prepared_qty),
      inProductionQty: numberValue(allocation.allocated_in_production_qty),
      finishedQty: numberValue(allocation.allocated_finished_qty)
    });
    allocationMap.set(allocation.source_row_id, list);
  });
  return rows.map((row) => ({
    id: row.id,
    sourceRowNo: numberValue(row.source_row_no),
    dataStatus: row.data_status,
    orderNo: row.order_no,
    oaFlowNo: row.oa_flow_no,
    businessUnit: row.business_unit,
    supplierShortName: row.supplier_short_name,
    purchaseOwner: row.purchase_owner,
    materialCode: row.material_code,
    sku: row.sku,
    manualRemainingQty: numberValue(row.manual_remaining_qty),
    validationStatus: row.validation_status,
    validationMessage: row.validation_message,
    conflictFields: parseJson(row.conflict_fields_json, []),
    candidates: parseJson(row.candidate_json, []),
    allocations: allocationMap.get(row.id) || [],
    deletedAt: row.deleted_at,
    deleteReason: row.delete_reason
  }));
}

function refreshManualProgressBatchSummary(batchId) {
  const batch = get('SELECT summary_json FROM manual_progress_import_batches WHERE id = ?', [batchId]);
  const summary = {
    ...parseJson(batch?.summary_json, {}),
    manualUnmatchedRows: numberValue(get(
      `SELECT COUNT(*) AS count FROM manual_progress_rows
       WHERE batch_id = ? AND data_status = '手工待匹配' AND deleted_at = ''`,
      [batchId]
    )?.count),
    deletedRows: numberValue(get(
      `SELECT COUNT(*) AS count FROM manual_progress_rows
       WHERE batch_id = ? AND data_status = '已删除'`,
      [batchId]
    )?.count)
  };
  run('UPDATE manual_progress_import_batches SET summary_json = ? WHERE id = ?', [JSON.stringify(summary), batchId]);
  return summary;
}

app.post('/api/progress/manual-import/preview', requireAuth, requirePage('progressRefresh'), requireSystemOwner, upload.single('file'), (req, res) => {
  try {
    if (!req.file?.buffer?.length) return res.status(400).json({ error: '请选择手工登记表文件' });
    const parsedWorkbook = workbookRows(req.file, null, { includePreviews: true });
    const targetSheet = parsedWorkbook.sheets.find((sheet) => normalize(sheet.sheetName) === '采购总览')
      || (parsedWorkbook.sheets.length === 1 ? parsedWorkbook.sheets[0] : null);
    if (!targetSheet) return res.status(400).json({ error: '请保留“采购总览”工作表；多工作表文件无法确定导入范围' });
    const requiredColumns = ['采购下单人', '下单月份', '事业部', '采购订单号', '供应商简称', '物料编码', '未交付数量', '已备料未生产', '生产中产品', '完工未发产品'];
    const missingColumns = requiredColumns.filter((column) => !targetSheet.columns.includes(column));
    if (missingColumns.length) return res.status(400).json({ error: `缺少必要字段：${missingColumns.join('、')}` });
    const fileHash = createHash('sha256').update(req.file.buffer).update(':manual-progress-v3').digest('hex');
    const existing = get(
      `SELECT * FROM manual_progress_import_batches
       WHERE file_hash = ? AND status = 'applied'
       ORDER BY applied_at DESC LIMIT 1`,
      [fileHash]
    );
    if (existing) {
      return res.json({
        batchId: existing.id,
        fileHash,
        fileName: existing.file_name,
        sheetName: existing.sheet_name,
        status: existing.status,
        alreadyApplied: true,
        summary: parseJson(existing.summary_json, {}),
        rows: manualProgressPreviewRows(existing.id)
      });
    }
    const parsed = parseManualProgressRows(targetSheet.rows, { headerRow: targetSheet.headerRow });
    const batchId = randomUUID();
    parsed.rows.forEach((row) => {
      row.id = randomUUID();
      row.batchId = batchId;
    });
    const groups = groupManualProgressRows(parsed.rows);
    groups.forEach((group) => group.sourceRows.forEach((row) => { row.groupKey = group.groupKey; }));
    matchManualProgressRows(parsed.rows);
    const summary = manualProgressSummary(parsed.rows, parsed.summary);
    const now = nowText();
    transaction(() => {
      run(
        `INSERT INTO manual_progress_import_batches
          (id, file_hash, file_name, sheet_name, row_count, status, summary_json, imported_by, imported_at, applied_at)
         VALUES (?, ?, ?, ?, ?, 'preview', ?, ?, ?, '')`,
        [batchId, fileHash, safeFilename(req.file), targetSheet.sheetName, parsed.rows.length, JSON.stringify(summary), req.user.name, now]
      );
      runMany(
        `INSERT INTO manual_progress_rows (
           id, batch_id, source_row_no, source_key, group_key, row_type, data_status, demand_key,
           order_no, month, business_unit, supplier_short_name, purchase_owner, purchase_group,
           oa_flow_no, operator_name, product_line, product_series, material_code, sku, material_name,
           manual_remaining_qty, unprepared_qty, prepared_not_started_qty, in_production_qty, finished_qty,
           source_shipped_qty, source_contract_delivery_date, production_delivery_date,
           unproduced_estimated_delivery_date, fulfillment_status, unfulfilled_reason, reason_detail, remark,
           validation_status, validation_message, conflict_fields_json, raw_json, candidate_json,
           confirmed_demand_key, confirmed_order_no, confirmed_by, confirmed_at,
           deleted_by, deleted_at, delete_reason, updated_by, updated_at
         ) VALUES (${Array(48).fill('?').join(', ')})`,
        parsed.rows.map((row) => manualProgressRowParams(batchId, row, now, req.user.name))
      );
      replaceManualProgressAllocations(parsed.rows, batchId, now);
    });
    req.auditTarget = safeFilename(req.file);
    req.auditDetails = `手工登记表预览：${parsed.rows.length} 行；已匹配 ${summary.matchedRows}；待匹配 ${summary.manualUnmatchedRows}；公司大合同 ${summary.companyContractRows}；校验失败 ${summary.validationErrorRows}`;
    res.json({
      batchId,
      fileHash,
      fileName: safeFilename(req.file),
      sheetName: targetSheet.sheetName,
      status: 'preview',
      alreadyApplied: false,
      summary,
      rows: manualProgressPreviewRows(batchId)
    });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || '手工登记表解析失败' });
  }
});

app.post('/api/progress/manual-import/:batchId/apply', requireAuth, requirePage('progressRefresh'), requireSystemOwner, (req, res) => {
  try {
    const batch = get('SELECT * FROM manual_progress_import_batches WHERE id = ?', [req.params.batchId]);
    if (!batch) return res.status(404).json({ error: '导入预览不存在，请重新上传文件' });
    if (batch.status === 'applied') {
      return res.json({ batchId: batch.id, alreadyApplied: true, summary: parseJson(batch.summary_json, {}) });
    }
    if (batch.status !== 'preview') return res.status(409).json({ error: '当前预览状态不可应用' });
    const expectedRows = Math.max(0, Math.floor(numberValue(req.body.expectedRows)));
    const storedRows = numberValue(get('SELECT COUNT(*) AS count FROM manual_progress_rows WHERE batch_id = ?', [batch.id])?.count);
    if (!expectedRows || expectedRows !== storedRows || expectedRows !== numberValue(batch.row_count)) {
      return res.status(409).json({ error: '源数据行数已变化，请重新上传并核对预览' });
    }
    const now = nowText();
    let reconciliation;
    transaction(() => {
      run(
        `UPDATE manual_progress_rows
         SET active = 0, stale = 1, data_status = '本次手工表未出现', updated_by = ?, updated_at = ?
         WHERE active = 1 AND batch_id <> ?`,
        [req.user.name, now, batch.id]
      );
      run('UPDATE manual_progress_allocations SET active = 0 WHERE active = 1');
      run(
        `UPDATE manual_progress_rows
         SET active = 1, stale = 0, updated_by = ?, updated_at = ?
         WHERE batch_id = ?`,
        [req.user.name, now, batch.id]
      );
      run(
        `UPDATE manual_progress_allocations SET active = 1, updated_at = ?
         WHERE batch_id = ? AND source_row_id IN (
           SELECT id FROM manual_progress_rows
           WHERE batch_id = ? AND active = 1 AND stale = 0 AND deleted_at = '' AND validation_status = 'valid'
         )`,
        [now, batch.id, batch.id]
      );
      run(
        `UPDATE manual_progress_import_batches SET status = 'applied', applied_at = ? WHERE id = ?`,
        [now, batch.id]
      );
      reconciliation = reconcileActiveManualProgress(req.user.name, now, batch.id);
    });
    req.auditTarget = batch.file_name;
    req.auditDetails = `应用手工登记表 ${storedRows} 行；重新匹配 ${reconciliation.matched}/${reconciliation.checked} 行`;
    res.json({
      batchId: batch.id,
      appliedAt: now,
      alreadyApplied: false,
      summary: parseJson(batch.summary_json, {}),
      reconciliation
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '手工登记表应用失败' });
  }
});

app.post('/api/progress/manual-import/reconcile', requireAuth, requirePage('progressRefresh'), requireSystemOwner, (req, res) => {
  try {
    const startedAt = Date.now();
    const now = nowText();
    let result;
    transaction(() => { result = reconcileActiveManualProgress(req.user.name, now); });
    result.elapsedMs = Date.now() - startedAt;
    console.info(`[Manual progress reconcile] ${result.checked} rows, ${result.allocations} allocations, ${result.elapsedMs}ms`);
    req.auditTarget = `${result.checked} 条手工记录`;
    req.auditDetails = `重新匹配完成：已匹配 ${result.matched} 条`;
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '重新匹配失败' });
  }
});

app.post('/api/progress/manual-import/rows/:rowId/confirm', requireAuth, requirePage('progressRefresh'), requireSystemOwner, (req, res) => {
  try {
    const dbRow = get(
      `SELECT * FROM manual_progress_rows
       WHERE id = ? AND active = 1 AND stale = 0 AND deleted_at = ''`,
      [req.params.rowId]
    );
    if (!dbRow) return res.status(404).json({ error: '待匹配手工记录不存在或已失效' });
    const row = manualProgressDbModel(dbRow);
    if (manualOrderNumbers(row.orderNo).length) return res.status(400).json({ error: '有采购订单号的记录必须按采购订单号+物料编码精确匹配' });
    row.confirmedDemandKey = '';
    row.confirmedOrderNo = '';
    row.conflictFields = [];
    matchManualProgressRows([row]);
    const demandKeyValue = normalize(req.body.demandKey);
    const orderNo = normalize(req.body.orderNo);
    const candidate = (row.candidates || []).find((item) => (
      item.demandKey === demandKeyValue && (!orderNo || item.orderNo === orderNo)
    ));
    if (!candidate) return res.status(409).json({ error: '候选采购订单已变化，请先重新匹配' });
    const now = nowText();
    let reconciliation;
    transaction(() => {
      run(
        `UPDATE manual_progress_rows
         SET confirmed_demand_key = ?, confirmed_order_no = ?, confirmed_by = ?, confirmed_at = ?,
             updated_by = ?, updated_at = ?
         WHERE id = ?`,
        [candidate.demandKey, candidate.orderNo || '', req.user.name, now, req.user.name, now, row.id]
      );
      reconciliation = reconcileActiveManualProgress(req.user.name, now);
    });
    req.auditTarget = `手工源行 ${row.sourceRowNo}`;
    req.auditDetails = `管理员确认匹配：${candidate.orderNo || candidate.demandKey} + ${row.materialCode}`;
    res.json({ confirmedAt: now, candidate, reconciliation });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '确认匹配失败' });
  }
});

app.post('/api/progress/manual-import/unmatched/delete-all', requireAuth, requirePage('progressRefresh'), requireSystemOwner, (req, res) => {
  try {
    if (normalize(req.user.name) !== normalize(ADMIN_NAME)) {
      return res.status(403).json({ error: `仅${ADMIN_NAME}可以删除手工待匹配记录` });
    }
    const batch = latestAppliedManualProgressBatch();
    if (!batch) return res.status(404).json({ error: '当前没有已应用的手工登记表' });
    const currentCount = numberValue(get(
      `SELECT COUNT(*) AS count FROM manual_progress_rows
       WHERE batch_id = ? AND deleted_at = '' AND data_status = '手工待匹配'`,
      [batch.id]
    )?.count);
    const expectedCount = Math.max(0, Math.floor(numberValue(req.body.expectedCount)));
    if (expectedCount !== currentCount) {
      return res.status(409).json({ error: `待匹配数量已变化，当前为${currentCount}条，请刷新后重试` });
    }
    if (!currentCount) {
      return res.json({ batchId: batch.id, deletedCount: 0, remainingCount: 0, summary: refreshManualProgressBatchSummary(batch.id), rows: manualProgressPreviewRows(batch.id, 500) });
    }
    const reason = normalize(req.body.reason) || '管理员批量删除手工待匹配记录';
    const now = nowText();
    let reconciliation;
    transaction(() => {
      run(
        `UPDATE manual_progress_rows
         SET deleted_by = ?, deleted_at = ?, delete_reason = ?, data_status = '已删除',
             validation_status = 'deleted', demand_key = '', updated_by = ?, updated_at = ?
         WHERE batch_id = ? AND deleted_at = '' AND data_status = '手工待匹配'`,
        [req.user.name, now, reason, req.user.name, now, batch.id]
      );
      run(
        `UPDATE manual_progress_allocations
         SET active = 0, updated_at = ?
         WHERE batch_id = ? AND source_row_id IN (
           SELECT id FROM manual_progress_rows WHERE batch_id = ? AND deleted_at = ?
         )`,
        [now, batch.id, batch.id, now]
      );
      reconciliation = reconcileActiveManualProgress(req.user.name, now, batch.id);
    });
    const remainingCount = numberValue(get(
      `SELECT COUNT(*) AS count FROM manual_progress_rows
       WHERE batch_id = ? AND deleted_at = '' AND data_status = '手工待匹配'`,
      [batch.id]
    )?.count);
    const summary = refreshManualProgressBatchSummary(batch.id);
    req.auditTarget = `${currentCount} 条手工待匹配记录`;
    req.auditDetails = `批量软删除当前手工批次待匹配记录；原因：${reason}`;
    res.json({
      batchId: batch.id,
      deletedCount: currentCount,
      remainingCount,
      deletedAt: now,
      deletedBy: req.user.name,
      reason,
      summary,
      rows: manualProgressPreviewRows(batch.id, 500),
      reconciliation
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '批量删除手工待匹配记录失败' });
  }
});

app.post('/api/progress/manual-import/rows/:rowId/delete', requireAuth, requirePage('progressRefresh'), requireSystemOwner, (req, res) => {
  try {
    if (normalize(req.user.name) !== normalize(ADMIN_NAME)) {
      return res.status(403).json({ error: `仅${ADMIN_NAME}可以删除无采购订单号手工记录` });
    }
    const dbRow = get(
      `SELECT * FROM manual_progress_rows
       WHERE id = ? AND active = 1 AND stale = 0 AND deleted_at = ''`,
      [req.params.rowId]
    );
    if (!dbRow) return res.status(404).json({ error: '手工记录不存在或已删除' });
    if (manualOrderNumbers(dbRow.order_no).length) return res.status(400).json({ error: '只能删除无采购订单号或公司大合同记录' });
    const reason = normalize(req.body.reason);
    if (!reason) return res.status(400).json({ error: '删除原因必填' });
    const now = nowText();
    let reconciliation;
    transaction(() => {
      run(
        `UPDATE manual_progress_rows
         SET deleted_by = ?, deleted_at = ?, delete_reason = ?, data_status = '已删除',
             validation_status = 'deleted', demand_key = '', updated_by = ?, updated_at = ?
         WHERE id = ?`,
        [req.user.name, now, reason, req.user.name, now, dbRow.id]
      );
      run('UPDATE manual_progress_allocations SET active = 0, updated_at = ? WHERE source_row_id = ?', [now, dbRow.id]);
      reconciliation = reconcileActiveManualProgress(req.user.name, now);
    });
    req.auditTarget = `手工源行 ${dbRow.source_row_no}`;
    req.auditDetails = `软删除无采购订单记录；原因：${reason}`;
    res.json({ deletedAt: now, deletedBy: req.user.name, reason, reconciliation });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '删除手工记录失败' });
  }
});

app.get('/api/progress/manual-import/history', requireAuth, requirePage('progressRefresh'), requireSystemOwner, (req, res) => {
  const rows = all(
    `SELECT id, file_name, sheet_name, row_count, status, summary_json, imported_by, imported_at, applied_at
     FROM manual_progress_import_batches ORDER BY imported_at DESC LIMIT 30`
  ).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    sheetName: row.sheet_name,
    rowCount: numberValue(row.row_count),
    status: row.status,
    summary: parseJson(row.summary_json, {}),
    importedBy: row.imported_by,
    importedAt: row.imported_at,
    appliedAt: row.applied_at
  }));
  res.json({ rows });
});

app.get('/api/progress/manual-import/latest', requireAuth, requirePage('progressRefresh'), requireSystemOwner, (req, res) => {
  const batch = latestAppliedManualProgressBatch();
  if (!batch) return res.json({ batch: null });
  const summary = refreshManualProgressBatchSummary(batch.id);
  res.json({
    batch: {
      id: batch.id,
      fileName: batch.file_name,
      sheetName: batch.sheet_name,
      rowCount: numberValue(batch.row_count),
      appliedAt: batch.applied_at,
      importedBy: batch.imported_by,
      summary
    }
  });
});

app.get('/api/progress/manual-import/:batchId/rows', requireAuth, requirePage('progressRefresh'), requireSystemOwner, (req, res) => {
  const batch = get('SELECT id, status FROM manual_progress_import_batches WHERE id = ?', [req.params.batchId]);
  if (!batch) return res.status(404).json({ error: '导入批次不存在' });
  res.json({ batchId: batch.id, status: batch.status, rows: manualProgressPreviewRows(batch.id, 500) });
});

app.get('/api/progress/manual-import/:batchId/export', requireAuth, requirePage('progressRefresh'), requireSystemOwner, async (req, res) => {
  const batch = get('SELECT * FROM manual_progress_import_batches WHERE id = ?', [req.params.batchId]);
  if (!batch) return res.status(404).json({ error: '导入批次不存在' });
  const rows = all('SELECT * FROM manual_progress_rows WHERE batch_id = ? ORDER BY source_row_no', [batch.id]);
  const headers = [
    '源行号', '数据状态', '校验状态', '校验说明', '冲突字段', '采购订单号', 'OA备货流程号',
    '事业部', '供应商简称', '采购下单人', '采购组', '产品线', '系列', '物料编码', 'SKU', '物料名称',
    '手工未交付数量', '未备料未生产', '已备料未生产', '生产中产品', '完工未发产品', '手工已发货数量',
    '合同约定交期', '生产中交付时间', '未生产预计交付时间', '是否正常履约', '未履约原因', '原因详情', '备注',
    '候选采购订单', '确认采购订单', '确认人', '确认时间', '删除人', '删除时间', '删除原因'
  ];
  const aoa = [headers, ...rows.map((row) => [
    numberValue(row.source_row_no), row.data_status, row.validation_status, row.validation_message,
    parseJson(row.conflict_fields_json, []).join('、'), row.order_no, row.oa_flow_no,
    row.business_unit, row.supplier_short_name, row.purchase_owner, row.purchase_group,
    row.product_line, row.product_series, row.material_code, row.sku, row.material_name,
    numberValue(row.manual_remaining_qty), numberValue(row.unprepared_qty), numberValue(row.prepared_not_started_qty),
    numberValue(row.in_production_qty), numberValue(row.finished_qty), numberValue(row.source_shipped_qty),
    row.source_contract_delivery_date, row.production_delivery_date, row.unproduced_estimated_delivery_date,
    row.fulfillment_status, row.unfulfilled_reason, row.reason_detail, row.remark,
    parseJson(row.candidate_json, []).map((candidate) => `${candidate.orderNo || '无订单'}|${candidate.demandKey}`).join('；'),
    row.confirmed_order_no, row.confirmed_by, row.confirmed_at, row.deleted_by, row.deleted_at, row.delete_reason
  ])];
  const allocations = all(
    `SELECT * FROM manual_progress_allocations WHERE batch_id = ? ORDER BY source_row_no, order_no`,
    [batch.id]
  );
  const allocationAoa = [[
    '源行号', '采购订单号', '物料编码', '需求键', '匹配状态', '匹配说明', '是否关闭',
    '采购数量', '累计入库数量', '剩余入库数量', '分配未备料未生产', '分配已备料未生产',
    '分配生产中产品', '分配完工未发产品', '是否当前应用'
  ], ...allocations.map((row) => [
    numberValue(row.source_row_no), row.order_no, row.material_code, row.demand_key,
    row.match_status, row.match_reason, row.is_closed ? '是' : '否', numberValue(row.order_qty),
    numberValue(row.inbound_qty), numberValue(row.remaining_qty), numberValue(row.allocated_unprepared_qty),
    numberValue(row.allocated_prepared_qty), numberValue(row.allocated_in_production_qty),
    numberValue(row.allocated_finished_qty), row.active ? '是' : '否'
  ])];
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(aoa), '手工导入明细');
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(allocationAoa), '采购订单分配明细');
  const buffer = Buffer.from(await buildStyledExcelBuffer(xlsx, workbook));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="manual-progress.xlsx"; filename*=UTF-8''${encodeURIComponent(`手工登记表校验_${batch.applied_at || batch.imported_at}.xlsx`)}`);
  res.send(buffer);
});

app.post('/api/progress/clear-preview', requireAuth, requirePage('progressRefresh'), requireSystemOwner, (req, res) => {
  try {
    const filters = progressClearFilters(req.body);
    const preview = progressClearPreview(req.user, filters);
    req.auditTarget = `${preview.matchedDemands} 条需求`;
    req.auditDetails = `筛选条件：${JSON.stringify(filters)}；当前跟单 ${preview.currentProgressCount} 条；历史快照 ${preview.snapshotCount} 条`;
    res.json({ filters, ...preview });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '清除范围预览失败' });
  }
});

app.post('/api/progress/clear', requireAuth, requirePage('progressRefresh'), requireSystemOwner, (req, res) => {
  try {
    const filters = progressClearFilters(req.body);
    const preview = progressClearPreview(req.user, filters);
    const expectedCount = Math.max(0, Math.floor(numberValue(req.body.expectedCount)));
    const expectedCurrentProgressCount = Math.max(0, Math.floor(numberValue(req.body.expectedCurrentProgressCount)));
    const expectedSnapshotCount = Math.max(0, Math.floor(numberValue(req.body.expectedSnapshotCount)));
    if (req.body.confirmation !== 'CLEAR_PROGRESS') {
      return res.status(400).json({ error: '缺少清除确认标识' });
    }
    if (expectedCount !== preview.matchedDemands
      || expectedCurrentProgressCount !== preview.currentProgressCount
      || expectedSnapshotCount !== preview.snapshotCount) {
      return res.status(409).json({ error: '清除范围已变化，请重新预览后再确认' });
    }
    const selectedRows = progressClearSelection(req.user, filters);
    const demandKeys = [...new Set(selectedRows.map((row) => normalize(row.underlyingDemandKey || row.demandKey)).filter(Boolean))];
    const followupKeys = [...new Set(selectedRows.map((row) => normalize(row.followupKey)).filter(Boolean))];
    transaction(() => {
      runMany('DELETE FROM supplier_progress WHERE demand_key = ?', demandKeys.map((key) => [key]));
      runMany('DELETE FROM supplier_progress_snapshots WHERE demand_key = ?', demandKeys.map((key) => [key]));
      runMany('DELETE FROM production_order_followups WHERE tracking_key = ?', followupKeys.map((key) => [key]));
      runMany('DELETE FROM production_order_followups WHERE demand_key = ?', demandKeys.map((key) => [key]));
    });
    req.auditTarget = `${preview.matchedDemands} 条需求`;
    req.auditDetails = `筛选条件：${JSON.stringify(filters)}；清除当前跟单 ${preview.currentProgressCount} 条；清除历史快照 ${preview.snapshotCount} 条`;
    res.json({
      clearedDemands: preview.matchedDemands,
      clearedCurrentProgress: preview.currentProgressCount,
      clearedSnapshots: preview.snapshotCount
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '清除生产跟进数据失败' });
  }
});

function updateManualProgressGroup(req, res, manualRowId, saveRequest) {
  const firstDbRow = get('SELECT * FROM manual_progress_rows WHERE id = ? AND active = 1', [manualRowId]);
  if (!firstDbRow) return res.status(404).json({ error: '手工跟单明细不存在或已被新快照替换' });
  const first = manualProgressDbModel(firstDbRow);
  const groupDbRows = all(
    `SELECT * FROM manual_progress_rows
     WHERE batch_id = ? AND group_key = ? AND active = 1
     ORDER BY source_row_no`,
    [first.batchId, first.groupKey]
  );
  const system = first.demandKey ? get('SELECT * FROM order_demands WHERE demand_key = ? AND active = 1', [first.demandKey]) : null;
  if (system) {
    const creator = oldCreatorsForDemand(system.demand_key);
    const enriched = enrichDemandFields(system.supplier, system.material_code, creator);
    if (!canEditDemand(req.user, { ...system, purchase_owner: enriched.purchaseOwner })) {
      return res.status(403).json({ error: '没有该采购订单物料的维护权限' });
    }
  } else if (req.user.role !== ROLE_ADMIN && !splitDelimited(first.purchaseOwner).includes(normalize(req.user.name))) {
    return res.status(403).json({ error: '没有该手工记录的维护权限' });
  }
  const orderQty = system ? systemOrderQuantities(first.demandKey, first.orderNo, first.materialCode) : null;
  const allocationSummary = get(
    `SELECT COUNT(*) AS count, SUM(CASE WHEN a.is_closed = 0 THEN a.remaining_qty ELSE 0 END) AS total
     FROM manual_progress_allocations a
     JOIN manual_progress_rows r ON r.id = a.source_row_id
     WHERE r.batch_id = ? AND r.group_key = ? AND r.active = 1`,
    [first.batchId, first.groupKey]
  );
  const allocationRemaining = numberValue(allocationSummary?.total);
  const remaining = numberValue(allocationSummary?.count) > 0
    ? allocationRemaining
    : orderQty
    ? Math.max(orderQty.remainingQty, 0)
    : system
      ? Math.max(numberValue(system.tracking_remaining_qty), 0)
      : groupDbRows.reduce((sum, row) => sum + numberValue(row.manual_remaining_qty), 0);
  const requestedUnprepared = progressQuantityValue(req.body.unpreparedQty, 0, '未备料未生产');
  const prepared = progressQuantityValue(req.body.preparedNotStartedQty, 0, '已备料未生产');
  const inProduction = progressQuantityValue(req.body.inProductionQty, 0, '生产中产品');
  const finished = progressQuantityValue(req.body.finishedQty, 0, '完工未发产品');
  if (![requestedUnprepared, prepared, inProduction, finished].every(Number.isInteger)) {
    return res.status(400).json({ error: '手工登记表阶段数量必须是整数' });
  }
  const stageTotalQty = requestedUnprepared + prepared + inProduction + finished;
  if (Math.abs(stageTotalQty - remaining) > 0.000001) {
    return res.status(400).json({ error: '未备料未生产、已备料未生产、生产中产品、完工未发产品合计必须等于未交付数量' });
  }
  const unprepared = requestedUnprepared;
  const fulfillmentStatus = normalize(req.body.fulfillmentStatus);
  if (fulfillmentStatus && !['是', '否'].includes(fulfillmentStatus)) {
    return res.status(400).json({ error: '是否正常履约只能选择“是”或“否”' });
  }
  const unfulfilledReason = normalize(req.body.unfulfilledReason);
  if (fulfillmentStatus === '否' && !unfulfilledReason) {
    return res.status(400).json({ error: '非正常履约必须填写未履约原因' });
  }
  const values = {
    unprepared,
    prepared,
    inProduction,
    finished,
    productionDeliveryDate: progressDateValue(req.body.productionDeliveryDate, '生产中交付时间'),
    unproducedEstimatedDeliveryDate: progressDateValue(req.body.unproducedEstimatedDeliveryDate, '未生产预计交付时间'),
    fulfillmentStatus,
    unfulfilledReason,
    reasonDetail: normalize(req.body.reasonDetail),
    remark: normalize(req.body.remark)
  };
  const now = nowText();
  const trackingKey = `manual:${first.id}:${encodeURIComponent(first.orderNo || first.groupKey)}`;
  if (normalize(req.body.trackingKey) && normalize(req.body.trackingKey) !== trackingKey) {
    return res.status(400).json({ error: '手工跟进订单标识不匹配' });
  }
  let followupResult;
  transaction(() => {
    run(
      `UPDATE manual_progress_rows
       SET unprepared_qty = ?, prepared_not_started_qty = ?, in_production_qty = ?, finished_qty = ?,
           production_delivery_date = ?, unproduced_estimated_delivery_date = ?, fulfillment_status = ?,
           unfulfilled_reason = ?, reason_detail = ?, remark = ?, conflict_fields_json = '[]',
           validation_status = 'valid', validation_message = '', updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [
        values.unprepared, values.prepared, values.inProduction, values.finished,
        values.productionDeliveryDate, values.unproducedEstimatedDeliveryDate, values.fulfillmentStatus,
        values.unfulfilledReason, values.reasonDetail, values.remark, req.user.name, now, first.id
      ]
    );
    run(
      `UPDATE manual_progress_rows
       SET unprepared_qty = 0, prepared_not_started_qty = 0, in_production_qty = 0, finished_qty = 0,
           production_delivery_date = '', unproduced_estimated_delivery_date = '', fulfillment_status = '',
           unfulfilled_reason = '', reason_detail = '', remark = '', conflict_fields_json = '[]',
           validation_status = 'valid', validation_message = '', updated_by = ?, updated_at = ?
       WHERE batch_id = ? AND group_key = ? AND active = 1 AND id <> ?`,
      [req.user.name, now, first.batchId, first.groupKey, first.id]
    );
    reconcileActiveManualProgress(req.user.name, now);
    followupResult = saveProductionOrderFollowup({
      trackingKey,
      demandKey: first.demandKey,
      orderNo: first.orderNo,
      materialCode: first.materialCode,
      fulfillmentRemark: req.body.fulfillmentRemark,
      user: req.user
    });
    saveProgressRequest({
      requestId: saveRequest.requestId,
      userId: req.user.id,
      trackingKey,
      demandKey: first.demandKey,
      orderNo: first.orderNo,
      savedAt: now
    });
  });
  req.auditTarget = first.orderNo || first.oaFlowNo || `源行 ${first.sourceRowNo}`;
  req.auditDetails = `更新手工生产跟进组 ${first.groupKey}；请求 ${saveRequest.requestId}`;
  return res.json(progressSavePayload(saveRequest, {
    trackingKey,
    demandKey: first.demandKey,
    orderNo: first.orderNo,
    savedAt: now,
    ...followupResult
  }));
}

app.patch('/api/progress/:demandKey', requireAuth, requirePage('progressRefresh'), (req, res) => {
  let saveRequest;
  try {
    saveRequest = progressSaveRequest(req);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || '提交请求标识无效' });
  }
  if (saveRequest.existing) {
    req.auditTarget = saveRequest.existing.order_no || saveRequest.existing.demand_key;
    req.auditDetails = `服务器已确认该请求，未重复写入；请求 ${saveRequest.requestId}`;
    const submittingUser = get('SELECT role FROM users WHERE id = ?', [saveRequest.existing.user_id]);
    const replayTrackingKey = normalize(saveRequest.existing.tracking_key).startsWith('manual:')
      ? normalize(saveRequest.existing.tracking_key)
      : progressFollowupTrackingKey(
        saveRequest.existing.demand_key,
        saveRequest.existing.order_no,
        productionFollowupMaterialCode(saveRequest.existing)
      );
    return res.json(progressSavePayload(saveRequest, {
      followupMarkedBySubmission: normalize(submittingUser?.role) === ROLE_USER,
      ...productionFollowupPayload(replayTrackingKey)
    }, true));
  }
  if (String(req.params.demandKey).startsWith('manual:')) {
    return updateManualProgressGroup(req, res, String(req.params.demandKey).slice('manual:'.length).split(':')[0], saveRequest);
  }
  const demand = get('SELECT * FROM order_demands WHERE demand_key = ?', [req.params.demandKey]);
  if (!demand) return res.status(404).json({ error: '需求不存在' });
  const orderNo = normalize(req.body.orderNo);
  const trackingKey = progressFollowupTrackingKey(demand.demand_key, orderNo, demand.material_code);
  const legacyTrackingKey = progressFollowupTrackingKey(demand.demand_key, orderNo);
  if (![trackingKey, legacyTrackingKey].includes(normalize(req.body.trackingKey))) {
    return res.status(400).json({ error: '采购订单跟进标识不匹配' });
  }
  if (orderNo && !get(
    `SELECT 1 AS found
     FROM kingdee_orders
     WHERE batch_id = ? AND demand_key = ? AND order_no = ?
     LIMIT 1`,
    [demand.source_batch_id, demand.demand_key, orderNo]
  )) {
    return res.status(400).json({ error: '当前采购订单不存在，无法提交跟进' });
  }
  const progress = progressForDemand(demand.demand_key);
  const orderCreator = oldCreatorsForDemand(demand.demand_key);
  const enriched = enrichDemandFields(demand.supplier, demand.material_code, orderCreator);
  if (!canEditDemand(req.user, { ...demand, order_creator: orderCreator, purchase_owner: enriched.purchaseOwner })) {
    return res.status(403).json({ error: '没有该供应商物料的刷新权限' });
  }
  const orderQty = orderNo ? systemOrderQuantities(demand.demand_key, orderNo, demand.material_code) : null;
  const purchaseOrderInboundQty = orderQty
    ? numberValue(orderQty.inboundQty)
    : numberValue(demand.tracking_inbound_qty);
  const remainingInboundQty = orderQty
    ? Math.max(numberValue(orderQty.remainingQty), 0)
    : Math.max(numberValue(demand.tracking_remaining_qty), 0);
  const requestedUnprepared = progressQuantityValue(req.body.unpreparedQty, progress.unprepared_qty, '未备料未生产');
  const preparedNotStarted = progressQuantityValue(req.body.preparedNotStartedQty, progress.prepared_not_started_qty, '已备料未生产');
  const inProduction = progressQuantityValue(req.body.inProductionQty, progress.in_production_qty, '生产中产品');
  const finished = progressQuantityValue(req.body.finishedQty, progress.finished_qty, '完工未发产品');
  const stageTotalQty = requestedUnprepared + preparedNotStarted + inProduction + finished;
  if (Math.abs(stageTotalQty - remainingInboundQty) > 0.000001) {
    return res.status(400).json({ error: '未备料未生产、已备料未生产、生产中产品、完工未发产品合计必须等于未交付数量' });
  }
  const unprepared = requestedUnprepared;
  const fulfillmentStatus = normalize(req.body.fulfillmentStatus ?? progress.fulfillment_status);
  if (fulfillmentStatus && !['是', '否'].includes(fulfillmentStatus)) {
    return res.status(400).json({ error: '是否正常履约只能选择“是”或“否”' });
  }
  const unfulfilledReason = normalize(req.body.unfulfilledReason ?? progress.unfulfilled_reason);
  if (fulfillmentStatus === '否' && !unfulfilledReason) {
    return res.status(400).json({ error: '非正常履约必须填写未履约原因' });
  }
  const values = {
    unprepared,
    preparedNotStarted,
    inProduction,
    finished,
    shipped: purchaseOrderInboundQty,
    productionDeliveryDate: progressDateValue(req.body.productionDeliveryDate ?? progress.production_delivery_date, '生产中交付时间'),
    unproducedEstimatedDeliveryDate: progressDateValue(req.body.unproducedEstimatedDeliveryDate ?? progress.unproduced_estimated_delivery_date, '未生产预计交付时间'),
    fulfillmentStatus,
    unfulfilledReason,
    reasonDetail: normalize(req.body.reasonDetail ?? progress.reason_detail),
    remark: normalize(req.body.remark ?? progress.remark)
  };
  const now = nowText();
  let followupResult;
  transaction(() => {
    run(
      `INSERT INTO supplier_progress (
         demand_key, unprepared_qty, prepared_not_started_qty, in_production_qty, finished_qty, shipped_qty,
         production_delivery_date, unproduced_estimated_delivery_date, fulfillment_status,
         unfulfilled_reason, reason_detail, remark, updated_by, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(demand_key) DO UPDATE SET
         unprepared_qty = excluded.unprepared_qty,
         prepared_not_started_qty = excluded.prepared_not_started_qty,
         in_production_qty = excluded.in_production_qty,
         finished_qty = excluded.finished_qty,
         shipped_qty = excluded.shipped_qty,
         production_delivery_date = excluded.production_delivery_date,
         unproduced_estimated_delivery_date = excluded.unproduced_estimated_delivery_date,
         fulfillment_status = excluded.fulfillment_status,
         unfulfilled_reason = excluded.unfulfilled_reason,
         reason_detail = excluded.reason_detail,
         remark = excluded.remark,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
      [
        demand.demand_key, values.unprepared, values.preparedNotStarted, values.inProduction, values.finished, values.shipped,
        values.productionDeliveryDate, values.unproducedEstimatedDeliveryDate, values.fulfillmentStatus,
        values.unfulfilledReason, values.reasonDetail, values.remark, req.user.name, now
      ]
    );
    run(
      `INSERT INTO supplier_progress_snapshots (
         id, demand_key, unprepared_qty, prepared_not_started_qty, in_production_qty, finished_qty, shipped_qty,
         production_delivery_date, unproduced_estimated_delivery_date, fulfillment_status,
         unfulfilled_reason, reason_detail, remark, updated_by, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(), demand.demand_key, values.unprepared, values.preparedNotStarted, values.inProduction, values.finished, values.shipped,
        values.productionDeliveryDate, values.unproducedEstimatedDeliveryDate, values.fulfillmentStatus,
        values.unfulfilledReason, values.reasonDetail, values.remark, req.user.name, now
      ]
    );
    followupResult = saveProductionOrderFollowup({
      trackingKey,
      demandKey: demand.demand_key,
      orderNo,
      materialCode: demand.material_code,
      fulfillmentRemark: req.body.fulfillmentRemark,
      user: req.user
    });
    saveProgressRequest({
      requestId: saveRequest.requestId,
      userId: req.user.id,
      trackingKey,
      demandKey: demand.demand_key,
      orderNo,
      savedAt: now
    });
  });
  req.auditTarget = orderNo || demand.demand_key;
  req.auditDetails = `提交生产跟进；请求 ${saveRequest.requestId}`;
  res.json(progressSavePayload(saveRequest, {
    trackingKey,
    demandKey: demand.demand_key,
    orderNo,
    savedAt: now,
    ...followupResult
  }));
});

app.get('/api/diffs', requireAuth, requirePage('progressRefresh'), (req, res) => {
  res.json({ rows: all('SELECT * FROM demand_snapshot_diffs ORDER BY created_at DESC LIMIT 500') });
});

app.get('/api/difference-allocations', requireAuth, requirePage('progressRefresh'), (req, res) => {
  const sessionId = normalize(req.query.sessionId);
  res.json({ rows: allocationRows(sessionId), actions: DIFF_ALLOCATION_ACTIONS, reasons: DIFF_ALLOCATION_REASONS });
});

app.get('/api/difference-allocations/latest', requireAuth, requirePage('progressRefresh'), (req, res) => {
  res.json(latestComparePayload(req.user));
});

app.get('/api/difference-allocations/unassigned-purchase-orders', requireAuth, requirePage('progressRefresh'), (req, res) => {
  const pageSize = Math.min(100, Math.max(1, Math.floor(numberValue(req.query.pageSize) || 20)));
  const requestedPage = Math.max(1, Math.floor(numberValue(req.query.page) || 1));
  const allRows = unassignedPurchaseOrderRows();
  const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
  const page = Math.min(requestedPage, totalPages);
  res.json({
    rows: allRows.slice((page - 1) * pageSize, page * pageSize),
    total: allRows.length,
    page,
    pageSize,
    totalPages
  });
});

app.get('/api/difference-allocations/unassigned-purchase-orders/export', requireAuth, requirePage('progressRefresh'), async (req, res) => {
  const rows = unassignedPurchaseOrderRows();
  const headers = ['采购组织', '供应商', '创建人', '采购日期', '采购订单号', '物料编码', '物料名称', '原采购数量', '新采购数量'];
  const aoa = [headers, ...rows.map((row) => [
    row.purchaseOrg,
    row.supplier,
    row.creator,
    row.purchaseDate,
    row.orderNo,
    row.materialCode,
    row.materialName,
    row.oldPurchaseQty,
    row.newPurchaseQty
  ])];
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.aoa_to_sheet(aoa);
  worksheet['!cols'] = [18, 36, 14, 16, 18, 18, 42, 14, 14].map((wch) => ({ wch }));
  xlsx.utils.book_append_sheet(workbook, worksheet, '未分配采购下单人明细');
  const buffer = Buffer.from(await buildStyledExcelBuffer(xlsx, workbook));
  const fileName = '未分配采购下单人明细.xlsx';
  res.setHeader('Content-Disposition', `attachment; filename="unassigned-purchase-owner-details.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

app.post('/api/difference-allocations/compare', requireAuth, requirePage('progressRefresh'), upload.single('file'), (req, res) => {
  const requestMapping = parseJson(req.body.mapping, {});
  const mapping = Object.keys(requestMapping).length ? requestMapping : savedMapping('kingdee');
  const sheetName = normalize(req.body.sheetName);
  const parsed = workbookRows(req.file, sheetName || null, { includePreviews: false });
  const result = mappedKingdeeRows(parsed.rows, mapping);
  const summary = summarizeDemands(result.rows);
  const { sessionId, rows } = persistDifferenceCompare({ file: req.file, sheetName, mapping, parsed, result, summary, user: req.user });
  const status = allocationStatus(sessionId);
  res.json({
    sessionId,
    actions: DIFF_ALLOCATION_ACTIONS,
    fileName: safeFilename(req.file),
    totalRows: parsed.rows.length,
    validRows: result.validRows,
    skippedRows: result.skippedRows,
    skipped: result.skipped.slice(0, 10),
    diffRows: rows,
    allocations: allocationRows(sessionId),
    reasons: DIFF_ALLOCATION_REASONS,
    status
  });
});

function saveDifferenceAllocation({ sessionId, row, user, actionType, reason, remark = '' }) {
  if ((row.handling_type || 'pending') !== 'pending') {
    const error = new Error('该采购订单变化已由系统自动记录，无需人工分配');
    error.status = 400;
    throw error;
  }
  const existingDemand = get('SELECT * FROM order_demands WHERE demand_key = ?', [row.demand_key]);
  const orderCreator = row.order_creator || oldCreatorsForDemand(row.demand_key);
  const enriched = enrichDemandFields(row.supplier, row.material_code, orderCreator);
  const permissionDemand = existingDemand
    ? { ...existingDemand, order_creator: orderCreator, purchase_owner: enriched.purchaseOwner }
    : { purchase_owner: enriched.purchaseOwner, order_creator: orderCreator, supplier: row.supplier, material_code: row.material_code };
  if (!canEditDemand(user, permissionDemand)) {
    const error = new Error('没有该供应商物料的分配权限');
    error.status = 403;
    throw error;
  }
  const finalActionType = normalize(actionType);
  const rawReason = normalize(reason);
  const finalReason = rawReason === DIFF_LEGACY_ORDER_COMPLETE_REASON ? DIFF_ORDER_COMPLETE_REASON : rawReason;
  const finalRemark = normalize(remark);
  const requiredQty = Math.abs(numberValue(row.delta_qty));
  const availableActions = allocationActionsForReason(row.delta_qty, finalReason);
  if (!availableActions.includes(finalActionType)) {
    const error = new Error(`当前差异只能选择：${availableActions.join('、')}`);
    error.status = 400;
    throw error;
  }
  if (!DIFF_ALLOCATION_REASONS.includes(finalReason)) {
    const error = new Error('请选择有效的分配原因');
    error.status = 400;
    throw error;
  }
  const now = nowText();
  run('DELETE FROM difference_allocations WHERE session_id = ? AND row_id = ?', [sessionId, row.id]);
  run(
    `INSERT INTO difference_allocations (id, session_id, row_id, demand_key, action_type, allocated_qty, reason, remark, old_order_nos, new_order_nos, old_qty, new_qty, delta_qty, progress_total, stock_qty, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), sessionId, row.id, row.demand_key, finalActionType, requiredQty, finalReason, finalRemark, row.old_order_nos || '', row.new_order_nos || '', row.old_qty, row.new_qty, row.delta_qty, row.progress_total, row.stock_qty, user.name, now]
  );
}

app.post('/api/difference-allocations/:sessionId/rows/:rowId', requireAuth, requirePage('progressRefresh'), (req, res) => {
  const session = get('SELECT * FROM difference_compare_sessions WHERE id = ?', [req.params.sessionId]);
  if (!session) return res.status(404).json({ error: '比对会话不存在' });
  const row = get('SELECT * FROM difference_compare_rows WHERE id = ? AND session_id = ?', [req.params.rowId, req.params.sessionId]);
  if (!row) return res.status(404).json({ error: '差异行不存在' });
  const requiredQty = Math.abs(numberValue(row.delta_qty));
  if (numberValue(req.body.allocatedQty) !== requiredQty) return res.status(400).json({ error: `分配数量必须等于差异数量 ${requiredQty}` });
  try {
    transaction(() => saveDifferenceAllocation({
      sessionId: req.params.sessionId,
      row,
      user: req.user,
      actionType: req.body.actionType,
      reason: req.body.reason,
      remark: req.body.remark
    }));
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || '差异分配失败' });
  }
  res.json({ rows: allocationRows(req.params.sessionId), status: allocationStatus(req.params.sessionId) });
});

app.post('/api/difference-allocations/:sessionId/bulk-normal', requireAuth, requirePage('progressRefresh'), (req, res) => {
  const session = get('SELECT * FROM difference_compare_sessions WHERE id = ?', [req.params.sessionId]);
  if (!session) return res.status(404).json({ error: '比对会话不存在' });
  const rowIds = Array.isArray(req.body.rowIds) ? req.body.rowIds.map(normalize).filter(Boolean) : [];
  if (!rowIds.length) return res.status(400).json({ error: '请选择要提交的差异行' });
  const placeholders = rowIds.map(() => '?').join(',');
  const rows = all(`SELECT * FROM difference_compare_rows WHERE session_id = ? AND id IN (${placeholders})`, [req.params.sessionId, ...rowIds]);
  if (!rows.length) return res.status(404).json({ error: '未找到可提交的差异行' });
  try {
    transaction(() => {
      rows.forEach((row) => {
        saveDifferenceAllocation({
          sessionId: req.params.sessionId,
          row,
          user: req.user,
          actionType: DIFF_NORMAL_ORDER,
          reason: DIFF_NORMAL_ORDER,
          remark: normalize(req.body.remark)
        });
      });
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || '批量提交失败' });
  }
  res.json({ updated: rows.length, rows: allocationRows(req.params.sessionId), status: allocationStatus(req.params.sessionId) });
});

app.post('/api/difference-allocations/:sessionId/apply', requireAuth, requirePage('progressRefresh'), (req, res) => {
  const session = get('SELECT * FROM difference_compare_sessions WHERE id = ?', [req.params.sessionId]);
  if (!session) return res.status(404).json({ error: '比对会话不存在' });
  if (session.status === 'applied' || session.status === 'snapshot_applied') return res.status(400).json({ error: '该快照已经应用' });
  const status = allocationStatus(req.params.sessionId);
  if (!status.complete) return res.status(400).json({ error: '所有差异分配完成后才能应用新快照' });
  const summary = parseJson(session.summary_json, []);
  const sourceRows = parseJson(session.source_rows_json, []);
  const mapping = parseJson(session.mapping_json, {});
  const baselineRows = sessionBaselineRows(req.params.sessionId, summary);
  const diffs = computeSessionDiffs(baselineRows, summary);
  const now = nowText();
  let batchId = '';
  transaction(() => {
    batchId = applyKingdeeSnapshot({ fileName: session.file_name, sourceRows, summary, diffs, mapping, userName: req.user.name, now, skippedRows: numberValue(session.skipped_rows), skipped: [] });
    run('UPDATE difference_compare_sessions SET status = ?, applied_batch_id = ?, applied_at = ?, new_applied_at = ? WHERE id = ?', ['applied', batchId, now, now, req.params.sessionId]);
  });
  res.json({ batchId, status: { ...allocationStatus(req.params.sessionId), applied: true }, demands: demandRows(false, req.user) });
});

function currentProductArchive() {
  const productSource = get(
    'SELECT file_name, sheet_name, uploaded_by, updated_at, applied FROM dimension_files WHERE slot_id = ?',
    ['productCategory']
  );
  const feedbackSources = [1, 2, 3, 5, 6, 7, 8].map((slotNumber) => {
    const slotId = `businessUnitFeedback${slotNumber}`;
    const record = get(
      'SELECT file_name, uploaded_by, updated_at, applied, rows_json FROM dimension_files WHERE slot_id = ?',
      [slotId]
    );
    return {
      slotId,
      title: DIMENSION_SLOTS[slotId],
      fileName: record?.file_name || '',
      uploadedBy: record?.uploaded_by || '',
      updatedAt: record?.updated_at || '',
      applied: Boolean(record?.applied),
      rows: record?.applied ? parseJson(record.rows_json, []) : []
    };
  });
  const archive = buildProductArchive({
    productRows: getDimensionRows('productCategory'),
    feedbackSources
  });
  return {
    ok: true,
    ...archive,
    source: {
      slotId: 'productCategory',
      title: DIMENSION_SLOTS.productCategory,
      fileName: productSource?.file_name || '',
      sheetName: productSource?.sheet_name || '',
      uploadedBy: productSource?.uploaded_by || '',
      updatedAt: productSource?.updated_at || '',
      applied: Boolean(productSource?.applied)
    },
    generatedAt: new Date().toISOString()
  };
}

const PRODUCT_PROJECT_FILE_MAPPING = Object.freeze({
  projectName: 'projectName',
  businessUnit: 'businessUnit',
  productPositioning: 'productPositioning',
  projectStage: 'projectStage',
  owner: 'owner',
  plannedLaunchDate: 'plannedLaunchDate',
  projectStatus: 'projectStatus',
  remark: 'remark',
  materialCode: 'materialCode',
  sku: 'sku',
  modifiedAt: 'modifiedAt',
  priority: 'priority',
  innovationType: 'innovationType',
  responsibilityDepartment: 'responsibilityDepartment',
  technicalContact: 'technicalContact',
  supplyChainContact: 'supplyChainContact',
  manufacturer: 'manufacturer',
  projectType: 'projectType',
  productLine: 'productLine',
  demandInitiationDate: 'demandInitiationDate',
  weeklyMeetingTitle: 'weeklyMeetingTitle',
  weeklyMeetingNote: 'weeklyMeetingNote'
});

function currentProductProjectFileData() {
  const record = get(
    'SELECT file_name, sheet_name, uploaded_by, updated_at, applied, rows_json FROM dimension_files WHERE slot_id = ?',
    [PRODUCT_PROJECT_SLOT_ID]
  );
  if (!record?.applied) return null;
  const sourceRows = parseJson(record.rows_json, []);
  const records = sourceRows.map((row, index) => ({
    id: `file-${index + 1}`,
    createdTime: record.updated_at,
    lastModifiedTime: row.modifiedAt || record.updated_at,
    fields: {
      projectName: row.projectName,
      businessUnit: row.businessUnit,
      productPositioning: row.productPositioning,
      projectStage: row.projectStage,
      owner: row.owner,
      plannedLaunchDate: row.plannedLaunchDate,
      projectStatus: row.projectStatus,
      remark: row.remark,
      materialCode: row.materialCode,
      sku: row.sku,
      modifiedAt: row.modifiedAt,
      priority: row.priority,
      innovationType: row.innovationType,
      responsibilityDepartment: row.responsibilityDepartment,
      technicalContact: row.technicalContact,
      supplyChainContact: row.supplyChainContact,
      manufacturer: row.manufacturer,
      projectType: row.projectType,
      productLine: row.productLine,
      demandInitiationDate: row.demandInitiationDate,
      weeklyMeetingTitle: row.weeklyMeetingTitle,
      weeklyMeetingNote: row.weeklyMeetingNote
    }
  }));
  const normalized = normalizeProjectRecords(records, PRODUCT_PROJECT_FILE_MAPPING);
  return {
    rows: normalized.rows,
    report: normalized.report,
    source: {
      sourceType: 'file',
      slotId: PRODUCT_PROJECT_SLOT_ID,
      fileName: record.file_name || '',
      sheetName: record.sheet_name || '',
      uploadedBy: record.uploaded_by || '',
      updatedAt: record.updated_at || '',
      configured: true
    }
  };
}

function dingTalkEnvironmentStatus() {
  return {
    appCredentialsConfigured: Boolean(process.env.DINGTALK_APP_KEY && process.env.DINGTALK_APP_SECRET),
    operatorConfigured: Boolean(process.env.DINGTALK_OPERATOR_ID)
  };
}

function currentProductProjectSettings() {
  const row = get('SELECT * FROM product_project_settings WHERE setting_key = ?', ['dingTalk']);
  return {
    documentReference: row?.document_reference || '',
    baseId: row?.base_id || '',
    sheetId: row?.sheet_id || '',
    sheetName: row?.sheet_name || '',
    mapping: parseJson(row?.mapping_json, {}),
    currentRunId: row?.current_run_id || '',
    updatedBy: row?.updated_by || '',
    updatedAt: row?.updated_at || '',
    ...dingTalkEnvironmentStatus()
  };
}

function saveProductProjectSettings(input, userName) {
  const documentReference = normalize(input.documentReference);
  const baseId = normalize(input.baseId) || extractDingTalkBaseId(documentReference);
  const sheetId = normalize(input.sheetId);
  const sheetName = normalize(input.sheetName);
  if (!baseId) throw Object.assign(new Error('请填写钉钉AI表格ID'), { status: 400 });
  if (!sheetId) throw Object.assign(new Error('请选择研发项目数据表'), { status: 400 });
  const mapping = normalizeProjectMapping(input.mapping || {});
  const now = nowText();
  run(
    `INSERT INTO product_project_settings (
       setting_key, document_reference, base_id, sheet_id, sheet_name, mapping_json, current_run_id, updated_by, updated_at
     ) VALUES ('dingTalk', ?, ?, ?, ?, ?, '', ?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET
       document_reference = excluded.document_reference,
       base_id = excluded.base_id,
       sheet_id = excluded.sheet_id,
       sheet_name = excluded.sheet_name,
       mapping_json = excluded.mapping_json,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
    [documentReference, baseId, sheetId, sheetName, JSON.stringify(mapping), normalize(userName), now]
  );
  saveDatabase();
  return currentProductProjectSettings();
}

function dingTalkProjectClient() {
  return createDingTalkProjectClient({
    appKey: process.env.DINGTALK_APP_KEY,
    appSecret: process.env.DINGTALK_APP_SECRET,
    operatorId: process.env.DINGTALK_OPERATOR_ID
  });
}

function databaseProjectRows(runId) {
  if (!runId) return [];
  return all('SELECT * FROM product_project_rows WHERE run_id = ? ORDER BY business_unit, project_name, source_record_id', [runId]).map((row) => ({
    sourceRecordId: row.source_record_id,
    projectName: row.project_name,
    businessUnit: row.business_unit,
    productPositioning: row.product_positioning,
    projectStage: row.project_stage,
    owner: row.owner,
    plannedLaunchDate: row.planned_launch_date,
    projectStatus: row.project_status,
    remark: row.remark,
    materialCode: row.material_code,
    sku: row.sku,
    sourceModifiedAt: row.source_modified_at,
    sourceCreatedAt: row.source_created_at
  }));
}

function currentProductProjectData() {
  const fileData = currentProductProjectFileData();
  if (fileData) {
    return {
      rows: fileData.rows,
      source: fileData.source,
      sync: {
        running: false,
        currentRunId: '',
        lastSuccessAt: fileData.source.updatedAt,
        latestStatus: '文件已应用',
        latestError: '',
        report: fileData.report
      }
    };
  }
  const settings = currentProductProjectSettings();
  const currentRun = settings.currentRunId ? get('SELECT * FROM product_project_sync_runs WHERE id = ?', [settings.currentRunId]) : null;
  const latestRun = get('SELECT * FROM product_project_sync_runs ORDER BY started_at DESC LIMIT 1');
  return {
    rows: databaseProjectRows(settings.currentRunId),
    sync: {
      running: Boolean(productProjectSyncPromise),
      currentRunId: settings.currentRunId,
      lastSuccessAt: currentRun?.finished_at || '',
      latestStatus: latestRun?.status || '',
      latestError: latestRun?.status === 'failed' ? latestRun.error_message : ''
    },
    source: {
      sourceType: 'dingTalk',
      documentReference: settings.documentReference,
      baseId: settings.baseId,
      sheetId: settings.sheetId,
      sheetName: settings.sheetName,
      configured: Boolean(settings.baseId && settings.sheetId),
      appCredentialsConfigured: settings.appCredentialsConfigured,
      operatorConfigured: settings.operatorConfigured,
      updatedBy: settings.updatedBy,
      updatedAt: settings.updatedAt
    }
  };
}

let productProjectSyncPromise = null;

async function runProductProjectSync({ triggerType, userName }) {
  if (productProjectSyncPromise) throw Object.assign(new Error('研发项目正在同步，请稍后再试'), { status: 409 });
  const settings = currentProductProjectSettings();
  if (!settings.baseId || !settings.sheetId) throw Object.assign(new Error('请先保存钉钉研发项目数据源设置'), { status: 400 });
  const runId = randomUUID();
  run(
    `INSERT INTO product_project_sync_runs (id, status, trigger_type, triggered_by, started_at)
     VALUES (?, 'running', ?, ?, ?)`,
    [runId, triggerType, userName, nowText()]
  );
  saveDatabase();
  productProjectSyncPromise = (async () => {
    try {
      const fieldNames = [...new Set(Object.values(settings.mapping).map(normalize).filter(Boolean))];
      const records = await dingTalkProjectClient().listAllRecords(settings.baseId, settings.sheetId, fieldNames);
      const normalized = normalizeProjectRecords(records, settings.mapping);
      const finishedAt = nowText();
      transaction(() => {
        runMany(
          `INSERT INTO product_project_rows (
             run_id, source_record_id, project_name, business_unit, product_positioning, project_stage, owner,
             planned_launch_date, project_status, remark, material_code, sku, source_modified_at, source_created_at, raw_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          normalized.rows.map((row) => [
            runId, row.sourceRecordId, row.projectName, row.businessUnit, row.productPositioning, row.projectStage,
            row.owner, row.plannedLaunchDate, row.projectStatus, row.remark, row.materialCode, row.sku,
            row.sourceModifiedAt, row.sourceCreatedAt, row.rawJson
          ])
        );
        run(
          `UPDATE product_project_sync_runs SET status='success', finished_at=?, source_count=?, accepted_count=?,
             missing_name_count=?, duplicate_count=?, invalid_date_count=?, report_json=? WHERE id=?`,
          [finishedAt, normalized.report.sourceCount, normalized.report.acceptedCount, normalized.report.missingNameCount,
            normalized.report.duplicateCount, normalized.report.invalidDateCount, JSON.stringify(normalized.report), runId]
        );
        run("UPDATE product_project_settings SET current_run_id = ? WHERE setting_key = 'dingTalk'", [runId]);
        const retainedIds = all("SELECT id FROM product_project_sync_runs WHERE status='success' ORDER BY started_at DESC LIMIT 5").map((row) => row.id);
        if (retainedIds.length) {
          const placeholders = retainedIds.map(() => '?').join(',');
          run(`DELETE FROM product_project_rows WHERE run_id NOT IN (${placeholders})`, retainedIds);
        }
      });
      return { runId, ...normalized.report };
    } catch (error) {
      run(
        "UPDATE product_project_sync_runs SET status='failed', finished_at=?, error_message=? WHERE id=?",
        [nowText(), normalize(error.message).slice(0, 500), runId]
      );
      saveDatabase();
      throw error;
    } finally {
      productProjectSyncPromise = null;
    }
  })();
  return productProjectSyncPromise;
}

function productProjectHistory() {
  return all('SELECT * FROM product_project_sync_runs ORDER BY started_at DESC LIMIT 20').map((row) => ({
    id: row.id, status: row.status, triggerType: row.trigger_type, triggeredBy: row.triggered_by,
    startedAt: row.started_at, finishedAt: row.finished_at, sourceCount: row.source_count,
    acceptedCount: row.accepted_count, missingNameCount: row.missing_name_count,
    duplicateCount: row.duplicate_count, invalidDateCount: row.invalid_date_count, errorMessage: row.error_message
  }));
}

app.get('/api/product-archive', requireAuth, requirePage('productArchive'), (_req, res) => {
  const archive = currentProductArchive();
  const linkedCounts = new Map();
  linkProjectsToProducts(currentProductProjectData().rows, archive.rows).forEach((row) => {
    if (row.linkedProductId) linkedCounts.set(row.linkedProductId, (linkedCounts.get(row.linkedProductId) || 0) + 1);
  });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ...archive, rows: archive.rows.map((row) => ({ ...row, linkedProjectCount: linkedCounts.get(row.id) || 0 })) });
});

app.get('/api/product-projects', requireAuth, requirePage('productArchive'), (_req, res) => {
  const projectData = currentProductProjectData();
  const archive = currentProductArchive();
  const rows = linkProjectsToProducts(projectData.rows, archive.rows);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    rows,
    metrics: buildProjectMetrics(rows),
    sync: projectData.sync,
    source: projectData.source
  });
});

app.get('/api/product-projects/source-schema', requireAuth, requirePage('productArchive'), requireAdmin, async (req, res) => {
  try {
    const baseId = normalize(req.query.baseId) || extractDingTalkBaseId(req.query.documentReference);
    if (!baseId) return res.status(400).json({ error: '请填写钉钉AI表格ID或链接' });
    const client = dingTalkProjectClient();
    const sheets = await client.listSheets(baseId);
    const sheetId = normalize(req.query.sheetId);
    const fields = sheetId ? await client.listFields(baseId, sheetId) : [];
    return res.json({ baseId, sheets, fields });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || '读取钉钉数据源失败' });
  }
});

app.put('/api/product-projects/settings', requireAuth, requirePage('productArchive'), requireAdmin, (req, res) => {
  try {
    res.json(saveProductProjectSettings(req.body || {}, req.user.name));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || '保存研发项目设置失败' });
  }
});

app.post('/api/product-projects/sync', requireAuth, requirePage('productArchive'), requireAdmin, async (req, res) => {
  try {
    const result = await runProductProjectSync({ triggerType: 'manual', userName: req.user.name });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || '同步研发项目失败' });
  }
});

app.get('/api/product-projects/sync-history', requireAuth, requirePage('productArchive'), (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ rows: productProjectHistory() });
});

app.get('/api/dimensions', requireAuth, requireAnyPage(['dimensionLibrary', 'businessUnitFeedback', 'wangdianData', 'lingxingInventory', 'inventorySummaryLibrary', 'inventoryManualLibrary', 'firstMileDatabase', 'beiHuoReviewLibrary', 'fullInventoryLibrary']), (req, res) => {
  const rows = all('SELECT slot_id, title, file_name, sheet_name, sheet_names, selected_sheet_names, mapping_json, rows_json, source_file_size, applied, uploaded_by, updated_at FROM dimension_files');
  res.json({
    rows: rows.map((row) => {
      const dimensionRows = parseJson(row.rows_json, []);
      const mapping = parseJson(row.mapping_json, {});
      if (isFirstMileSlot(row.slot_id) && mapping.__firstMileSummary) {
        mapping.__firstMileSummary = { ...mapping.__firstMileSummary, owner: firstMileOwner(row.slot_id) };
      }
      const { rows_json: _rowsJson, ...safeRow } = row;
      return {
        ...safeRow,
        title: DIMENSION_SLOTS[row.slot_id] || safeRow.title,
        sheetNames: parseJson(row.sheet_names, []),
        selectedSheetNames: parseJson(row.selected_sheet_names, []),
        mapping,
        hasOriginalFile: numberValue(row.source_file_size) > 0,
        rowCount: dimensionRows.length,
        diagnostics: dimensionDiagnostics(row.slot_id, dimensionRows)
      };
    })
  });
});

app.get('/api/dimensions/:slotId/download', requireAuth, requirePage('firstMileDatabase'), (req, res) => {
  const slotId = normalize(req.params.slotId);
  if (!isFirstMileSlot(slotId)) return res.status(404).json({ error: '该槽位不支持下载原文件' });
  const record = get(
    'SELECT file_name, source_file, source_file_mime, source_file_size FROM dimension_files WHERE slot_id = ?',
    [slotId]
  );
  if (!record) return res.status(404).json({ error: '未找到已上传文件' });
  const buffer = record.source_file ? Buffer.from(record.source_file) : Buffer.alloc(0);
  if (!buffer.length || numberValue(record.source_file_size) <= 0) {
    return res.status(409).json({ error: '该文件在下载功能上线前上传，请重新上传一次后再下载原文件' });
  }
  const fileName = normalize(record.file_name) || `${DIMENSION_SLOTS[slotId] || '头程数据'}.xlsx`;
  const mimeType = normalize(record.source_file_mime) || 'application/octet-stream';
  req.auditTarget = fileName;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Content-Disposition', `attachment; filename="first-mile-file.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  return res.send(buffer);
});

app.post('/api/dimensions/:slotId/upload', requireAuth, requireAnyPage(['dimensionLibrary', 'businessUnitFeedback', 'wangdianData', 'lingxingInventory', 'inventorySummaryLibrary', 'inventoryManualLibrary', 'firstMileDatabase', 'beiHuoReviewLibrary', 'fullInventoryLibrary']), dimensionWorkbookUpload, cleanupKingdeeUpload, serializeInventoryUpload, async (req, res) => {
  const slotId = req.params.slotId;
  const baseSlotId = inventoryLibraryBaseSlotId(slotId);
  const mapping = parseJson(req.body.mapping, {});
  const sheetName = normalize(req.body.sheetName);
  const selectedSheetNames = parseJson(req.body.sheetNames, [])
    .map(normalize)
    .filter((name, index, names) => name && names.indexOf(name) === index);
  if (!isInventoryManualSlot(slotId) && baseSlotId === 'inventorySummaryFile15') {
    const sheetNames = await workbookSheetNamesFromUpload(req.file);
    if (sheetName && !sheetNames.includes(sheetName)) {
      const error = new Error('销售预测选择的工作表不存在，请重新选择');
      error.status = 400;
      error.publicMessage = error.message;
      throw error;
    }
    if (sheetNames.length > 1 && !sheetName) {
      const error = new Error('销售预测包含多个工作表，请先选择要使用的工作表');
      error.status = 400;
      error.publicMessage = error.message;
      throw error;
    }
  }
  if (!isInventoryManualSlot(slotId) && baseSlotId === 'inventorySummaryFile16') {
    const sheetNames = await workbookSheetNamesFromUpload(req.file);
    if (selectedSheetNames.length !== 2) {
      const error = new Error('库龄文件必须选择两个工作表后才能应用');
      error.status = 400;
      error.publicMessage = error.message;
      throw error;
    }
    const missingSheets = selectedSheetNames.filter((name) => !sheetNames.includes(name));
    if (missingSheets.length) {
      const error = new Error(`库龄文件选择的工作表不存在：${missingSheets.join('、')}`);
      error.status = 400;
      error.publicMessage = error.message;
      throw error;
    }
  }
  const firstMileParsed = isFirstMileSlot(slotId)
    ? parseFirstMileWorkbook(req.file, { slotId, fileName: safeFilename(req.file) })
    : null;
  const productProjectParsed = slotId === PRODUCT_PROJECT_SLOT_ID
    ? parseProductProjectWorkbook(req.file)
    : null;
  const fullInventoryParsed = slotId === 'fullInventoryFile1'
    ? parseFullInventoryWorkbook(req.file)
    : slotId === 'fullInventoryFile2'
      ? parseOrderFulfillmentWorkbook(req.file)
      : null;
  const inventorySummaryFile = (isInventorySummarySlot(baseSlotId) || isInventoryManualSlot(slotId)) && !req.file?.buffer
    ? { ...req.file, buffer: await fs.promises.readFile(req.file.path) }
    : req.file;
  const inventoryManualParsed = isInventoryManualSlot(slotId)
    ? parseInventoryManualWorkbook(inventorySummaryFile, mapping, { sheetName, slotId })
    : null;
  const inventorySummaryParsed = !inventoryManualParsed && isInventorySummarySlot(baseSlotId)
    ? parseInventorySummaryWorkbook(inventorySummaryFile, baseSlotId, mapping)
    : null;
  const inventoryParsed = inventoryManualParsed || inventorySummaryParsed;
  const parsed = firstMileParsed || inventoryParsed || productProjectParsed || fullInventoryParsed || (
    ['inventorySummaryFile15', 'inventorySummaryFile16'].includes(baseSlotId)
      ? await streamingKingdeeWorkbookRows(
        req.file,
        baseSlotId === 'inventorySummaryFile16' ? selectedSheetNames : sheetName || null,
        { includePreviews: false, stringifyValues: true }
      )
      : workbookRows(req.file, sheetName || null, { includePreviews: false })
  );
  const rowMapping = slotId === 'spare1' && parsed.columns?.[7]
    ? { ...mapping, level2WarehouseCategory: parsed.columns[7] }
    : mapping;
  const parsedRows = firstMileParsed || inventoryParsed || productProjectParsed || fullInventoryParsed ? parsed.rows : parsed.rows.map((row) => {
    if (['inventorySummaryFile4', 'inventorySummaryFile5'].includes(slotId)) {
      return {
        storeName: pick(row, mapping.storeName) || pickAny(row, ['店铺', '店铺名称', '账号', '账号名称']),
        marketplace: pick(row, mapping.marketplace) || pickAny(row, ['站点', '国家', '国家/地区', '销售平台']),
        sku: pick(row, mapping.sku) || pickAny(row, ['SKU', 'MSKU', 'Seller SKU', '卖家SKU', '商品SKU']),
        fnsku: pick(row, mapping.fnsku) || pickAny(row, ['FNSKU']),
        asin: pick(row, mapping.asin) || pickAny(row, ['ASIN']),
        identifier: pick(row, mapping.identifier) || pickAny(row, ['识别码']),
        warehouseName: pick(row, mapping.warehouseName) || pickAny(row, ['仓库名称', '仓库名', '仓库']),
        inTransitQty: pick(row, mapping.inTransitQty) || pickAny(row, ['在途数量', '在途量', '运输中数量', '入库中数量', '数量'])
      };
    }
    if (slotId === 'productCategory') {
      return {
        raw: row,
        materialCode: pick(row, mapping.materialCode),
        sku: pick(row, mapping.sku),
        logisticsCode: pick(row, mapping.logisticsCode),
        materialName: pick(row, mapping.materialName),
        brand: pick(row, mapping.brand) || pickAny(row, ['品牌', '品牌名称', '商品品牌']),
        productType: pick(row, mapping.productType) || pickAny(row, ['产品类型', '销售产品分类', '商品类型', '产品类别', '商品类别', '品类', '一级品类']),
        productLine: pick(row, mapping.productLine),
        productSeries: pick(row, mapping.productSeries),
        model: pick(row, mapping.model) || pickAny(row, ['型号', '产品型号', '款式', '规格型号', '规格']),
        salesRegion: pick(row, mapping.salesRegion) || pickAny(row, ['销售区域']),
        pretaxPrice: pick(row, mapping.pretaxPrice) || pickAny(row, ['不含税结算价'])
      };
    }
    if (slotId === 'purchaseAssignment') {
      return {
        raw: row,
        supplier: pick(row, mapping.supplier),
        supplierShortName: pick(row, mapping.supplierShortName),
        productLineDetailSupplier: pick(row, mapping.productLineDetailSupplier) || pickAny(row, ['产品明细供应商', '产品明细-供应商', '产品线明细供应商', '产品线明细-供应商', '产品线明细供应商名称', '产品线明细-供应商名称', '供应商全称', '供应商名称']),
        materialCode: pick(row, mapping.materialCode),
        productLineDetailPurchaseGroup: pick(row, mapping.productLineDetailPurchaseGroup) || pickAny(row, ['产品线明细-采购组', '产品线明细采购组', '产品线明细-采购分组', '产品线明细采购分组']),
        productLineDetailPurchaseOwner: pick(row, mapping.productLineDetailPurchaseOwner) || pickAny(row, ['产品线明细-采购下单人', '产品线明细采购下单人', '产品线明细-下单人', '产品线明细下单人']),
        purchaseOwner: pick(row, mapping.purchaseOwner) || pickAny(row, ['采购下单人', '下单人', '采购负责人']),
        purchaseGroup: pick(row, mapping.purchaseGroup) || pickAny(row, ['采购组', '采购分组']),
        purchaseOrg: pick(row, mapping.purchaseOrg)
      };
    }
    if (slotId === PRODUCT_PROJECT_SLOT_ID) {
      return {
        raw: row,
        projectName: pick(row, mapping.projectName) || pickAny(row, ['项目名称', '项目', '产品项目', '研发项目']),
        businessUnit: pick(row, mapping.businessUnit) || pickAny(row, ['事业部', '所属事业部', '负责事业部']),
        productPositioning: pick(row, mapping.productPositioning) || pickAny(row, ['产品定位', '项目定位', '市场定位']),
        projectStage: pick(row, mapping.projectStage) || pickAny(row, ['项目阶段', '研发阶段', '阶段', '当前阶段']),
        owner: pick(row, mapping.owner) || pickAny(row, ['负责人', '项目负责人', '产品经理']),
        plannedLaunchDate: pick(row, mapping.plannedLaunchDate) || pickAny(row, ['计划上市日期', '预计上市日期', '上市日期', '计划完成日期']),
        projectStatus: pick(row, mapping.projectStatus) || pickAny(row, ['项目状态', '状态', '进度状态']),
        remark: pick(row, mapping.remark) || pickAny(row, ['备注', '项目备注', '进度说明']),
        materialCode: pick(row, mapping.materialCode) || pickAny(row, ['物料编码', '物料代码', '品号']),
        sku: pick(row, mapping.sku) || pickAny(row, ['SKU', 'sku', '产品SKU']),
        modifiedAt: pick(row, mapping.modifiedAt) || pickAny(row, ['修改时间', '更新时间', '最后修改时间'])
      };
    }
    if (slotId.startsWith('businessUnitFeedback')) {
      return {
        raw: row,
        materialCode: pick(row, mapping.materialCode) || pickAny(row, ['物料编码', '物料代码', '品号']),
        sku: pick(row, mapping.sku) || pickAny(row, ['SKU', 'sku', '产品SKU']),
        productLifecycle: pick(row, mapping.productLifecycle) || pickAny(row, ['产品生命周期', '生命周期', '生命周期阶段']),
        productPositioning: pick(row, mapping.productPositioning) || pickAny(row, ['产品定位', '市场定位', '定位']),
        feedbackRemark: pick(row, mapping.feedbackRemark) || pickAny(row, ['反馈备注', '备注', '事业部反馈'])
      };
    }
    if (slotId === 'spare1') {
      return {
        raw: row,
        subject: pick(row, rowMapping.subject) || pickDimensionAlias(row, ['主体', '使用组织', '库存组织']),
        warehouseCode: pick(row, rowMapping.warehouseCode) || pickDimensionAlias(row, ['仓库编码', '仓库代码', '仓库编号', '金蝶仓库编码', '仓库ID']),
        warehouseName: pick(row, rowMapping.warehouseName) || pickDimensionAlias(row, ['仓库名称', '仓库名', '金蝶仓库名称']),
        warehouseLocation: pick(row, rowMapping.warehouseLocation) || pickDimensionAlias(row, ['仓位位置', '仓库位置', '仓位']),
        marketplace: pick(row, rowMapping.marketplace) || pickDimensionAlias(row, ['站点', '站点名称', '国家站点', '销售站点', '国家/地区']),
        level1WarehouseCategory: pick(row, rowMapping.level1WarehouseCategory) || pickDimensionAlias(row, ['一级仓库分类', '仓库一级分类', '一级分类', '仓库大类', '一级仓库类型']),
        level2WarehouseCategory: pick(row, rowMapping.level2WarehouseCategory)
      };
    }
    if (slotId === 'warehouseMaterialMap') {
      return {
        raw: row,
        subject: pick(row, mapping.subject) || pickAny(row, ['主体', '使用组织', '库存组织']),
        warehouseCode: pick(row, mapping.warehouseCode) || pickAny(row, ['仓库编码', '仓库代码']),
        warehouseName: pick(row, mapping.warehouseName) || pickAny(row, ['仓库名称', '仓库名', '仓库']),
        materialCode: pick(row, mapping.materialCode) || pickAny(row, ['物料编码', '品号', '商品编码', '存货编码']),
        sku: pick(row, mapping.sku) || pickAny(row, ['SKU', '系统SKU', '商品SKU']),
        businessUnit: pick(row, mapping.businessUnit) || pickAny(row, ['事业部']),
        remark: pick(row, mapping.remark) || pickAny(row, ['备注', '说明'])
      };
    }
    if (['dimensionSpare', 'inventorySummaryFile10'].includes(slotId)) {
      return {
        raw: row,
        lingxingSku: pick(row, mapping.lingxingSku) || pickAny(row, ['领星SKU', 'SKU', 'MSKU', 'Seller SKU']),
        materialCode: pick(row, mapping.materialCode) || pickAny(row, ['物料编码', '品号', '商品编码', '存货编码']),
        remark: pick(row, mapping.remark) || pickAny(row, ['备注', '说明'])
      };
    }
    if (slotId === 'spare2') {
      return {
        raw: row,
        stockupStatus: pick(row, mapping.stockupStatus) || pickAny(row, ['是否正常备货']),
        brand: pick(row, mapping.brand) || pickAny(row, ['品牌']),
        productType: pick(row, mapping.productType) || pickAny(row, ['产品类型']),
        merchantCode: pick(row, mapping.merchantCode) || pickAny(row, ['商家编码', '商品编码']),
        systemSku: pick(row, mapping.systemSku) || pickAny(row, ['系统SKU-必填', '系统SKU', 'SKU'])
      };
    }
    if (['wangdianDataMain', 'inventorySummaryFile6'].includes(slotId)) {
      return {
        raw: row,
        stockupStatus: pick(row, mapping.stockupStatus) || pickAny(row, ['是否正常备货', '备货状态']),
        brand: pick(row, mapping.brand) || pickAny(row, ['品牌', '品牌名称', '商品品牌']),
        productType: pick(row, mapping.productType) || pickAny(row, ['产品类型', '商品类型', '产品类别', '商品类别', '品类']),
        merchantCode: pick(row, mapping.merchantCode) || pickAny(row, ['商家编码', '商品编码']),
        systemSku: pick(row, mapping.systemSku) || pickAny(row, ['系统SKU-必填', '系统SKU', 'SKU', '商品SKU']),
        wdtStockQty: pick(row, mapping.wdtStockQty) || pickAny(row, ['旺店通在库量', '在库量', '库存量', '库存', '可发库存', '可用库存', '现货库存']),
        nonSelf7dOutQty: pick(row, mapping.nonSelf7dOutQty) || pickAny(row, ['非自营近7天出库', '非自营7天出库', '非自营近7日出库', '近7天出库', '近7日出库']),
        nonSelf30dOutQty: pick(row, mapping.nonSelf30dOutQty) || pickAny(row, ['非自营近30天出库', '非自营30天出库', '非自营近30日出库', '近30天出库', '近30日出库'])
      };
    }
    if (['wangdianSpare1', 'inventorySummaryFile7'].includes(slotId)) {
      return {
        raw: row,
        jdId: pick(row, mapping.jdId) || pickAny(row, ['SKU', 'sku', '京东SKU', '京东sku', '京东商品SKU', '商品SKU', '系统SKU', '京东编码', '京东商品编码', '京东货号', 'ID', 'id', '京东ID', '京东id']),
        jdStockQty: pick(row, mapping.jdStockQty) || pickAny(row, ['全国现货库存', '京东库存', '库存数量', '库存', '可用库存', '现货库存']),
        self7dOutQty: pick(row, mapping.self7dOutQty) || pickAny(row, ['全国近7日出库商品件数', '近7日出库商品件数', '全国近7天出库商品件数', '自营近7天出库']),
        self30dOutQty: pick(row, mapping.self30dOutQty) || pickAny(row, ['全国近30日出库商品件数', '近30日出库商品件数', '全国近30天出库商品件数', '自营近30天出库'])
      };
    }
    if (['wangdianSpare2', 'inventorySummaryFile11'].includes(slotId)) {
      return {
        raw: row,
        jdId: pick(row, mapping.jdId) || pickAny(row, ['SKU', 'sku', '京东SKU', '京东sku', '京东商品SKU', '商品SKU', '系统SKU', '京东编码', '京东商品编码', '京东货号', 'ID', 'id', '京东ID', '京东id']),
        materialCode: pick(row, mapping.materialCode) || pickAny(row, ['品号', '物料编码', '商品编码', '货品编号', '存货编码'])
      };
    }
    if (['lingxingWarehouseMap', 'inventorySummaryFile9', 'inventorySummaryFile13'].includes(slotId)) {
      return {
        raw: row,
        subject: pick(row, mapping.subject) || pickAny(row, ['主体', '使用组织', '库存组织']),
        storeName: pick(row, mapping.storeName) || pickAny(row, ['店铺', '店铺名称']),
        lingxingWarehouseName: pick(row, mapping.lingxingWarehouseName) || pickAny(row, ['领星FBA仓库', '领星FBA仓', '领星仓库名称', '领星仓库', '仓库名称', '仓库']),
        kingdeeWarehouseCode: pick(row, mapping.kingdeeWarehouseCode) || pickAny(row, ['金蝶仓库编码', '仓库编码', '仓库代码']),
        kingdeeWarehouseName: pick(row, mapping.kingdeeWarehouseName) || pickAny(row, ['金蝶仓库名称', '金蝶仓库', '金蝶名称']),
        remark: pick(row, mapping.remark) || pickAny(row, ['备注', '说明'])
      };
    }
    if ([
      'lingxingFbaInventory', 'lingxingFbmInventory', 'lingxingWfsInventory',
      'inventorySummaryFile1', 'inventorySummaryFile2', 'inventorySummaryFile3'
    ].includes(slotId)) {
      return {
        raw: row,
        storeName: pick(row, mapping.storeName) || pickAny(row, ['店铺', '店铺名称', '账号', '账号名称']),
        marketplace: pick(row, mapping.marketplace) || pickAny(row, ['站点', '国家', '国家/地区', '销售平台']),
        sku: pick(row, mapping.sku) || pickAny(row, ['SKU', 'MSKU', 'Seller SKU', '卖家SKU', '商品SKU']),
        fnsku: pick(row, mapping.fnsku) || pickAny(row, ['FNSKU']),
        asin: pick(row, mapping.asin) || pickAny(row, ['ASIN']),
        itemId: pick(row, mapping.itemId) || pickAny(row, ['Item ID', 'ItemID', '商品ID', '产品ID']),
        warehouseName: pick(row, mapping.warehouseName) || pickAny(row, ['仓库名称', '仓库名', '仓库']),
        inventoryAttribute: pick(row, mapping.inventoryAttribute) || pickAny(row, ['库存属性']),
        endingInventoryQty: pick(row, mapping.endingInventoryQty) || pick(row, mapping.totalQty) || pickAny(row, [
          '期末库存(含移仓)',
          '期末库存（含移仓）',
          '期末库存(含移仓)-数量',
          '期末库存（含移仓）-数量',
          '期末库存(含移仓)数量'
        ]),
        identifier: pick(row, mapping.identifier) || pickAny(row, ['识别码']),
        actualTotalQty: pick(row, mapping.actualTotalQty) || pickAny(row, ['实际总量']),
        totalInventoryQty: pick(row, mapping.totalInventoryQty) || pickAny(row, ['总库存(数量)', '总库存（数量）']),
        availableQty: pick(row, mapping.availableQty) || pickAny(row, ['可用库存', '可售库存', '可用数量', '可售数量', '可售']),
        totalQty: pick(row, mapping.totalQty) || pickAny(row, ['总库存', '库存数量', '库存总量', '库存'])
      };
    }
    return row;
  });
  const rowsWithSheetSource = !isInventoryManualSlot(slotId) && baseSlotId === 'inventorySummaryFile16'
    ? parsed.sheets.flatMap((sheet) => sheet.rows.map((row) => ({ ...row, __sourceSheet: sheet.sheetName })))
    : parsedRows;
  const rows = isInventoryLibrarySlot(slotId)
    ? rowsWithSheetSource.map(({ raw: _raw, ...row }) => row)
    : rowsWithSheetSource;
  if ((isInventoryManualSlot(slotId) || ['inventorySummaryFile15', 'inventorySummaryFile16'].includes(baseSlotId) || ['fullInventoryFile1', 'fullInventoryFile2'].includes(slotId)) && !rows.length) {
    const error = new Error(`${DIMENSION_SLOTS[slotId]}选中的工作表没有可保存的数据，已保留当前应用文件`);
    error.status = 400;
    error.publicMessage = error.message;
    throw error;
  }
  const storedMapping = firstMileParsed
    ? { ...mapping, __firstMileSummary: firstMileParsed.summary }
    : productProjectParsed?.mapping || inventoryParsed?.mapping || fullInventoryParsed?.mapping || rowMapping;
  const now = nowText();
  const beforeOrderCounts = orderDataCounts();
  transaction(() => {
    run(
      `INSERT INTO dimension_files (slot_id, title, file_name, sheet_name, sheet_names, selected_sheet_names, mapping_json, rows_json, applied, uploaded_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(slot_id) DO UPDATE SET title = excluded.title, file_name = excluded.file_name, sheet_name = excluded.sheet_name, sheet_names = excluded.sheet_names, selected_sheet_names = excluded.selected_sheet_names, mapping_json = excluded.mapping_json, rows_json = excluded.rows_json, applied = 1, uploaded_by = excluded.uploaded_by, updated_at = excluded.updated_at`,
      [slotId, DIMENSION_SLOTS[slotId] || slotId, safeFilename(req.file), firstMileParsed || fullInventoryParsed ? '' : productProjectParsed?.sheetName || inventoryParsed?.sheetName || sheetName, JSON.stringify(parsed.sheetNames), JSON.stringify(fullInventoryParsed ? fullInventoryParsed.selectedSheetNames : !isInventoryManualSlot(slotId) && baseSlotId === 'inventorySummaryFile16' ? selectedSheetNames : []), JSON.stringify(storedMapping), JSON.stringify(rows), req.user.name, now]
    );
    if (firstMileParsed && req.file?.buffer?.length) {
      run(
        'UPDATE dimension_files SET source_file = ?, source_file_mime = ?, source_file_size = ? WHERE slot_id = ?',
        [new Uint8Array(req.file.buffer), normalize(req.file.mimetype), req.file.buffer.length, slotId]
      );
    }
    if (slotId === 'productCategory' || slotId === 'purchaseAssignment') applyDimensionEnrichment();
    assertOrderDataUnchanged(beforeOrderCounts);
  });
  res.json({
    rowCount: rows.length,
    sheetName: firstMileParsed || fullInventoryParsed ? '' : productProjectParsed?.sheetName || inventoryParsed?.sheetName || sheetName,
    sheetNames: parsed.sheetNames,
    selectedSheetNames: fullInventoryParsed ? fullInventoryParsed.selectedSheetNames : !isInventoryManualSlot(slotId) && baseSlotId === 'inventorySummaryFile16' ? selectedSheetNames : [],
    applied: true,
    diagnostics: dimensionDiagnostics(slotId, rows),
    parseSummary: firstMileParsed?.summary || productProjectParsed?.summary || inventoryParsed?.mapping?.__inventorySummary || inventoryParsed?.mapping?.__inventoryManual || null,
    ...(isInventoryLibrarySlot(slotId) || ['fullInventoryFile1', 'fullInventoryFile2'].includes(slotId) ? {} : { rows: demandRows(false, req.user) })
  });
});

app.post('/api/dimensions/:slotId/apply', requireAuth, requireAnyPage(['dimensionLibrary', 'businessUnitFeedback', 'wangdianData', 'lingxingInventory', 'inventorySummaryLibrary', 'inventoryManualLibrary', 'firstMileDatabase', 'beiHuoReviewLibrary', 'fullInventoryLibrary']), (req, res) => {
  const beforeOrderCounts = orderDataCounts();
  transaction(() => {
    run('UPDATE dimension_files SET applied = 1, updated_at = ? WHERE slot_id = ?', [nowText(), req.params.slotId]);
    if (req.params.slotId === 'productCategory' || req.params.slotId === 'purchaseAssignment') applyDimensionEnrichment();
    assertOrderDataUnchanged(beforeOrderCounts);
  });
  res.json(isInventoryLibrarySlot(req.params.slotId) || ['fullInventoryFile1', 'fullInventoryFile2'].includes(req.params.slotId) ? { applied: true } : { rows: demandRows(false, req.user) });
});

app.delete('/api/dimensions/:slotId', requireAuth, requireAnyPage(['dimensionLibrary', 'businessUnitFeedback', 'wangdianData', 'lingxingInventory', 'inventorySummaryLibrary', 'inventoryManualLibrary', 'firstMileDatabase', 'beiHuoReviewLibrary', 'fullInventoryLibrary']), (req, res) => {
  run('DELETE FROM dimension_files WHERE slot_id = ?', [req.params.slotId]);
  saveDatabase();
  res.json({ ok: true });
});

app.get('/api/inventory', requireAuth, requirePage('inventory'), (req, res) => {
  res.json({ rows: all('SELECT * FROM inventory ORDER BY business_unit, supplier, material_code') });
});

app.post('/api/inventory', requireAuth, requirePage('inventory'), (req, res) => {
  const businessUnit = normalize(req.body.businessUnit);
  const supplier = normalize(req.body.supplier);
  const materialCode = normalize(req.body.materialCode);
  const qty = numberValue(req.body.stockQty);
  if (!businessUnit || !supplier || !materialCode) return res.status(400).json({ error: '事业部、供应商、物料编码不能为空' });
  const key = stockKey(businessUnit, supplier, materialCode);
  const existing = get('SELECT * FROM inventory WHERE stock_key = ?', [key]);
  const now = nowText();
  transaction(() => {
    run(
      `INSERT INTO inventory (stock_key, business_unit, supplier, material_code, stock_qty, remark, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(stock_key) DO UPDATE SET stock_qty = excluded.stock_qty, remark = excluded.remark, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [key, businessUnit, supplier, materialCode, qty, normalize(req.body.remark), req.user.name, now]
    );
    run('INSERT INTO inventory_logs (id, stock_key, old_qty, new_qty, remark, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [randomUUID(), key, numberValue(existing?.stock_qty), qty, normalize(req.body.remark), req.user.name, now]);
  });
  res.json({ rows: all('SELECT * FROM inventory ORDER BY business_unit, supplier, material_code') });
});

app.get('/api/progress/export', requireAuth, async (req, res) => {
  const rows = demandRows(false, req.user).filter((row) => numberValue(row.remainingInboundQty) > 0);
  const headers = [
    'demandKey', '数据状态', '源行号', '校验说明', '采购组', '采购下单人',
    '订单类型', '下单月份', '当前订单月份', '当前采购订单号', '当前订单创建日期', '当前订单采购数量',
    '原采购订单号', '原订单创建日期', '原订单采购数量', '采购订单源备注', '变更校验',
    '创建人', 'OA备货流程号', '采购组织',
    '事业部', '供应商简称', '产品线', '系列', '物料编码', 'SKU', '物料名称',
    '运营备货数量', '未交付数量', '已发货数量',
    '未备料未生产', '已备料未生产', '生产中产品', '完工未发产品',
    '合同约定交期', '生产中交付时间', '未生产预计交付时间',
    '是否正常履约', '不含税采购价', '正常履约数量', '正常履约金额',
    '非正常履约数量', '非正常履约金额', '未履约原因', '原因详情', '备注', '状态校验'
  ];
  const aoa = [headers];
  rows.forEach((row) => {
    aoa.push([
      row.demandKey, row.dataStatus || '采购订单数据', (row.manualSourceRows || []).map((source) => source.sourceRowNo).join('、'), row.validationMessage || '',
      row.purchaseGroup, row.purchaseOwner,
      row.orderType || NORMAL_ORDER_TYPE, row.reportingMonth || '待核验', row.month, row.orderNo,
      row.currentOrderDate, row.currentPurchaseQty, row.originalOrderNo, row.originalOrderDate,
      row.originalPurchaseQty, row.orderRemark, row.changeValidationMessage,
      row.orderCreator, row.oaFlowNo, row.purchaseOrg,
      row.businessUnit, row.orderSupplierShortName || UNMATCHED_SUPPLIER_SHORT_NAME,
      row.productLine, row.productSeries, row.materialCode, row.sku, row.materialName || row.materialCode,
      row.operationStockQty, row.remainingInboundQty, row.shippedQty,
      row.unpreparedQty, row.preparedNotStartedQty, row.inProductionQty, row.finishedQty,
      row.contractDeliveryDates, row.productionDeliveryDate, row.unproducedEstimatedDeliveryDate,
      row.fulfillmentStatus || '待维护', row.pretaxPriceMaintained
        ? Math.abs(numberValue(row.pretaxPrice) - 1e-9) < 1e-12
          ? '配件无采购价'
          : Math.round(numberValue(row.pretaxPrice) * 10) / 10
        : '未维护',
      row.normalFulfillmentQty, row.normalFulfillmentAmount,
      row.abnormalFulfillmentQty, row.abnormalFulfillmentAmount,
      row.unfulfilledReason, row.reasonDetail, row.remark,
      row.progressAdjustmentRequired ? `待人工调整（差额 ${row.gap}）` : '正常'
    ]);
  });
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet(aoa);
  xlsx.utils.book_append_sheet(wb, ws, '生产跟进');
  const buf = Buffer.from(await buildStyledExcelBuffer(xlsx, wb));
  res.setHeader('Content-Disposition', `attachment; filename="progress-export.xlsx"; filename*=UTF-8''${encodeURIComponent('生产跟进导出.xlsx')}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

app.post('/api/progress/import', requireAuth, upload.single('file'), (req, res) => {
  const parsed = workbookRows(req.file, null, { includePreviews: false });
  const now = nowText();
  let updated = 0;
  transaction(() => {
    parsed.rows.forEach((row) => {
      const demandKeyValue = normalize(row.demandKey || row['demandKey'] || '');
      if (!demandKeyValue) return;
      const demand = get('SELECT * FROM order_demands WHERE demand_key = ?', [demandKeyValue]);
      if (!demand) return;
      const qty = (col) => Math.max(0, numberValue(row[col] || 0));
      const remark = normalize(row['备注'] || row.remark || '');
      const preparedNotStarted = qty('已备料未生产');
      const inProduction = qty('生产中产品') || qty('在产品') || qty('生产中');
      const finished = qty('完工未发产品') || qty('完工产品') || qty('已完工');
      const shipped = numberValue(demand.tracking_inbound_qty);
      const expectedQty = Math.max(numberValue(demand.tracking_remaining_qty), 0);
      const assignedQty = preparedNotStarted + inProduction;
      if (assignedQty - expectedQty > 0.000001) return;
      if (finished - expectedQty > 0.000001) return;
      const unprepared = Math.max(expectedQty - assignedQty, 0);
      const fulfillmentStatus = normalize(row['是否正常履约'] || row['是否需正常交货'] || row.fulfillmentStatus || '');
      if (fulfillmentStatus && !['是', '否'].includes(fulfillmentStatus)) return;
      const unfulfilledReason = normalize(row['未履约原因'] || row.unfulfilledReason || '');
      if (fulfillmentStatus === '否' && !unfulfilledReason) return;
      const productionDeliveryDate = progressDateValue(row['生产中交付时间'] || row.productionDeliveryDate || '', '生产中交付时间');
      const unproducedEstimatedDeliveryDate = progressDateValue(row['未生产预计交付时间'] || row.unproducedEstimatedDeliveryDate || '', '未生产预计交付时间');
      const reasonDetail = normalize(row['原因详情'] || row.reasonDetail || '');
      run(
        `INSERT INTO supplier_progress (
           demand_key, unprepared_qty, prepared_not_started_qty, in_production_qty, finished_qty, shipped_qty,
           production_delivery_date, unproduced_estimated_delivery_date, fulfillment_status,
           unfulfilled_reason, reason_detail, remark, updated_by, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(demand_key) DO UPDATE SET
           unprepared_qty = excluded.unprepared_qty,
           prepared_not_started_qty = excluded.prepared_not_started_qty,
           in_production_qty = excluded.in_production_qty,
           finished_qty = excluded.finished_qty,
           shipped_qty = excluded.shipped_qty,
           production_delivery_date = excluded.production_delivery_date,
           unproduced_estimated_delivery_date = excluded.unproduced_estimated_delivery_date,
           fulfillment_status = excluded.fulfillment_status,
           unfulfilled_reason = excluded.unfulfilled_reason,
           reason_detail = excluded.reason_detail,
           remark = excluded.remark,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
        [
          demandKeyValue, unprepared, preparedNotStarted, inProduction, finished, shipped,
          productionDeliveryDate, unproducedEstimatedDeliveryDate, fulfillmentStatus,
          unfulfilledReason, reasonDetail, remark, req.user.name, now
        ]
      );
      run(
        `INSERT INTO supplier_progress_snapshots (
           id, demand_key, unprepared_qty, prepared_not_started_qty, in_production_qty, finished_qty, shipped_qty,
           production_delivery_date, unproduced_estimated_delivery_date, fulfillment_status,
           unfulfilled_reason, reason_detail, remark, updated_by, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(), demandKeyValue, unprepared, preparedNotStarted, inProduction, finished, shipped,
          productionDeliveryDate, unproducedEstimatedDeliveryDate, fulfillmentStatus,
          unfulfilledReason, reasonDetail, remark, req.user.name, now
        ]
      );
      updated++;
    });
  });
  res.json({ updated });
});

app.post('/api/inventory/import', requireAuth, requirePage('inventory'), upload.single('file'), (req, res) => {
  const parsed = workbookRows(req.file, null, { includePreviews: false });
  const now = nowText();
  let imported = 0;
  transaction(() => {
    parsed.rows.forEach((row) => {
      const businessUnit = normalize(row['事业部'] || row.businessUnit || row.business_unit || '');
      const supplier = normalize(row['供应商'] || row.supplier || '');
      const materialCode = normalize(row['物料编码'] || row.materialCode || row.material_code || '');
      const qty = numberValue(row['库存数量'] || row.stockQty || row.stock_qty || row.quantity || 0);
      if (!businessUnit || !supplier || !materialCode || !qty) return;
      const key = stockKey(businessUnit, supplier, materialCode);
      const existing = get('SELECT * FROM inventory WHERE stock_key = ?', [key]);
      const remark = normalize(row['备注'] || row.remark || '');
      run(
        `INSERT INTO inventory (stock_key, business_unit, supplier, material_code, stock_qty, remark, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(stock_key) DO UPDATE SET stock_qty = excluded.stock_qty, remark = excluded.remark, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        [key, businessUnit, supplier, materialCode, qty, remark, req.user.name, now]
      );
      run('INSERT INTO inventory_logs (id, stock_key, old_qty, new_qty, remark, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [randomUUID(), key, numberValue(existing?.stock_qty), qty, remark, req.user.name, now]);
      imported++;
    });
  });
  res.json({ imported });
});

function traceChangeRecords() {
  const importRecords = all('SELECT * FROM kingdee_import_batches ORDER BY imported_at DESC LIMIT 100').map((row) => ({
    id: `import-${row.id}`,
    sourceType: 'kingdeeImport',
    operator: row.imported_by || '',
    month: '',
    businessUnit: '',
    supplier: '',
    supplierShortName: '',
    productLine: '',
    productSeries: '',
    materialCode: '',
    sku: '',
    materialName: '',
    purchaseOwner: '',
    orderCreator: '',
    reason: row.import_mode === 'baseline' ? '基线导入' : '新快照导入',
    actionType: '采购订单导入',
    remark: `${row.file_name}，有效明细 ${numberValue(row.row_count)} 行`,
    createdAt: row.applied_at || row.imported_at || ''
  }));
  const orderEventRecords = all('SELECT * FROM kingdee_order_events ORDER BY created_at DESC LIMIT 500').map((row) => {
    const demand = get('SELECT * FROM order_demands WHERE demand_key = ?', [row.demand_key]);
    const enriched = enrichDemandFields(row.supplier, row.material_code);
    return {
      id: `order-event-${row.id}`,
      sourceType: 'kingdeeOrderEvent',
      operator: row.created_by || '',
      month: row.month || '',
      businessUnit: row.business_unit || '',
      supplier: row.supplier || '',
      supplierShortName: enriched.supplierShortName || '',
      productLine: demand?.product_line || enriched.productLine || '',
      productSeries: demand?.product_series || enriched.productSeries || '',
      materialCode: row.material_code || '',
      sku: demand?.sku || enriched.sku || '',
      materialName: demand?.material_name || enriched.materialName || row.material_code || '',
      purchaseOwner: enriched.purchaseOwner || UNASSIGNED_PURCHASE_OWNER,
      orderCreator: oldCreatorsForDemand(row.demand_key),
      reason: row.event_type || '',
      actionType: '采购订单刷新',
      remark: `${row.old_value || '空'} -> ${row.new_value || '空'}`,
      createdAt: row.created_at || ''
    };
  });
  const allocationRecords = allocationRows().map((row) => ({
    id: `allocation-${row.id}`,
    sourceType: 'differenceAllocation',
    operator: row.createdBy || '',
    month: row.month || '',
    businessUnit: row.businessUnit || '',
    supplier: row.supplier || '',
    supplierShortName: row.supplierShortName || '',
    productLine: row.productLine || '',
    productSeries: row.productSeries || '',
    materialCode: row.materialCode || '',
    sku: row.sku || '',
    materialName: row.materialName || row.materialCode || '',
    purchaseOwner: row.purchaseOwner || UNASSIGNED_PURCHASE_OWNER,
    orderCreator: row.orderCreator || '',
    reason: row.reason || '',
    actionType: row.actionType || '',
    remark: row.remark || '',
    createdAt: row.createdAt || ''
  }));
  const noteRecords = all('SELECT * FROM demand_change_notes ORDER BY created_at DESC LIMIT 300').map((row) => {
    const demand = get('SELECT * FROM order_demands WHERE demand_key = ?', [row.demand_key]);
    const enriched = enrichDemandFields(row.supplier, row.material_code);
    return {
      id: `note-${row.id}`,
      sourceType: 'changeNote',
      operator: row.created_by || '',
      month: row.month || demand?.month || '',
      businessUnit: row.business_unit || demand?.business_unit || '',
      supplier: row.supplier || demand?.supplier || '',
      supplierShortName: enriched.supplierShortName || '',
      productLine: demand?.product_line || enriched.productLine || '',
      productSeries: demand?.product_series || enriched.productSeries || '',
      materialCode: row.material_code || demand?.material_code || '',
      sku: demand?.sku || enriched.sku || '',
      materialName: demand?.material_name || enriched.materialName || row.material_code || '',
      purchaseOwner: enriched.purchaseOwner,
      orderCreator: oldCreatorsForDemand(row.demand_key),
      reason: row.reason || '',
      actionType: '备注',
      remark: row.remark || '',
      createdAt: row.created_at || row.change_date || ''
    };
  });
  return [...importRecords, ...orderEventRecords, ...allocationRecords, ...noteRecords]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt), 'zh-Hans-CN'))
    .slice(0, 800);
}

app.get('/api/trace', requireAuth, requirePage('trace'), (req, res) => {
  res.json({
    batches: all('SELECT * FROM kingdee_import_batches ORDER BY imported_at DESC LIMIT 100'),
    diffs: all('SELECT * FROM demand_snapshot_diffs ORDER BY created_at DESC LIMIT 300'),
    progress: all('SELECT * FROM supplier_progress_snapshots ORDER BY updated_at DESC LIMIT 300'),
    inventory: all('SELECT * FROM inventory_logs ORDER BY updated_at DESC LIMIT 300'),
    notes: all('SELECT * FROM demand_change_notes ORDER BY created_at DESC LIMIT 300'),
    orderEvents: all('SELECT * FROM kingdee_order_events ORDER BY created_at DESC LIMIT 500'),
    changeRecords: traceChangeRecords()
  });
});

app.post('/api/change-notes', requireAuth, requirePage('trace'), (req, res) => {
  const month = normalize(req.body.month);
  const businessUnit = normalize(req.body.businessUnit);
  const supplier = normalize(req.body.supplier);
  const materialCode = normalize(req.body.materialCode);
  const purchaseOrg = normalize(req.body.purchaseOrg);
  const oaFlowNo = normalize(req.body.oaFlowNo);
  const key = demandKey(purchaseOrg, month, businessUnit, supplier, materialCode);
  run(
    'INSERT INTO demand_change_notes (id, demand_key, month, business_unit, supplier, material_code, oa_flow_no, related_qty, reason, change_date, remark, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), key, month, businessUnit, supplier, materialCode, oaFlowNo, numberValue(req.body.relatedQty), normalize(req.body.reason), normalize(req.body.changeDate), normalize(req.body.remark), req.user.name, nowText()]
  );
  saveDatabase();
  res.json({ ok: true });
});

function operationLogWhere(filters = {}) {
  const clauses = [];
  const params = [];
  const equal = (column, value) => {
    const normalized = normalize(value);
    if (!normalized) return;
    clauses.push(`${column} = ?`);
    params.push(normalized);
  };
  equal('user_name', filters.userName);
  equal('page_key', filters.pageKey);
  equal('action', filters.action);
  equal('result', filters.result);
  const startDate = normalize(filters.startDate);
  const endDate = normalize(filters.endDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    clauses.push('created_at >= ?');
    params.push(`${startDate} 00:00:00`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    clauses.push('created_at <= ?');
    params.push(`${endDate} 23:59:59`);
  }
  const keyword = normalize(filters.keyword);
  if (keyword) {
    const pattern = `%${keyword}%`;
    clauses.push('(user_name LIKE ? OR page_label LIKE ? OR action LIKE ? OR target LIKE ? OR details LIKE ? OR ip_address LIKE ? OR request_path LIKE ?)');
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

function canAccessAllOperationLogs(user) {
  return user?.role === ROLE_ADMIN || pageAccessFor(user).includes('operationLogs');
}

function operationLogFiltersForAccess(user, filters = {}) {
  if (canAccessAllOperationLogs(user)) return filters;
  return { ...filters, pageKey: 'progressRefresh' };
}

function operationLogScopedWhere(filters, condition) {
  const where = operationLogWhere(filters);
  return {
    sql: `${where.sql}${where.sql ? ' AND' : ' WHERE'} ${condition}`,
    params: where.params
  };
}

function operationLogPayload(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userRole: row.user_role,
    eventType: row.event_type,
    pageKey: row.page_key,
    pageLabel: row.page_label,
    action: row.action,
    target: row.target,
    details: row.details,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    method: row.method,
    requestPath: row.request_path,
    statusCode: numberValue(row.status_code),
    result: row.result,
    createdAt: row.created_at
  };
}

function filteredOperationLogs(filters = {}, limit = 50000, offset = 0) {
  const where = operationLogWhere(filters);
  return all(
    `SELECT * FROM operation_logs${where.sql} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
    [...where.params, limit, offset]
  ).map(operationLogPayload);
}

app.get('/api/operation-logs', requireAuth, requireAnyPage(['operationLogs', 'progressRefresh']), (req, res) => {
  const requestedFilters = {
    userName: req.query.userName,
    pageKey: req.query.pageKey,
    action: req.query.action,
    result: req.query.result,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
    keyword: req.query.keyword
  };
  const filters = operationLogFiltersForAccess(req.user, requestedFilters);
  const pageSize = Math.min(100, Math.max(1, Math.floor(numberValue(req.query.pageSize) || 20)));
  const where = operationLogWhere(filters);
  const total = numberValue(get(`SELECT COUNT(*) AS total FROM operation_logs${where.sql}`, where.params)?.total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(numberValue(req.query.page) || 1)));
  const optionScope = canAccessAllOperationLogs(req.user)
    ? { pageKey: normalize(requestedFilters.pageKey) }
    : { pageKey: 'progressRefresh' };
  const distinctValues = (column) => {
    const scoped = operationLogScopedWhere(optionScope, `${column} <> ''`);
    return all(
      `SELECT DISTINCT ${column} AS value FROM operation_logs${scoped.sql} ORDER BY ${column}`,
      scoped.params
    ).map((row) => row.value).filter(Boolean);
  };
  const pageScope = operationLogScopedWhere(optionScope, "page_key <> ''");
  res.json({
    rows: filteredOperationLogs(filters, pageSize, (page - 1) * pageSize),
    total,
    page,
    pageSize,
    totalPages,
    options: {
      users: distinctValues('user_name'),
      pages: all(
        `SELECT page_key, MAX(page_label) AS page_label FROM operation_logs${pageScope.sql} GROUP BY page_key ORDER BY page_label`,
        pageScope.params
      ).map((row) => ({ value: row.page_key, label: row.page_label })),
      actions: distinctValues('action'),
      results: distinctValues('result')
    }
  });
});

app.post('/api/operation-logs/export', requireAuth, requireAnyPage(['operationLogs', 'progressRefresh']), async (req, res) => {
  const rows = filteredOperationLogs(operationLogFiltersForAccess(req.user, req.body?.filters || {}));
  const headers = ['操作时间', '登录人', '角色', '事件类型', '页面', '操作类型', '操作内容/对象', '补充信息', '结果', '状态码', '登录位置(IP)', '设备/浏览器', '请求方式', '请求路径'];
  const data = rows.map((row) => [
    row.createdAt, row.userName, row.userRole, row.eventType, row.pageLabel, row.action,
    row.target, row.details, row.result, row.statusCode, row.ipAddress, row.userAgent,
    row.method, row.requestPath
  ]);
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.aoa_to_sheet([headers, ...data]);
  xlsx.utils.book_append_sheet(workbook, worksheet, '操作日常');
  const buffer = Buffer.from(await buildStyledExcelBuffer(xlsx, workbook));
  const fileName = `操作日常_${nowText().slice(0, 10).replaceAll('-', '')}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="operation-logs.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

app.get('/api/users', requireAuth, requirePage('permissions'), requireAdmin, (req, res) => {
  res.json({ rows: all('SELECT id, name, role, page_access, created_at, updated_at FROM users ORDER BY created_at').map((row) => ({ ...row, pageAccess: parseJson(row.page_access, []) })) });
});

app.post('/api/users', requireAuth, requirePage('permissions'), requireAdmin, async (req, res) => {
  const name = normalize(req.body.name);
  const password = normalize(req.body.password);
  if (!name || !password) return res.status(400).json({ error: '姓名和密码不能为空' });
  const hash = await bcrypt.hash(password, 10);
  const now = nowText();
  run('INSERT INTO users (id, name, password_hash, role, page_access, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [randomUUID(), name, hash, ROLE_USER, JSON.stringify(req.body.pageAccess || []), now, now]);
  saveDatabase();
  res.json({ ok: true });
});

app.patch('/api/users/:id', requireAuth, requirePage('permissions'), requireAdmin, async (req, res) => {
  const fields = [];
  const params = [];
  if (Array.isArray(req.body.pageAccess)) {
    fields.push('page_access = ?');
    params.push(JSON.stringify(req.body.pageAccess));
  }
  if (normalize(req.body.password)) {
    fields.push('password_hash = ?');
    params.push(await bcrypt.hash(normalize(req.body.password), 10));
  }
  fields.push('updated_at = ?');
  params.push(nowText(), req.params.id);
  run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
  saveDatabase();
  res.json({ ok: true });
});

app.post('/api/users/bulk-delete', requireAuth, requirePage('permissions'), requireAdmin, (req, res) => {
  const userIds = Array.isArray(req.body?.userIds)
    ? [...new Set(req.body.userIds.map((value) => normalize(value)).filter(Boolean))]
    : [];
  if (!userIds.length) return res.status(400).json({ error: '请选择要删除的用户' });
  if (userIds.length > 100) return res.status(400).json({ error: '单次最多删除100名用户' });
  if (userIds.includes(req.user.id)) return res.status(400).json({ error: '不能删除当前登录用户' });

  const placeholders = userIds.map(() => '?').join(', ');
  const targets = all(`SELECT id, name FROM users WHERE id IN (${placeholders})`, userIds);
  if (!targets.length) return res.status(404).json({ error: '所选用户不存在或已被删除' });

  const deletedIds = targets.map((user) => user.id);
  const deletedNames = targets.map((user) => user.name);
  const foundIds = new Set(deletedIds);
  const notFoundIds = userIds.filter((id) => !foundIds.has(id));
  const deletePlaceholders = deletedIds.map(() => '?').join(', ');
  transaction(() => {
    run(`DELETE FROM sessions WHERE user_id IN (${deletePlaceholders})`, deletedIds);
    run(`DELETE FROM users WHERE id IN (${deletePlaceholders})`, deletedIds);
  });

  res.json({
    ok: true,
    deletedCount: deletedIds.length,
    deletedIds,
    deletedNames,
    notFoundIds
  });
});

// ===== 数据完整性：修复 supplier_short_name =====
app.post('/api/maintenance/repair-supplier-short-names', requireAuth, (req, res) => {
  const dimMap = new Map();
  const dimRows = getDimensionRows('purchaseAssignment');
  dimRows.forEach(r => {
    if (r.supplier && r.supplierShortName && !dimMap.has(r.supplier)) {
      dimMap.set(r.supplier, r.supplierShortName);
    }
  });
  const emptySuppliers = all("SELECT DISTINCT supplier FROM order_demands WHERE active=1 AND (supplier_short_name='' OR supplier_short_name IS NULL)");
  const report = { totalEmpty: 0, fixedByDim: 0, fixedByHeuristic: 0, unfixed: 0, details: [] };
  transaction(() => {
    emptySuppliers.forEach(({ supplier }) => {
      let shortName = dimMap.get(supplier) || '';
      let source = '';
      if (shortName) {
        source = '维度表';
      } else {
        shortName = supplier
          .replace(/^(河北|浙江|广东|江苏|山东|福建|安徽|河南|湖北|湖南|四川|辽宁|吉林|黑龙江|江西|山西|陕西|甘肃|云南|贵州|海南|北京|上海|天津|重庆|西藏|宁夏|新疆|广西|内蒙古|香港|澳门)省?/, '')
          .replace(/(市?科技)?(医疗)?(器械)?(集团)?(股份)?(有限)?(责任)?(实业)?公司$/g, '')
          .replace(/^市/, '')
          .replace(/[（(].+[）)]$/, '')
          .slice(0, 10);
        source = '智能提取';
      }
      const affected = all("SELECT COUNT(*) as cnt FROM order_demands WHERE active=1 AND (supplier_short_name='' OR supplier_short_name IS NULL) AND supplier=?", [supplier]);
      const cnt = affected[0]?.cnt || 0;
      report.totalEmpty += cnt;
      if (shortName) {
        run("UPDATE order_demands SET supplier_short_name=? WHERE active=1 AND (supplier_short_name='' OR supplier_short_name IS NULL) AND supplier=?", [shortName, supplier]);
        if (source === '维度表') report.fixedByDim += cnt;
        else report.fixedByHeuristic += cnt;
        report.details.push({ supplier, shortName, source, count: cnt });
      } else {
        report.unfixed += cnt;
        report.details.push({ supplier, shortName: '(无法提取)', source: '失败', count: cnt });
      }
    });
  });
  const remaining = all("SELECT COUNT(*) as cnt FROM order_demands WHERE active=1 AND (supplier_short_name='' OR supplier_short_name IS NULL)");
  report.remainingAfterFix = remaining[0]?.cnt || 0;
  report.success = report.remainingAfterFix === 0;
  res.json(report);
});

app.get('/api/maintenance/data-completeness', requireAuth, (req, res) => {
  const checks = [];
  const emptyShort = all("SELECT COUNT(*) as cnt FROM order_demands WHERE active=1 AND (supplier_short_name='' OR supplier_short_name IS NULL)");
  checks.push({ check: 'supplier_short_name空值', passed: emptyShort[0]?.cnt === 0, value: emptyShort[0]?.cnt || 0 });
  const orphanKingdee = all("SELECT COUNT(DISTINCT k.demand_key) as cnt FROM kingdee_orders k WHERE k.remaining_inbound_qty > 0 AND NOT EXISTS (SELECT 1 FROM order_demands d WHERE d.demand_key = k.demand_key AND d.active = 1)");
  checks.push({ check: '金蝶剩余>0但需求无匹配', passed: orphanKingdee[0]?.cnt === 0, value: orphanKingdee[0]?.cnt || 0 });
  const orphanDemand = all("SELECT COUNT(*) as cnt FROM order_demands d WHERE d.active = 1 AND d.current_order_qty > 0 AND NOT EXISTS (SELECT 1 FROM kingdee_orders k WHERE k.demand_key = d.demand_key)");
  checks.push({ check: '需求有数量但金蝶无匹配', passed: orphanDemand[0]?.cnt === 0, value: orphanDemand[0]?.cnt || 0 });
  const currentKingdeeGroups = currentKingdeeNonZeroOrderGroups();
  const sourceOrderKeys = new Set(currentKingdeeGroups.map((group) => group.key));
  const displayedOrderKeys = demandRows(false, null)
    .filter((row) => row.dataSource === '金蝶系统')
    .map((row) => kingdeeOrderIdentity(row.underlyingDemandKey || row.demandKey, row.orderNo));
  const displayedOrderKeySet = new Set(displayedOrderKeys);
  const displayedOrderCounts = new Map();
  displayedOrderKeys.forEach((key) => displayedOrderCounts.set(key, (displayedOrderCounts.get(key) || 0) + 1));
  const missingOrderKeys = [...sourceOrderKeys].filter((key) => !displayedOrderKeySet.has(key));
  const extraOrderKeys = [...displayedOrderKeySet].filter((key) => !sourceOrderKeys.has(key));
  const duplicateOrderKeys = [...displayedOrderCounts].filter(([, count]) => count > 1).map(([key]) => key);
  checks.push({
    check: '当前金蝶非零订单完整展示',
    passed: missingOrderKeys.length === 0 && extraOrderKeys.length === 0 && duplicateOrderKeys.length === 0,
    value: {
      sourceCount: sourceOrderKeys.size,
      displayedCount: displayedOrderKeys.length,
      missingCount: missingOrderKeys.length,
      extraCount: extraOrderKeys.length,
      duplicateCount: duplicateOrderKeys.length,
      missingOrderKeys: missingOrderKeys.slice(0, 20),
      extraOrderKeys: extraOrderKeys.slice(0, 20),
      duplicateOrderKeys: duplicateOrderKeys.slice(0, 20)
    }
  });
  const tableCounts = {};
  ['kingdee_orders','order_demands','supplier_progress','manual_progress_rows','inventory','dimension_files'].forEach(t => {
    try { const r = all('SELECT COUNT(*) as cnt FROM '+t); tableCounts[t] = r[0]?.cnt || 0; } catch { tableCounts[t] = -1; }
  });
  checks.push({ check: '核心表行数', passed: true, value: tableCounts });
  const allPassed = checks.filter(c => c.check !== '核心表行数').every(c => c.passed);
  res.json({ passed: allPassed, checks, checkedAt: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (!req.path.startsWith('/api/')) return next(err);
  const isMulterError = err instanceof multer.MulterError;
  const status = isMulterError ? 400 : Number(err.status || err.statusCode || 500);
  const isKingdeeMemoryError = req.path.startsWith('/api/imports/kingdee/')
    && /array buffer allocation|heap out of memory|out of memory/i.test(String(err?.message || ''));
  let error = '服务器处理失败，请稍后重试';
  if (isMulterError && err.code === 'LIMIT_FILE_SIZE') {
    error = '文件过大，请压缩到100MB以内再上传';
  } else if (err.publicMessage) {
    error = String(err.publicMessage);
  } else if (status >= 400 && status < 500 && normalize(err?.message)) {
    error = normalize(err.message);
  } else if (['inventorySummaryFile15', 'inventorySummaryFile16'].includes(inventoryLibraryBaseSlotId(normalize(req.params?.slotId)))) {
    error = `${DIMENSION_SLOTS[req.params.slotId]}解析或保存失败，请重新选择工作表后上传`;
  } else if (isKingdeeMemoryError) {
    error = '采购订单文件解压体积过大，流式解析仍未完成，请将文件另存为CSV后重新上传';
  }
  console.error(`[${nowText()}] API error ${req.method} ${req.path}:`, err);
  return res.status(status).json({ error });
});

const distDir = path.join(rootDir, 'dist');
app.use('/gendanjindu/assets', (_req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  next();
});
app.use('/gendanjindu', express.static(distDir));
app.use(express.static(distDir));
app.get(/^\/gendanjindu\/(?!api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));

await initDatabase();
try {
  const firstMileMigration = migrateAppliedFirstMileSources();
  if (firstMileMigration.reparsed || firstMileMigration.unavailable) {
    console.info(
      `[First mile migration] v${FIRST_MILE_PARSER_VERSION}: `
      + `${firstMileMigration.reparsed} reparsed, ${firstMileMigration.unavailable} require reupload`
    );
  }
} catch (error) {
  console.error('[First mile migration] startup migration failed:', error);
}
// 每30分钟清理过期session
const sessionCleanupTimer = setInterval(() => {
  try {
    run('DELETE FROM sessions WHERE expires_at != ? AND expires_at < ?', ['', nowText()]);
    const deleted = numberValue(get('SELECT changes() AS count')?.count);
    if (deleted > 0) saveDatabase();
  } catch {}
}, 30 * 60 * 1000);
sessionCleanupTimer.unref?.();

await ensureAdmin();
try {
  migrateProductionOrderFollowups();
} catch (error) {
  console.error('[Production followup migration] startup migration failed:', error);
}
async function checkScheduledProductProjectSync() {
  try {
    if (currentProductProjectFileData()) return;
    const settings = currentProductProjectSettings();
    const lastSuccessAt = get("SELECT finished_at FROM product_project_sync_runs WHERE status='success' ORDER BY finished_at DESC LIMIT 1")?.finished_at || '';
    if (!settings.baseId || !settings.sheetId || !settings.appCredentialsConfigured || !settings.operatorConfigured) return;
    if (!shouldRunDailyProjectSync({ now: new Date(), lastSuccessAt, running: Boolean(productProjectSyncPromise) })) return;
    await runProductProjectSync({ triggerType: 'scheduled', userName: '系统定时同步' });
  } catch (error) {
    console.error('[Product projects] scheduled sync failed:', error.message);
  }
}
const productProjectSyncTimer = setInterval(checkScheduledProductProjectSync, 5 * 60 * 1000);
productProjectSyncTimer.unref?.();
setTimeout(checkScheduledProductProjectSync, 15_000).unref?.();
try {
  const latestSession = get('SELECT * FROM difference_compare_sessions ORDER BY created_at DESC, rowid DESC LIMIT 1');
  if (latestSession) rebuildLegacyOrderCompareSession(latestSession, { name: '系统修复', role: ROLE_ADMIN });
} catch (error) {
  console.error('[Difference repair] startup rebuild failed:', error);
}
try {
  const manualProgressParserVersion = '3';
  const appliedVersion = normalize(parseJson(
    get("SELECT mapping_json FROM import_mappings WHERE kind = 'manual-progress-parser-version'")?.mapping_json,
    ''
  ));
  if (appliedVersion !== manualProgressParserVersion) {
    const now = nowText();
    let result = { checked: 0, matched: 0, allocations: 0 };
    transaction(() => {
      result = reconcileActiveManualProgress('系统迁移', now);
      run(
        `INSERT INTO import_mappings (kind, mapping_json, updated_by, updated_at)
         VALUES ('manual-progress-parser-version', ?, '系统迁移', ?)
         ON CONFLICT(kind) DO UPDATE SET
           mapping_json = excluded.mapping_json,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
        [JSON.stringify(manualProgressParserVersion), now]
      );
    });
    console.info(`[Manual progress migration] v${manualProgressParserVersion}: ${result.checked} rows, ${result.allocations} allocations`);
  }
} catch (error) {
  console.error('[Manual progress migration] startup rebuild failed:', error);
}

app.listen(port, () => {
  console.log(`Gendanjindu server running at http://localhost:${port}`);
});
