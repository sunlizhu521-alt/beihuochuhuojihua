const STANDARD_FIELDS = [
  'projectName', 'businessUnit', 'productPositioning', 'projectStage', 'owner',
  'plannedLaunchDate', 'projectStatus', 'remark', 'materialCode', 'sku', 'modifiedAt',
  'priority', 'innovationType', 'responsibilityDepartment', 'technicalContact',
  'supplyChainContact', 'manufacturer', 'projectType', 'productLine',
  'demandInitiationDate', 'weeklyMeetingTitle', 'weeklyMeetingNote'
];

function text(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('、');
  if (typeof value === 'object') {
    return text(value.text ?? value.name ?? value.label ?? value.value ?? value.displayName ?? value.title);
  }
  return String(value).trim();
}

function salesProductLine(value) {
  const source = text(value);
  if (!source || source === '-') return '-';
  return text(source.split(/[（(]/, 1)[0]) || '-';
}

export function normalizeProjectIdentifier(value) {
  return text(value)
    .replace(/\u3000/g, ' ')
    .replace(/[\uFF01-\uFF5E]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, '')
    .replace(/\.0$/, '')
    .toUpperCase();
}

export function extractDingTalkBaseId(value) {
  const source = text(value);
  if (!source) return '';
  try {
    const url = new URL(source);
    const queryId = url.searchParams.get('baseId') || url.searchParams.get('base_id');
    if (queryId) return text(queryId);
    const match = url.pathname.match(/\/(?:bases?|nodes?)\/([^/?#]+)/i);
    if (match) return decodeURIComponent(match[1]);
  } catch {}
  return source.replace(/^.*\/(?:bases?|nodes?)\//i, '').split(/[/?#]/)[0].trim();
}

export function normalizeProjectMapping(input = {}) {
  const result = {};
  STANDARD_FIELDS.forEach((key) => { result[key] = text(input[key]); });
  if (!result.projectName) throw Object.assign(new Error('项目名称字段必须映射'), { status: 400 });
  return result;
}

function dateValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const source = text(value);
  if (!source) return '';
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function fieldValue(fields, mappedField) {
  if (!mappedField) return '';
  if (Object.hasOwn(fields || {}, mappedField)) return fields[mappedField];
  const matchedKey = Object.keys(fields || {}).find((key) => text(key) === text(mappedField));
  return matchedKey ? fields[matchedKey] : '';
}

export function mapDingTalkProjectRecord(record, mapping) {
  const fields = record?.fields || {};
  const mapped = {};
  STANDARD_FIELDS.forEach((key) => { mapped[key] = fieldValue(fields, mapping[key]); });
  const modifiedAt = dateValue(mapped.modifiedAt) || dateValue(record?.lastModifiedTime);
  return {
    sourceRecordId: text(record?.id),
    projectName: text(mapped.projectName),
    businessUnit: text(mapped.businessUnit) || '未分配事业部',
    productPositioning: text(mapped.productPositioning),
    projectStage: text(mapped.projectStage),
    owner: text(mapped.owner),
    plannedLaunchDate: dateValue(mapped.plannedLaunchDate),
    projectStatus: text(mapped.projectStatus),
    remark: text(mapped.remark),
    materialCode: text(mapped.materialCode),
    sku: text(mapped.sku),
    priority: text(mapped.priority),
    innovationType: text(mapped.innovationType) || text(mapped.productPositioning),
    responsibilityDepartment: text(mapped.responsibilityDepartment) || text(mapped.businessUnit) || '未分配事业部',
    technicalContact: text(mapped.technicalContact),
    supplyChainContact: text(mapped.supplyChainContact),
    manufacturer: text(mapped.manufacturer),
    projectType: text(mapped.projectType),
    productLine: text(mapped.productLine),
    demandInitiationDate: dateValue(mapped.demandInitiationDate),
    weeklyMeetingTitle: text(mapped.weeklyMeetingTitle),
    weeklyMeetingNote: text(mapped.weeklyMeetingNote),
    sourceModifiedAt: modifiedAt,
    sourceCreatedAt: dateValue(record?.createdTime),
    rawJson: JSON.stringify(record || {})
  };
}

function projectIdentity(row) {
  const businessUnit = text(row.businessUnit) || '未分配事业部';
  const materialCode = normalizeProjectIdentifier(row.materialCode);
  if (materialCode) return `${businessUnit}|material:${materialCode}`;
  const sku = normalizeProjectIdentifier(row.sku);
  if (sku) return `${businessUnit}|sku:${sku}`;
  return `record:${text(row.sourceRecordId)}`;
}

function modifiedTime(row) {
  return Date.parse(row.sourceModifiedAt || row.sourceCreatedAt || '') || 0;
}

export function normalizeProjectRecords(records = [], mapping = {}) {
  const validMapping = normalizeProjectMapping(mapping);
  const latest = new Map();
  const materialIndex = new Map();
  const skuIndex = new Map();
  const report = { sourceCount: records.length, acceptedCount: 0, missingNameCount: 0, duplicateCount: 0, invalidDateCount: 0 };
  records.forEach((record) => {
    const row = mapDingTalkProjectRecord(record, validMapping);
    if (!row.projectName) {
      report.missingNameCount += 1;
      return;
    }
    if (fieldValue(record?.fields || {}, validMapping.plannedLaunchDate) && !row.plannedLaunchDate) report.invalidDateCount += 1;
    if (fieldValue(record?.fields || {}, validMapping.demandInitiationDate) && !row.demandInitiationDate) report.invalidDateCount += 1;
    const businessUnit = text(row.businessUnit) || '未分配事业部';
    const materialKey = normalizeProjectIdentifier(row.materialCode) ? `${businessUnit}|${normalizeProjectIdentifier(row.materialCode)}` : '';
    const skuKey = normalizeProjectIdentifier(row.sku) ? `${businessUnit}|${normalizeProjectIdentifier(row.sku)}` : '';
    const key = (materialKey && materialIndex.get(materialKey)) || (skuKey && skuIndex.get(skuKey)) || projectIdentity(row);
    const previous = latest.get(key);
    if (previous) {
      report.duplicateCount += 1;
      if (modifiedTime(previous) > modifiedTime(row)) return;
    }
    latest.set(key, row);
    if (materialKey) materialIndex.set(materialKey, key);
    if (skuKey) skuIndex.set(skuKey, key);
  });
  const rows = [...latest.values()].sort((left, right) => (
    left.businessUnit.localeCompare(right.businessUnit, 'zh-Hans-CN')
    || left.projectName.localeCompare(right.projectName, 'zh-Hans-CN')
    || left.sourceRecordId.localeCompare(right.sourceRecordId)
  ));
  report.acceptedCount = rows.length;
  return { rows, report };
}

export function linkProjectsToProducts(projectRows = [], productRows = []) {
  const materialIndex = new Map();
  const skuIndex = new Map();
  productRows.forEach((row) => {
    const material = normalizeProjectIdentifier(row.materialCode);
    const sku = normalizeProjectIdentifier(row.sku);
    if (material && !materialIndex.has(material)) materialIndex.set(material, row.id);
    if (sku && !skuIndex.has(sku)) skuIndex.set(sku, row.id);
  });
  return projectRows.map((row) => {
    const materialProductId = materialIndex.get(normalizeProjectIdentifier(row.materialCode)) || '';
    const skuProductId = skuIndex.get(normalizeProjectIdentifier(row.sku)) || '';
    if (materialProductId && skuProductId && materialProductId !== skuProductId) {
      return { ...row, linkStatus: '关联冲突', linkedProductId: '', linkMessage: '物料编码与SKU指向不同产品' };
    }
    const linkedProductId = materialProductId || skuProductId;
    return {
      ...row,
      linkStatus: linkedProductId ? '已关联' : '未关联',
      linkedProductId,
      linkMessage: linkedProductId ? (materialProductId ? '按物料编码关联' : '按SKU关联') : '未找到在售产品'
    };
  });
}

export function buildProjectMetrics(rows = [], now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 90);
  const counts = (valueForRow) => [...rows.reduce((map, row) => {
    const label = text(valueForRow(row)) || '未填写';
    map.set(label, (map.get(label) || 0) + 1);
    return map;
  }, new Map())].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'zh-Hans-CN'));
  const salesProductLines = counts((row) => salesProductLine(row.productLine));
  return {
    totalProjects: rows.length,
    businessUnitCount: new Set(rows.map((row) => text(row.responsibilityDepartment || row.businessUnit)).filter(Boolean)).size,
    stageCount: new Set(rows.map((row) => text(row.projectStage)).filter(Boolean)).size,
    salesProductLineCount: salesProductLines.length,
    launchWithin90Days: rows.filter((row) => {
      const time = Date.parse(row.demandInitiationDate || '');
      return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
    }).length,
    businessUnits: counts((row) => row.responsibilityDepartment || row.businessUnit),
    stages: counts((row) => row.projectStage),
    salesProductLines
  };
}

export function shouldRunDailyProjectSync({ now = new Date(), lastSuccessAt = '', running = false } = {}) {
  if (running) return false;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  if (Number(parts.hour) === 0 && Number(parts.minute) < 30) return false;
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (!lastSuccessAt) return true;
  const successDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(lastSuccessAt));
  return successDate !== today;
}

function publicError(message, status = 400) {
  return Object.assign(new Error(message), { status, publicMessage: message });
}

async function requestJson(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = text(payload.message || payload.errorMessage || payload.error || `钉钉请求失败（${response.status}）`);
        if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 500));
          continue;
        }
        throw publicError(message, response.status);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || (error.status && error.status < 500 && error.status !== 429)) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    } finally {
      clearTimeout(timer);
    }
  }
  throw publicError(lastError?.name === 'AbortError' ? '钉钉请求超时' : (lastError?.message || '钉钉请求失败'), lastError?.status || 502);
}

let tokenCache = { token: '', expiresAt: 0 };

export async function dingTalkAccessToken({ appKey, appSecret }) {
  if (!appKey || !appSecret) throw publicError('腾讯云尚未配置钉钉 AppKey/AppSecret');
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const payload = await requestJson('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appKey, appSecret })
  });
  tokenCache = { token: text(payload.accessToken), expiresAt: Date.now() + Math.max(60, Number(payload.expireIn) || 7200) * 1000 };
  if (!tokenCache.token) throw publicError('钉钉未返回访问令牌');
  return tokenCache.token;
}

export function createDingTalkProjectClient({ appKey, appSecret, operatorId }) {
  if (!operatorId) throw publicError('腾讯云尚未配置 DINGTALK_OPERATOR_ID');
  async function call(path, { method = 'GET', body } = {}) {
    const token = await dingTalkAccessToken({ appKey, appSecret });
    const separator = path.includes('?') ? '&' : '?';
    return requestJson(`https://api.dingtalk.com/v1.0/notable${path}${separator}operatorId=${encodeURIComponent(operatorId)}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }
  return {
    async listSheets(baseId) {
      const payload = await call(`/bases/${encodeURIComponent(baseId)}/sheets`);
      return payload.value || [];
    },
    async listFields(baseId, sheetId) {
      const payload = await call(`/bases/${encodeURIComponent(baseId)}/sheets/${encodeURIComponent(sheetId)}/fields`);
      return payload.value || [];
    },
    async listAllRecords(baseId, sheetId, fieldIdOrNames = []) {
      const records = [];
      let nextToken = '';
      do {
        const payload = await call(`/bases/${encodeURIComponent(baseId)}/sheets/${encodeURIComponent(sheetId)}/records/list`, {
          method: 'POST', body: { maxResults: 100, ...(nextToken ? { nextToken } : {}), ...(fieldIdOrNames.length ? { fieldIdOrNames } : {}) }
        });
        records.push(...(payload.records || []));
        nextToken = payload.hasMore ? text(payload.nextToken) : '';
      } while (nextToken);
      return records;
    }
  };
}
