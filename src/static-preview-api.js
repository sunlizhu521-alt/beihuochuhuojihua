const PREVIEW_PAGES = {
  inventorySummary: '库存汇总',
  inventoryRisk: '供应计划分析',
  supplyPlanBoard: '供应计划工具',
  beiHuoGongJu: '备货工具',
  beiHuoReviewLibrary: '备货文件导入',
  inventoryPurchase: '采购未交付',
  fullInventorySummary: '全量库存汇总',
  fullInventoryLibrary: '全量库存底表',
  inventorySummaryLibrary: '底表文件',
  inventoryManualLibrary: '手工表库',
  dimensionLibrary: '维度表库'
};

const ROUTE_CHANNELS = {
  overseasUs: {
    onHandSellableDays: 60,
    dispatchToShelfDays: 10,
    transportDays: 40,
    bookingDays: 10,
    averageLeadTimeDays: 45,
    contractSigningDays: 10,
    spotDays: 120,
    fullChainDays: 175,
    safetyDays: 175
  },
  overseasEurope: {
    onHandSellableDays: 60,
    dispatchToShelfDays: 10,
    transportDays: 55,
    bookingDays: 10,
    averageLeadTimeDays: 45,
    contractSigningDays: 10,
    spotDays: 135,
    fullChainDays: 190,
    safetyDays: 190
  },
  domestic: {
    onHandSellableDays: 30,
    dispatchToShelfDays: 7,
    transportDays: 7,
    bookingDays: 3,
    averageLeadTimeDays: 45,
    contractSigningDays: 10,
    spotDays: 47,
    fullChainDays: 102,
    safetyDays: 102
  }
};

const ANALYSIS_CHANNELS = Object.fromEntries(
  ['overseasUs', 'overseasEurope', 'domestic'].map((key) => [key, {
    onHandSellableDays: 10,
    dispatchToShelfDays: 10,
    transportDays: 10,
    bookingDays: 10,
    averageLeadTimeDays: 10,
    contractSigningDays: 10,
    restrictThresholdDays: 40,
    stopThresholdDays: 50,
    spotDays: 40,
    fullChainDays: 60
  }])
);

const ROUTE_PARAMS = { channels: ROUTE_CHANNELS };
const ANALYSIS_PARAMS = { forecastMonths: 6, historicalMonths: 6, channels: ANALYSIS_CHANNELS };

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function requestBody(init = {}) {
  try {
    return typeof init.body === 'string' ? JSON.parse(init.body) : {};
  } catch {
    return {};
  }
}

function previewPayload(pathname, method, init) {
  if (pathname === '/api/bootstrap') {
    return {
      user: { id: 'preview', name: '展示用户', role: '管理员', pageAccess: Object.keys(PREVIEW_PAGES) },
      pages: PREVIEW_PAGES,
      dimensionSlots: {},
      currentAppliedAt: ''
    };
  }
  if (pathname === '/api/inventory-summary') {
    return {
      updatedAt: '',
      months: [],
      totals: {},
      rows: [],
      quantityReconciliation: {
        status: 'warning',
        summary: { sourceCount: 0, checkedQuantity: 0, missingQuantity: 0, overlapQuantity: 0, issueSourceCount: 0, unappliedSourceCount: 0 },
        sources: [],
        groups: []
      },
      anomalies: []
    };
  }
  if (pathname === '/api/inventory-summary/manual-reconciliation') {
    return { updatedAt: '', manualReconciliation: { categories: [], rows: [] } };
  }
  if (pathname === '/api/full-inventory-summary') {
    return {
      updatedAt: '',
      months: [],
      groups: [
        { key: 'finished', label: '成品', rows: [] },
        { key: 'returnAccessory', label: '退货和配件', rows: [] },
        { key: 'undelivered', label: '未交付', rows: [] }
      ]
    };
  }
  if (pathname === '/api/supply-plan/summary') {
    return { ok: true, rows: [], generatedAt: new Date().toISOString(), params: ROUTE_PARAMS, updatedBy: '', updatedAt: '' };
  }
  if (pathname === '/api/supply-plan/params') {
    const body = requestBody(init);
    return { params: method === 'POST' && body.channels ? body : ROUTE_PARAMS, updatedBy: method === 'POST' ? '展示用户' : '', updatedAt: method === 'POST' ? new Date().toISOString() : '' };
  }
  if (pathname === '/api/inventory-risk/params' || pathname === '/api/bei-huo-gong-ju/params') {
    return { params: ANALYSIS_PARAMS, updatedBy: '', updatedAt: '' };
  }
  if (pathname === '/api/inventory-risk/query' || pathname === '/api/bei-huo-gong-ju/query') {
    const params = requestBody(init);
    return {
      ok: true,
      status: 'empty',
      rows: [],
      sourceVersion: '',
      generatedAt: new Date().toISOString(),
      params: Object.keys(params).length ? params : ANALYSIS_PARAMS,
      periods: {},
      summary: {},
      diagnostics: { mappingIssues: [], forecastIssues: [], forecastParsing: null },
      parameterSettings: { params: Object.keys(params).length ? params : ANALYSIS_PARAMS, updatedBy: '', updatedAt: '' }
    };
  }
  if (pathname === '/api/inventory-purchase-summary') return { updatedAt: '', months: [], rows: [] };
  if (pathname === '/api/dimensions') return { rows: [] };
  if (pathname.startsWith('/api/mappings/')) return { mapping: {} };
  return null;
}

export function installStaticPreviewApi() {
  if (!import.meta.env.VITE_STATIC_PREVIEW || typeof window === 'undefined') return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      return originalFetch(input, init);
    }
    const method = String(init.method || (typeof input === 'string' ? 'GET' : input.method) || 'GET').toUpperCase();
    const payload = previewPayload(url.pathname, method, init);
    if (payload) return jsonResponse(payload);
    return jsonResponse({ error: '当前为只读展示模式，该操作需要连接业务服务器。' }, 403);
  };
}
