
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
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';
import { all, get, initDatabase, run, runMany, saveDatabase, transaction } from './database.js';

import { buildFullInventorySummary, inspectFullInventoryWorkbook, inspectOrderFulfillmentWorkbook, parseFullInventoryWorkbook, parseOrderFulfillmentWorkbook } from './full-inventory.js';
import {
  buildInventorySummaryModel,
  isInventorySummarySlot,
  parseInventoryManualWorkbook,
  parseInventorySummaryWorkbook
} from './inventory-summary.js';
import {
  buildBeiHuoReviewAnalysis,
  buildInventoryRiskAnalysis,
  inventoryRiskCacheKey,
  normalizeInventoryRiskParams,
  normalizeSupplyPlanParams
} from './inventory-risk.js';
import { buildInventoryRiskWorkbook } from './inventory-risk-export.js';
import { buildSupplyPlanData, paginateSupplyPlanData, supplyPlanModelDetail } from './supply-plan.js';


import { buildStyledExcelBuffer } from '../shared/excel-export.js';
import { MAPPED_SLOT_CONFIGS } from '../shared/dimension-slot-config.js';
import { mappingValidation } from '../shared/dimension-mapping.js';






const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4003);
const ADMIN_NAME = process.env.ADMIN_NAME || '孙立柱';
const ROLE_ADMIN = '管理员';


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
  warehouseMaterialMap: '产品迭代关系',
  dimensionSpare: '产品定位',
  lingxingWarehouseMap: '安全库存',
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
  inventorySummaryFile18: '库存数据',
  inventorySummaryFile19: '未交付数据',
  inventorySummaryFile20: '销售数据',
  inventorySummaryFile21: 'M+6 预测',
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
Object.values(MAPPED_SLOT_CONFIGS).forEach((slot) => {
  DIMENSION_SLOTS[slot.id] = slot.title;
});
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






const UNASSIGNED_PURCHASE_OWNER = '未分配采购下单人';



const app = express();
const UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_LIMIT_BYTES } });
const kingdeeUploadDir = path.join(os.tmpdir(), 'beihuochuhuojihua-uploads');
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





function safeFilename(file) {
  return Buffer.from(file.originalname, 'latin1').toString('utf8');
}



















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
  return {
    sheetNames: workbook.SheetNames,
    sheetPreviews,
    sheets,
    columns: [...new Set(sheets.flatMap((sheet) => sheet.columns || []))],
    rows: sheets.flatMap((sheet) => sheet.rows)
  };
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

function configuredMappedRow(slotId, row, mapping) {
  const config = MAPPED_SLOT_CONFIGS[slotId];
  if (!config) return null;
  const mapped = Object.fromEntries(config.fields.map(([key]) => [key, pick(row, mapping[key])]));
  return /^inventorySummaryFile(?:18|19|20|21)$/.test(slotId)
    ? { ...row, ...mapped }
    : { raw: row, ...mapped };
}

function validateConfiguredSlotMapping(slotId, mapping, columns) {
  const config = MAPPED_SLOT_CONFIGS[slotId];
  if (!config) return;
  const validation = mappingValidation(mapping, config.fields, config.requiredFields || [], columns || []);
  const labels = new Map(config.fields.map(([key, label]) => [key, label]));
  if (validation.missingFields.length) {
    const missing = validation.missingFields.map((key) => labels.get(key) || key).join('、');
    const error = new Error(`${config.title}缺少必选字段映射：${missing}`);
    error.status = 400;
    error.publicMessage = error.message;
    throw error;
  }
  if (validation.duplicateColumns.length) {
    const duplicate = validation.duplicateColumns.map(({ column, targets }) => `${column}→${targets.join('、')}`).join('；');
    const error = new Error(`${config.title}同一源列不能重复映射：${duplicate}`);
    error.status = 400;
    error.publicMessage = error.message;
    throw error;
  }
  if (validation.unknownColumns.length) {
    const error = new Error(`${config.title}映射的源列不存在：${[...new Set(validation.unknownColumns)].join('、')}`);
    error.status = 400;
    error.publicMessage = error.message;
    throw error;
  }
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



























function getDimensionRows(slotId) {
  const record = get('SELECT rows_json, applied FROM dimension_files WHERE slot_id = ?', [slotId]);
  if (!record?.applied) return [];
  return parseJson(record.rows_json, []);
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



function resolveAssignment(lookups, supplier, materialCode) {
  const supplierAssignment = resolveSupplierAssignment(lookups, supplier, materialCode);
  if (assignmentOwner(supplierAssignment)) return supplierAssignment;
  const materialRows = assignmentRowsForMaterial(lookups, materialCode);
  return selectUniqueAssignment(materialRows);
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
    let ownerRows = 0;
    let keyRows = 0;
    rows.forEach((row) => {
      const owner = assignmentOwner(row);
      const materialCode = assignmentMaterialCode(row);
      const suppliers = assignmentSupplierCandidates(row);
      if (owner) ownerRows++;
      if (materialCode && suppliers.length) keyRows++;
    });
    return { totalRows: rows.length, ownerRows, keyRows };
  }
  if (slotId === 'productCategory') {
    const materialSet = new Set(rows.map((row) => normalizeMatchPart(row.materialCode)).filter(Boolean));
    return { totalRows: rows.length, keyRows: materialSet.size };
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
  const fulfillmentRows = parseJson(fulfillmentRecord?.rows_json, []);
  const undeliveredRows = fulfillmentRows.map((row) => ({
    business_unit: row.businessUnit,
    material_code: row.materialCode,
    undelivered_qty: row.manualRemainingQty
  }));
  const summary = buildFullInventorySummary({
    inventoryRows: parseJson(inventoryRecord?.rows_json, []),
    productRows: getDimensionRows('productCategory'),
    salesRows: parseJson(salesRecord?.rows_json, []),
    undeliveredRows,
    updatedAt: inventoryRecord?.updated_at || ''
  });
  const undeliveredGroup = summary.groups.find((group) => group.key === 'undelivered');
  if (undeliveredGroup) undeliveredGroup.rows = fulfillmentRows;
  return summary;
}

let inventoryRiskResultCache = { key: '', payload: null };
const INVENTORY_RISK_SETTING_KEY = 'global';
const BEI_HUO_GONG_JU_SETTING_KEY = 'beiHuoGongJu';
let beiHuoGongJuResultCache = { key: '', payload: null };
const supplyPlanResultCache = new Map();

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

function supplyPlanSourceData() {
  return Object.fromEntries(['inventorySummaryFile18', 'inventorySummaryFile19', 'inventorySummaryFile21'].map((slotId) => [
    slotId,
    { rows: getDimensionRows(slotId) }
  ]));
}

function supplyPlanDimensionData() {
  const legacyFeedbackRows = all(
    `SELECT rows_json
     FROM dimension_files
     WHERE slot_id LIKE 'businessUnitFeedback%' AND applied = 1
     ORDER BY slot_id`
  ).flatMap((record) => parseJson(record.rows_json, []));
  const currentPositioningRows = getDimensionRows('dimensionSpare').map((row) => ({
    ...row,
    productLifecycle: row.productLifecycle || row.unifiedStage || '',
    productPositioning: row.productPositioning || row.unifiedPositioning || ''
  }));
  return {
    productCategory: getDimensionRows('productCategory'),
    businessUnitFeedback: [...legacyFeedbackRows, ...currentPositioningRows],
    warehouseName: getDimensionRows('spare1')
  };
}

function inventoryRiskSourceVersion() {
  return all(
    'SELECT slot_id, file_name, updated_at, applied, length(rows_json) AS rows_size FROM dimension_files WHERE applied = 1 ORDER BY slot_id'
  ).map((row) => [row.slot_id, row.file_name, row.updated_at, row.applied, row.rows_size].join(':')).join('|');
}

function supplyPlanDataset(months) {
  const settings = currentSupplyPlanSettings();
  const sourceVersion = inventoryRiskSourceVersion();
  const cacheKey = `${sourceVersion}\u001f${settings.updatedAt}\u001f${months}`;
  if (supplyPlanResultCache.has(cacheKey)) {
    return { payload: supplyPlanResultCache.get(cacheKey), settings };
  }
  const payload = buildSupplyPlanData({
    inventorySummaryData: supplyPlanSourceData(),
    dimensionData: supplyPlanDimensionData(),
    supplyPlanSettings: settings.params,
    months
  });
  supplyPlanResultCache.set(cacheKey, payload);
  while (supplyPlanResultCache.size > 8) {
    supplyPlanResultCache.delete(supplyPlanResultCache.keys().next().value);
  }
  return { payload, settings };
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













































































































function currentAppliedAt() {
  const record = get(
    `SELECT updated_at
     FROM dimension_files
     WHERE applied = 1
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  return normalize(record?.updated_at);
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

app.get('/api/supply-plan/summary', requireAuth, requirePage('supplyPlanBoard'), (req, res) => {
  try {
    const months = req.query.horizonMonths ?? req.query.months;
    const { payload, settings } = supplyPlanDataset(months);
    const pagePayload = paginateSupplyPlanData(payload, {
      page: req.query.page,
      pageSize: req.query.pageSize,
      filters: {
        businessUnit: req.query.businessUnit,
        productLine: req.query.productLine,
        productSeries: req.query.productSeries
      }
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ...pagePayload,
      params: settings.params,
      updatedBy: settings.updatedBy,
      updatedAt: settings.updatedAt
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || '供应计划数据生成失败' });
  }
});

app.get('/api/supply-plan/model-detail', requireAuth, requirePage('supplyPlanBoard'), (req, res) => {
  try {
    const months = req.query.horizonMonths ?? req.query.months;
    const { payload } = supplyPlanDataset(months);
    const detail = supplyPlanModelDetail(payload, {
      modelKey: req.query.modelKey,
      model: req.query.model,
      filters: {
        businessUnit: req.query.businessUnit,
        productLine: req.query.productLine,
        productSeries: req.query.productSeries
      }
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.json(detail);
  } catch (error) {
    return res.status(400).json({ error: error.message || '供应计划型号明细生成失败' });
  }
});

app.get('/api/supply-plan/dimension-data', requireAuth, requirePage('supplyPlanBoard'), (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json(supplyPlanDimensionData());
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



















app.post('/api/workbook/inspect', requireAuth, kingdeeUpload.single('file'), cleanupKingdeeUpload, async (req, res) => {
  const sheetName = normalize(req.body.sheetName);
  const slotId = normalize(req.body.slotId);
  const baseSlotId = inventoryLibraryBaseSlotId(slotId);
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
  res.json(workbookInspect(file, sheetName || null));
});

















































































































app.get('/api/dimensions', requireAuth, requireAnyPage(['dimensionLibrary', 'businessUnitFeedback', 'wangdianData', 'lingxingInventory', 'inventorySummaryLibrary', 'inventoryManualLibrary', 'firstMileDatabase', 'beiHuoReviewLibrary', 'fullInventoryLibrary']), (req, res) => {
  const rows = all('SELECT slot_id, title, file_name, sheet_name, sheet_names, selected_sheet_names, mapping_json, rows_json, source_file_size, applied, uploaded_by, updated_at FROM dimension_files');
  res.json({
    rows: rows.map((row) => {
      const dimensionRows = parseJson(row.rows_json, []);
      const mapping = parseJson(row.mapping_json, {});
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

app.post('/api/dimensions/:slotId/upload', requireAuth, requireAnyPage(['dimensionLibrary', 'businessUnitFeedback', 'wangdianData', 'lingxingInventory', 'inventorySummaryLibrary', 'inventoryManualLibrary', 'firstMileDatabase', 'beiHuoReviewLibrary', 'fullInventoryLibrary']), dimensionWorkbookUpload, cleanupKingdeeUpload, serializeInventoryUpload, async (req, res) => {
  const slotId = req.params.slotId;
  const baseSlotId = inventoryLibraryBaseSlotId(slotId);
  const mapping = parseJson(req.body.mapping, {});
  const sheetName = normalize(req.body.sheetName);
  const selectedSheetNames = parseJson(req.body.sheetNames, [])
    .map(normalize)
    .filter((name, index, names) => name && names.indexOf(name) === index);
  const configuredSlot = MAPPED_SLOT_CONFIGS[slotId];
  if (configuredSlot?.requiresSheetSelection) {
    const sheetNames = await workbookSheetNamesFromUpload(req.file);
    if (sheetName && !sheetNames.includes(sheetName)) {
      const error = new Error(`${configuredSlot.title}选择的工作表不存在，请重新选择`);
      error.status = 400;
      error.publicMessage = error.message;
      throw error;
    }
    if (sheetNames.length > 1 && !sheetName) {
      const error = new Error(`${configuredSlot.title}包含多个工作表，请先选择要应用的工作表`);
      error.status = 400;
      error.publicMessage = error.message;
      throw error;
    }
  }
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
  const parsed = inventoryParsed || fullInventoryParsed || (
    ['inventorySummaryFile15', 'inventorySummaryFile16'].includes(baseSlotId)
      ? await streamingKingdeeWorkbookRows(
        req.file,
        baseSlotId === 'inventorySummaryFile16' ? selectedSheetNames : sheetName || null,
        { includePreviews: false, stringifyValues: true }
      )
      : workbookRows(inventorySummaryFile, sheetName || null, { includePreviews: false })
  );
  validateConfiguredSlotMapping(slotId, mapping, parsed.columns || []);
  const rowMapping = slotId === 'spare1' && parsed.columns?.[7]
    ? { ...mapping, level2WarehouseCategory: parsed.columns[7] }
    : mapping;
  const parsedRows = inventoryParsed || fullInventoryParsed ? parsed.rows : parsed.rows.map((row) => {
    const configuredRow = configuredMappedRow(slotId, row, mapping);
    if (configuredRow) return configuredRow;
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
  const storedMapping = inventoryParsed?.mapping || fullInventoryParsed?.mapping || rowMapping;
  const now = nowText();
  transaction(() => {
    run(
      `INSERT INTO dimension_files (slot_id, title, file_name, sheet_name, sheet_names, selected_sheet_names, mapping_json, rows_json, applied, uploaded_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(slot_id) DO UPDATE SET title = excluded.title, file_name = excluded.file_name, sheet_name = excluded.sheet_name, sheet_names = excluded.sheet_names, selected_sheet_names = excluded.selected_sheet_names, mapping_json = excluded.mapping_json, rows_json = excluded.rows_json, applied = 1, uploaded_by = excluded.uploaded_by, updated_at = excluded.updated_at`,
      [slotId, DIMENSION_SLOTS[slotId] || slotId, safeFilename(req.file), fullInventoryParsed ? '' : inventoryParsed?.sheetName || sheetName, JSON.stringify(parsed.sheetNames), JSON.stringify(fullInventoryParsed ? fullInventoryParsed.selectedSheetNames : !isInventoryManualSlot(slotId) && baseSlotId === 'inventorySummaryFile16' ? selectedSheetNames : []), JSON.stringify(storedMapping), JSON.stringify(rows), req.user.name, now]
    );
  });
  res.json({
    rowCount: rows.length,
    sheetName: fullInventoryParsed ? '' : inventoryParsed?.sheetName || sheetName,
    sheetNames: parsed.sheetNames,
    selectedSheetNames: fullInventoryParsed ? fullInventoryParsed.selectedSheetNames : !isInventoryManualSlot(slotId) && baseSlotId === 'inventorySummaryFile16' ? selectedSheetNames : [],
    applied: true,
    diagnostics: dimensionDiagnostics(slotId, rows),
    parseSummary: inventoryParsed?.mapping?.__inventorySummary || inventoryParsed?.mapping?.__inventoryManual || null
  });
});

app.post('/api/dimensions/:slotId/apply', requireAuth, requireAnyPage(['dimensionLibrary', 'businessUnitFeedback', 'wangdianData', 'lingxingInventory', 'inventorySummaryLibrary', 'inventoryManualLibrary', 'firstMileDatabase', 'beiHuoReviewLibrary', 'fullInventoryLibrary']), (req, res) => {
  transaction(() => {
    run('UPDATE dimension_files SET applied = 1, updated_at = ? WHERE slot_id = ?', [nowText(), req.params.slotId]);
  });
  res.json({ applied: true });
});

app.delete('/api/dimensions/:slotId', requireAuth, requireAnyPage(['dimensionLibrary', 'businessUnitFeedback', 'wangdianData', 'lingxingInventory', 'inventorySummaryLibrary', 'inventoryManualLibrary', 'firstMileDatabase', 'beiHuoReviewLibrary', 'fullInventoryLibrary']), (req, res) => {
  run('DELETE FROM dimension_files WHERE slot_id = ?', [req.params.slotId]);
  saveDatabase();
  res.json({ ok: true });
});









































// ===== 数据完整性：修复 supplier_short_name =====




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
app.use('/beihuochuhuojihua/assets', (_req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  next();
});
app.use('/beihuochuhuojihua', express.static(distDir));
app.use(express.static(distDir));
app.get(/^\/beihuochuhuojihua\/(?!api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));

await initDatabase();app.listen(port, () => {
  console.log(`Beihuochuhuojihua server running at http://localhost:${port}`);
});
