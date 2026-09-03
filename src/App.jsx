import React, { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { writeStyledExcelFile } from '../shared/excel-export.js';
import { DIMENSION_SLOTS, INVENTORY_SUMMARY_LIBRARY_SLOTS } from '../shared/dimension-slot-config.js';
import { duplicateMappingColumns, validMappingForColumns } from '../shared/dimension-mapping.js';
import { API } from './api-base.js';
import { getLoadingProgress, installGlobalFetchProgress, subscribeLoadingProgress } from './loading-progress.js';

const InventoryCalculationGuide = React.lazy(() => import('./InventoryCalculationGuide.jsx'));
const SupplyPlanBoard = React.lazy(() => import('./SupplyPlanBoard.jsx'));
const FullInventorySummaryPage = React.lazy(() => import('./FullInventorySummaryPage.jsx'));

installGlobalFetchProgress();

const ACTIVE_PAGE_KEY = 'gendanjinduActivePage';

const PAGE_ORDER = [
  'supplyPlanBoard',
  'fullInventorySummary',
  'inventorySummaryLibrary',
  'dimensionLibrary'
];

const PAGE_LABELS = {
  supplyPlanBoard: '供应计划工具',
  fullInventorySummary: '全量库存汇总',
  inventorySummaryLibrary: '底表文件',
  dimensionLibrary: '维度表库'
};

const NAV_GROUPS = [
  { title: '备货计划', pages: ['supplyPlanBoard'] },
  { title: '全量库存', pages: ['fullInventorySummary'] },
  { title: '库存数据', pages: ['inventorySummaryLibrary'] },
  { title: '维护数据', pages: ['dimensionLibrary'] }
];

function visiblePagesForUser(user) {
  const directPages = PAGE_ORDER.filter((page) => user?.role === '管理员' || user?.pageAccess?.includes(page));
  return PAGE_ORDER.filter((page) => directPages.includes(page));
}

function storedActivePage() {
  try {
    return window.sessionStorage.getItem(ACTIVE_PAGE_KEY) || '';
  } catch {
    return '';
  }
}

function resolveActivePage(user, currentPage = '') {
  const visiblePages = visiblePagesForUser(user);
  if (visiblePages.includes(currentPage)) return currentPage;
  const savedPage = storedActivePage();
  if (visiblePages.includes(savedPage)) return savedPage;
  return visiblePages[0] || '';
}

const BUSINESS_UNIT_FEEDBACK_FIELDS = [
  ['materialCode', '物料编码'],
  ['sku', 'SKU'],
  ['productLifecycle', '产品生命周期'],
  ['productPositioning', '产品定位'],
  ['feedbackRemark', '反馈备注']
];

const PRODUCT_PROJECT_FIELDS = [
  ['projectName', '项目名称'],
  ['priority', '优先级'],
  ['innovationType', '创新类型'],
  ['projectStage', '当前阶段'],
  ['responsibilityDepartment', '责任部门'],
  ['owner', '项目负责人'],
  ['technicalContact', '技术对接人'],
  ['supplyChainContact', '供应链对接人'],
  ['manufacturer', '生产商（已重新盘点）'],
  ['projectType', '项目类型'],
  ['productLine', '产品线'],
  ['demandInitiationDate', '1-需求立项'],
  ['weeklyMeetingNote', '最新周会纪要']
];




function normalize(value) {
  return String(value ?? '').trim();
}

function numberValue(value) {
  const n = Number(normalize(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function formatQuantity(value) {
  return numberValue(value).toLocaleString('zh-CN');
}

function signedNumber(value) {
  const n = numberValue(value);
  if (n > 0) return `+${n.toLocaleString()}`;
  return n.toLocaleString();
}

function differenceEntryExplanation(row) {
  const oldQty = numberValue(row.oldQty);
  const newQty = numberValue(row.newQty);
  const oldInboundQty = numberValue(row.oldInboundQty);
  const deltaQty = newQty - oldQty;

  if (oldQty > 0 && newQty === 0 && oldQty !== oldInboundQty) {
    const outstandingQty = oldQty - oldInboundQty;
    if (outstandingQty > 0) {
      return `该采购订单和物料在新文件中已不存在；原采购数量 ${oldQty.toLocaleString()}，累计入库 ${oldInboundQty.toLocaleString()}，仍有 ${outstandingQty.toLocaleString()} 未入库，不能按正常业务关闭处理，需要确认取消、减少或其他原因。`;
    }
    return `该采购订单和物料在新文件中已不存在；原采购数量 ${oldQty.toLocaleString()}，累计入库 ${oldInboundQty.toLocaleString()}，两者不一致，不能按正常业务关闭处理，需要确认原因和处理方式。`;
  }

  if (oldQty > 0 && newQty > 0 && deltaQty !== 0) {
    const direction = deltaQty > 0 ? '增加' : '减少';
    return `同一采购订单和物料在新旧文件中都存在，采购数量由 ${oldQty.toLocaleString()} 调整为 ${newQty.toLocaleString()}，${direction} ${Math.abs(deltaQty).toLocaleString()}，需要确认${direction}原因和处理方式。`;
  }

  return '采购数量存在需要人工确认的变化，请核对原、新采购数据并填写原因和处理方式。';
}

function supplierName(row) {
  return normalize(row.supplierShortName) || normalize(row.supplier);
}

function progressSupplierName(row) {
  return normalize(row.orderSupplierShortName) || '未匹配';
}

function formatProgressPurchasePrice(value, maintained = true) {
  if (!maintained) return '未维护';
  const price = numberValue(value);
  if (Math.abs(price - 1e-9) < 1e-12) return '配件无采购价';
  return price.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
}

function exportProgressPurchasePrice(value, maintained = true) {
  if (!maintained) return '未维护';
  const price = numberValue(value);
  if (Math.abs(price - 1e-9) < 1e-12) return '配件无采购价';
  return Math.round(price * 10) / 10;
}

function orderSupplierName(row) {
  return normalize(row.orderSupplierShortName) || '未匹配';
}

function uniqueProgressValues(values) {
  return [...new Set(values.map(normalize).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
}

function formatProgressMonthLabel(values, fallback = '-') {
  const months = (Array.isArray(values) ? values : [values]).map(normalize).filter(Boolean);
  if (!months.length) return fallback;
  return months.map((month) => {
    const match = month.match(/^(\d{4})-(\d{1,2})/);
    return match ? `${match[1]}年${match[2].padStart(2, '0')}月` : month;
  }).join('、');
}

function compareProgressMonths(left, right) {
  if (left === '待核验') return right === '待核验' ? 0 : 1;
  if (right === '待核验') return -1;
  return right.localeCompare(left, 'zh-Hans-CN');
}

function addOrderGroupToSupplierRollup(rollup, orderGroup) {
  rollup.orderGroups.push(orderGroup);
  rollup.supplierShortNames.add(orderGroup.supplierShortName);
  orderGroup.productLines.forEach((value) => rollup.productLines.add(value));
  orderGroup.productSeriesValues.forEach((value) => rollup.productSeriesValues.add(value));
  orderGroup.reportingQuantities.forEach((quantity, key) => {
    if (rollup.reportingQuantities.has(key)) return;
    rollup.reportingQuantities.set(key, quantity);
    rollup.reportingPurchaseQty += numberValue(quantity);
  });
  orderGroup.remainingInboundQuantities.forEach((quantity, key) => {
    if (rollup.remainingInboundQuantities.has(key)) return;
    rollup.remainingInboundQuantities.set(key, quantity);
    rollup.remainingInboundQty += numberValue(quantity);
  });
}

function uniqueSupplierShortNames(values) {
  return uniqueProgressValues(values).sort((left, right) => {
    if (left === '未匹配') return -1;
    if (right === '未匹配') return 1;
    return left.localeCompare(right, 'zh-Hans-CN');
  });
}

const FILTER_CACHE_PREFIX = 'gendanjindu:filters:';

function useSessionFilters(cacheKey, initialFilters) {
  const storageKey = `${FILTER_CACHE_PREFIX}${cacheKey}`;
  const [filters, setFilters] = useState(() => {
    if (typeof window === 'undefined') return initialFilters;
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      const parsed = saved ? JSON.parse(saved) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...initialFilters, ...parsed };
      }
    } catch {
      // Ignore corrupted browser cache and fall back to defaults.
    }
    return initialFilters;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(storageKey, JSON.stringify(filters));
  }, [storageKey, filters]);

  return [filters, setFilters];
}

function TightCell({ value }) {
  const text = normalize(value);
  return <span className="tight-cell" title={text}>{text}</span>;
}

function actionsForDelta(deltaQty) {
  const value = numberValue(deltaQty);
  if (value > 0) return ['增加', '其他'];
  if (value < 0) return ['减少', '取消', '其他'];
  return ['其他'];
}

const DIFF_NORMAL_ORDER = '正常订单';
const DIFF_ORDER_COMPLETE_REASON = '订单已完结';
const DIFF_ORDER_COMPLETE_ACTION = '订单已完结';

function actionsForDiffReason(deltaQty, reason) {
  const actions = actionsForDelta(deltaQty);
  if (normalize(reason) === DIFF_NORMAL_ORDER) return [DIFF_NORMAL_ORDER];
  if (normalize(reason) === DIFF_ORDER_COMPLETE_REASON) return [DIFF_ORDER_COMPLETE_ACTION];
  return actions;
}

function todayText() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysSince(value) {
  if (!value) return Infinity;
  const parsed = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return Infinity;
  return (Date.now() - parsed.getTime()) / 86400000;
}

function progressTotal(row) {
  return numberValue(row.inProductionQty) + numberValue(row.finishedQty);
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, {
  token,
  networkRetries = 0,
  retryDelayMs = 600,
  timeoutMs = 0,
  ...options
} = {}) {
  const headers = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...authHeaders(token),
    ...(options.headers || {})
  };
  const retries = Math.max(0, Math.floor(numberValue(networkRetries)));
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeoutController = timeoutMs > 0 && !options.signal ? new AbortController() : null;
    const timeoutId = timeoutController
      ? globalThis.setTimeout(() => timeoutController.abort(), timeoutMs)
      : null;
    let res;
    let text = '';
    try {
      res = await fetch(`${API}${path}`, {
        ...options,
        headers,
        signal: options.signal || timeoutController?.signal
      });
      text = await res.text();
    } catch (error) {
      if (timeoutId) globalThis.clearTimeout(timeoutId);
      if (options.signal?.aborted) throw error;
      if (attempt < retries) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, retryDelayMs * (attempt + 1)));
        continue;
      }
      const retried = retries ? `（已自动重试${retries}次）` : '';
      if (timeoutController?.signal.aborted) {
        throw new Error(`请求超时${retried}，请稍后重试`);
      }
      throw new Error(`网络连接失败${retried}，请检查网络后重试`);
    }
    if (timeoutId) globalThis.clearTimeout(timeoutId);
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = {};
    }
    if (!res.ok) {
      const plainText = text && !text.trim().startsWith('<') ? text.slice(0, 200) : '';
      throw new Error(payload.error || plainText || `请求失败（${res.status}）`);
    }
    return payload;
  }
  throw new Error('请求失败');
}

function clientRequestId(prefix = 'request') {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function MetricCard({ label, value, tone = '' }) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function inventorySummaryGroups(rows, keyOf) {
  const groups = new Map();
  rows.forEach((row) => {
    const name = normalize(keyOf(row)) || '未匹配';
    const target = groups.get(name) || {
      id: name,
      name,
      materialCount: 0,
      productionQty: 0,
      transitQty: 0,
      domesticInventoryQty: 0,
      crossBorderInventoryQty: 0,
      inventoryQty: 0
    };
    target.materialCount += 1;
    target.productionQty += numberValue(row.productionQty);
    target.transitQty += numberValue(row.transitQty);
    target.domesticInventoryQty += numberValue(row.domesticInventoryQty);
    target.crossBorderInventoryQty += numberValue(row.crossBorderInventoryQty);
    target.inventoryQty += numberValue(row.inventoryQty);
    groups.set(name, target);
  });
  return [...groups.values()].sort((left, right) => (
    right.inventoryQty - left.inventoryQty
    || right.transitQty - left.transitQty
    || left.name.localeCompare(right.name, 'zh-Hans-CN')
  ));
}

function InventoryLineChart({ title, rows }) {
  const [metric, setMetric] = useState('qty');
  const chartRows = rows.slice(0, 8);
  const maxValue = Math.max(...chartRows.flatMap((row) => [row.inventoryQty, row.transitQty, row.productionQty]), 1);
  const width = 720;
  const height = 205;
  const left = 42;
  const right = 18;
  const top = 18;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const point = (row, index, key) => ({
    x: chartRows.length === 1 ? left + plotWidth / 2 : left + index * plotWidth / Math.max(chartRows.length - 1, 1),
    y: top + plotHeight - numberValue(row[key]) / maxValue * plotHeight
  });
  const points = (key) => chartRows.map((row, index) => {
    const value = point(row, index, key);
    return `${value.x},${value.y}`;
  }).join(' ');
  return (
    <article className="inventory-chart-panel inventory-line-panel">
      <div className="inventory-chart-head">
        <h3>{title}</h3>
        <div className="inventory-chart-controls">
          <span className="inventory-chart-legend"><i className="stock" />在库量 <i className="transit" />在途量 <i className="production" />在制量</span>
          <InventoryMetricToggle metric={metric} onChange={setMetric} label={title} />
        </div>
      </div>
      {metric === 'value' ? <InventoryChartPending>货值数据待接入</InventoryChartPending> : chartRows.length === 0 ? <p className="empty-chart">暂无数据</p> : (
        <div className="inventory-line-chart">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}折线图`}>
            {[0, 0.5, 1].map((ratio) => (
              <line key={ratio} className="grid-line" x1={left} x2={width - right} y1={top + plotHeight * ratio} y2={top + plotHeight * ratio} />
            ))}
            <polyline className="stock-line" points={points('inventoryQty')} />
            <polyline className="transit-line" points={points('transitQty')} />
            <polyline className="production-line" points={points('productionQty')} />
            {chartRows.map((row, index) => {
              const stock = point(row, index, 'inventoryQty');
              const transit = point(row, index, 'transitQty');
              const production = point(row, index, 'productionQty');
              return (
                <g key={row.id}>
                  <circle className="stock-point" cx={stock.x} cy={stock.y} r="4"><title>{`${row.name} 在库量：${formatQuantity(row.inventoryQty)} 件`}</title></circle>
                  <circle className="transit-point" cx={transit.x} cy={transit.y} r="4"><title>{`${row.name} 在途量：${formatQuantity(row.transitQty)} 件`}</title></circle>
                  <circle className="production-point" cx={production.x} cy={production.y} r="4"><title>{`${row.name} 在制量：${formatQuantity(row.productionQty)} 件`}</title></circle>
                  <text className="axis-label" x={stock.x} y={height - 12} textAnchor="middle">{row.name.length > 7 ? `${row.name.slice(0, 7)}…` : row.name}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </article>
  );
}

function InventoryColumnChart({ title, rows }) {
  const [metric, setMetric] = useState('qty');
  const chartRows = rows.slice(0, 8);
  const maxValue = Math.max(...chartRows.flatMap((row) => [row.inventoryQty, row.transitQty, row.productionQty]), 1);
  return (
    <article className="inventory-chart-panel inventory-column-panel">
      <div className="inventory-chart-head">
        <h3>{title}</h3>
        <div className="inventory-chart-controls">
          <span className="inventory-chart-legend"><i className="stock" />在库量 <i className="transit" />在途量 <i className="production" />在制量</span>
          <InventoryMetricToggle metric={metric} onChange={setMetric} label={title} />
        </div>
      </div>
      {metric === 'value' ? <InventoryChartPending>货值数据待接入</InventoryChartPending> : <div className="inventory-column-chart">
        {chartRows.length === 0 ? <p className="empty-chart">暂无数据</p> : chartRows.map((row) => (
          <div key={row.id} className="inventory-column-group">
            <div className="inventory-column-bars">
              <i className="stock" style={{ height: `${Math.max(row.inventoryQty / maxValue * 100, row.inventoryQty ? 3 : 0)}%` }} title={`在库量：${formatQuantity(row.inventoryQty)} 件`} />
              <i className="transit" style={{ height: `${Math.max(row.transitQty / maxValue * 100, row.transitQty ? 3 : 0)}%` }} title={`在途量：${formatQuantity(row.transitQty)} 件`} />
              <i className="production" style={{ height: `${Math.max(row.productionQty / maxValue * 100, row.productionQty ? 3 : 0)}%` }} title={`在制量：${formatQuantity(row.productionQty)} 件`} />
            </div>
            <span title={row.name}>{row.name}</span>
          </div>
        ))}
      </div>}
    </article>
  );
}

function InventoryAbcChart({ rows }) {
  const [metric, setMetric] = useState('qty');
  const sortedRows = [...rows].sort((left, right) => numberValue(right.inventoryQty) - numberValue(left.inventoryQty));
  const aEnd = Math.ceil(sortedRows.length * 0.2);
  const bEnd = Math.ceil(sortedRows.length * 0.5);
  const buckets = [
    { name: 'A类（前20%）', value: sortedRows.slice(0, aEnd).reduce((sum, row) => sum + numberValue(row.inventoryQty), 0) },
    { name: 'B类（中间30%）', value: sortedRows.slice(aEnd, bEnd).reduce((sum, row) => sum + numberValue(row.inventoryQty), 0) },
    { name: 'C类（后50%）', value: sortedRows.slice(bEnd).reduce((sum, row) => sum + numberValue(row.inventoryQty), 0) }
  ];
  const total = buckets.reduce((sum, row) => sum + row.value, 0);
  const maxValue = Math.max(...buckets.map((row) => row.value), 1);
  return (
    <article className="inventory-chart-panel">
      <div className="inventory-chart-head">
        <h3>库存ABC分布</h3>
        <div className="inventory-chart-controls">
          <span className="inventory-chart-subtitle">按物料在库量排序</span>
          <InventoryMetricToggle metric={metric} onChange={setMetric} label="库存ABC分布" />
        </div>
      </div>
      {metric === 'value' ? <InventoryChartPending>货值数据待接入</InventoryChartPending> : <div className="inventory-abc-bars">
        {buckets.map((row, index) => (
          <div key={row.name} className={`inventory-abc-item abc-${index + 1}`}>
            <div className="inventory-abc-value">{formatQuantity(row.value)}</div>
            <div className="inventory-abc-track"><i style={{ height: `${Math.max(row.value / maxValue * 100, row.value ? 8 : 0)}%` }} /></div>
            <strong>{row.name}</strong>
            <span>{total ? `${(row.value / total * 100).toFixed(1)}%` : '0.0%'}</span>
          </div>
        ))}
      </div>}
    </article>
  );
}

function InventoryStructureChart({ domestic, crossBorder }) {
  const [metric, setMetric] = useState('qty');
  const total = domestic + crossBorder;
  const domesticPct = total ? domestic / total * 100 : 0;
  const crossBorderPct = total ? 100 - domesticPct : 0;
  return (
    <article className="inventory-chart-panel">
      <div className="inventory-chart-head">
        <h3>在库结构分布</h3>
        <div className="inventory-chart-controls">
          <span className="inventory-chart-subtitle">国内与跨境</span>
          <InventoryMetricToggle metric={metric} onChange={setMetric} label="在库结构分布" />
        </div>
      </div>
      {metric === 'value' ? <InventoryChartPending>货值数据待接入</InventoryChartPending> : <div className="inventory-donut-layout">
        <div
          className="inventory-donut"
          style={{ background: total ? `conic-gradient(#0f8f88 0 ${domesticPct}%, #1683e8 ${domesticPct}% 100%)` : '#e2e8f0' }}
          aria-label={`国内在库占比 ${domesticPct.toFixed(1)}%，跨境在库占比 ${crossBorderPct.toFixed(1)}%`}
        >
          <div><span>合计</span><strong>{formatQuantity(total)}</strong></div>
        </div>
        <div className="inventory-donut-legend">
          <div><span><i className="domestic" />国内在库</span><strong>{formatQuantity(domestic)} 件</strong><small>{total ? `${domesticPct.toFixed(1)}%` : '0.0%'}</small></div>
          <div><span><i className="cross-border" />跨境在库</span><strong>{formatQuantity(crossBorder)} 件</strong><small>{crossBorderPct.toFixed(1)}%</small></div>
        </div>
      </div>}
    </article>
  );
}

function InventoryMetricToggle({ metric, onChange, label, valueLabel = '货值' }) {
  return (
    <div className="inventory-metric-toggle" role="group" aria-label={`${label}指标切换`}>
      <button type="button" className={metric === 'qty' ? 'active' : ''} onClick={() => onChange('qty')}>数量</button>
      <button type="button" className={metric === 'value' ? 'active' : ''} onClick={() => onChange('value')}>{valueLabel}</button>
    </div>
  );
}

function InventoryChartPending({ children = '数据待接入' }) {
  return <div className="inventory-chart-pending"><strong>{children}</strong><span>字段接入后自动按当前筛选统计</span></div>;
}

function InventoryRankChart({ title, rows, note = '前10名' }) {
  const [metric, setMetric] = useState('qty');
  const chartRows = rows.slice(0, 10);
  const maxValue = Math.max(...chartRows.map((row) => row.remainingQty), 1);
  return (
    <article className="inventory-chart-panel inventory-purchase-chart">
      <div className="inventory-chart-head">
        <h3>{title}</h3>
        <div className="inventory-chart-controls">
          <span className="inventory-chart-subtitle">{note}</span>
          <InventoryMetricToggle metric={metric} onChange={setMetric} label={title} />
        </div>
      </div>
      {metric === 'value' ? <InventoryChartPending>货值数据待接入</InventoryChartPending> : <div className="inventory-rank-list">
        {chartRows.length === 0 ? <p className="empty-chart">暂无数据</p> : chartRows.map((row) => (
          <div key={row.id} className="inventory-rank-row">
            <span title={row.name}>{row.name}</span>
            <div className="inventory-rank-track">
              <i style={{ width: `${Math.max(row.remainingQty / maxValue * 100, row.remainingQty ? 3 : 0)}%` }} />
            </div>
            <strong>{formatQuantity(row.remainingQty)}</strong>
          </div>
        ))}
      </div>}
    </article>
  );
}

function InventoryMonthChart({ rows }) {
  const [metric, setMetric] = useState('qty');
  const chartRows = [...rows].sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN')).slice(-12);
  const maxValue = Math.max(...chartRows.map((row) => row.remainingQty), 1);
  return (
    <article className="inventory-chart-panel inventory-purchase-chart">
      <div className="inventory-chart-head">
        <h3>下单月份未交付趋势</h3>
        <div className="inventory-chart-controls">
          <span className="inventory-chart-subtitle">{metric === 'qty' ? '未交付数量' : '未交付货值'}</span>
          <InventoryMetricToggle metric={metric} onChange={setMetric} label="下单月份未交付趋势" />
        </div>
      </div>
      {metric === 'value' ? <InventoryChartPending>货值数据待接入</InventoryChartPending> : <div className="inventory-month-chart">
        {chartRows.length === 0 ? <p className="empty-chart">暂无数据</p> : chartRows.map((row) => (
          <div key={row.id} className="inventory-month-column">
            <strong>{formatQuantity(row.remainingQty)}</strong>
            <div><i style={{ height: `${Math.max(row.remainingQty / maxValue * 100, row.remainingQty ? 6 : 0)}%` }} /></div>
            <span title={row.name}>{row.name}</span>
          </div>
        ))}
      </div>}
    </article>
  );
}

function InventoryStageChart({ totals }) {
  const [metric, setMetric] = useState('qty');
  const stages = [
    { name: '已下单未备料', value: totals.unpreparedQty, tone: 'unprepared' },
    { name: '已备料未生产', value: totals.preparedNotStartedQty, tone: 'prepared' },
    { name: '生产中', value: totals.inProductionQty, tone: 'production' },
    { name: '完工未发', value: totals.finishedQty, tone: 'finished' }
  ];
  const maxValue = Math.max(...stages.map((row) => row.value), 1);
  return (
    <article className="inventory-chart-panel inventory-purchase-chart">
      <div className="inventory-chart-head">
        <h3>生产进度构成</h3>
        <InventoryMetricToggle metric={metric} onChange={setMetric} label="生产进度构成" />
      </div>
      {metric === 'value' ? <InventoryChartPending>货值数据待接入</InventoryChartPending> : <div className="inventory-stage-list">
        {stages.map((row) => (
          <div key={row.name} className="inventory-stage-row">
            <span>{row.name}</span>
            <div><i className={row.tone} style={{ width: `${Math.max(row.value / maxValue * 100, row.value ? 3 : 0)}%` }} /></div>
            <strong>{formatQuantity(row.value)}</strong>
          </div>
        ))}
      </div>}
    </article>
  );
}

function InventoryPieChart({ title, rows, pendingText = '数据字段待接入', wide = false }) {
  const [metric, setMetric] = useState('qty');
  const palette = ['#0f8f88', '#1683e8', '#d98619', '#7c3aed', '#6b8e23', '#94a3b8'];
  const sourceRows = rows.filter((row) => numberValue(row.remainingQty) > 0);
  const total = sourceRows.reduce((sum, row) => sum + numberValue(row.remainingQty), 0);
  const visibleRows = sourceRows.slice(0, 5);
  if (sourceRows.length > 5) {
    visibleRows.push({
      id: 'other',
      name: `其他${sourceRows.length - 5}项`,
      remainingQty: sourceRows.slice(5).reduce((sum, row) => sum + numberValue(row.remainingQty), 0)
    });
  }
  let offset = 0;
  const gradient = total ? visibleRows.map((row, index) => {
    const start = offset;
    offset += numberValue(row.remainingQty) / total * 100;
    return `${palette[index % palette.length]} ${start}% ${offset}%`;
  }).join(', ') : '#e2e8f0 0 100%';
  return (
    <article className={`inventory-chart-panel inventory-purchase-chart inventory-pie-panel${wide ? ' inventory-purchase-wide-chart' : ''}`}>
      <div className="inventory-chart-head">
        <h3>{title}</h3>
        <div className="inventory-chart-controls">
          <span className="inventory-chart-subtitle">{sourceRows.length ? `共${sourceRows.length}项` : '待接入'}</span>
          <InventoryMetricToggle metric={metric} onChange={setMetric} label={title} />
        </div>
      </div>
      {metric === 'value' ? <InventoryChartPending>货值数据待接入</InventoryChartPending> : !total ? (
        <InventoryChartPending>{pendingText}</InventoryChartPending>
      ) : (
        <div className="inventory-pie-layout">
          <div className="inventory-pie" style={{ background: `conic-gradient(${gradient})` }}>
            <div><span>数量</span><strong>{formatQuantity(total)}</strong></div>
          </div>
          <div className="inventory-pie-legend">
            {visibleRows.map((row, index) => (
              <div key={row.id || row.name}>
                <span><i style={{ background: palette[index % palette.length] }} />{row.name}</span>
                <strong>{formatQuantity(row.remainingQty)}</strong>
                <small>{total ? `${(numberValue(row.remainingQty) / total * 100).toFixed(1)}%` : '0.0%'}</small>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function InventoryPurchaseMetric({ label, quantity, value, note, share, tone, fullQuantity = null }) {
  const hasFullQuantity = fullQuantity !== null && fullQuantity !== undefined;
  const excludedQuantity = hasFullQuantity
    ? Math.max(numberValue(fullQuantity) - numberValue(quantity), 0)
    : 0;
  return (
    <article className={`inventory-kpi inventory-purchase-kpi ${tone}`}>
      <span>{label}</span>
      <div className="inventory-purchase-kpi-row"><small>筛选</small><strong>{formatDashboardNumber(quantity)}</strong></div>
      <div className="inventory-purchase-kpi-row value"><small>货值</small><strong>{value === null ? '待接入' : value}</strong></div>
      {hasFullQuantity && (
        <div className="inventory-purchase-kpi-scope">
          <span>文件全量 {formatDashboardNumber(fullQuantity)} 件</span>
          <small>筛选排除 {formatDashboardNumber(excludedQuantity)} 件</small>
        </div>
      )}
      <small>{share === null ? note : `${note} · 占比 ${formatDashboardPercent(share)}`}</small>
    </article>
  );
}

function LegacyInventorySummary({ token, active }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ businessUnits: [], productLines: [], productSeries: [], skus: [], keyword: '' });
  const [searchInput, setSearchInput] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [tableView, setTableView] = useState('materials');
  const [exporting, setExporting] = useState(false);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    request('/api/inventory-summary', { token })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || '库存汇总加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, token]);

  const rows = data?.rows || [];
  const unique = (values) => [...new Set(values.map(normalize).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  const options = useMemo(() => ({
    businessUnits: unique(rows.map((row) => row.businessUnit)),
    productLines: unique(rows.map((row) => row.productLine)),
    productSeries: unique(rows.map((row) => row.productSeries)),
    skus: unique(rows.map((row) => row.sku))
  }), [rows]);
  const filteredRows = useMemo(() => {
    const keyword = normalize(filters.keyword).toLowerCase();
    const selected = (values, value) => values.length === 0 || values.includes(normalize(value));
    return rows.filter((row) => (
      selected(filters.businessUnits, row.businessUnit)
      && selected(filters.productLines, row.productLine)
      && selected(filters.productSeries, row.productSeries)
      && selected(filters.skus, row.sku)
      && (!keyword || [row.materialCode, row.sku, row.materialName].join(' ').toLowerCase().includes(keyword))
    ));
  }, [rows, filters]);
  const totals = useMemo(() => filteredRows.reduce((summary, row) => ({
    productionQty: summary.productionQty + numberValue(row.productionQty),
    transitQty: summary.transitQty + numberValue(row.transitQty),
    domesticInventoryQty: summary.domesticInventoryQty + numberValue(row.domesticInventoryQty),
    crossBorderInventoryQty: summary.crossBorderInventoryQty + numberValue(row.crossBorderInventoryQty),
    inventoryQty: summary.inventoryQty + numberValue(row.inventoryQty)
  }), { productionQty: 0, transitQty: 0, domesticInventoryQty: 0, crossBorderInventoryQty: 0, inventoryQty: 0 }), [filteredRows]);
  const businessUnitRows = useMemo(() => inventorySummaryGroups(filteredRows, (row) => row.businessUnit), [filteredRows]);
  const productLineRows = useMemo(() => inventorySummaryGroups(filteredRows, (row) => row.productLine), [filteredRows]);
  const materialCount = useMemo(() => new Set(filteredRows.map((row) => normalize(row.materialCode) || normalize(row.sku) || row.id)).size, [filteredRows]);
  const tableRows = tableView === 'businessUnits' ? businessUnitRows : tableView === 'productLines' ? productLineRows : filteredRows;
  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const pageRows = tableRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => ({ ...current, keyword: searchInput }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => { setCurrentPage(1); }, [filters, tableView, pageSize]);
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const clearFilters = () => {
    setSearchInput('');
    setFilters({ businessUnits: [], productLines: [], productSeries: [], skus: [], keyword: '' });
  };
  const tableConfig = tableView === 'materials'
    ? {
        columns: ['事业部', '产品线', '系列', 'SKU', '物料名称', '在制量', '在途量', '在库量'],
        render: (row) => [
          row.businessUnit,
          row.productLine || '未匹配',
          row.productSeries || '未匹配',
          row.sku || '未匹配',
          row.materialName || '未匹配',
          formatQuantity(row.productionQty),
          formatQuantity(row.transitQty),
          formatQuantity(row.inventoryQty)
        ]
      }
    : {
        columns: [tableView === 'businessUnits' ? '事业部' : '产品线', '物料数', '在制量', '在途量', '国内在库', '跨境在库', '在库合计'],
        render: (row) => [
          row.name,
          formatQuantity(row.materialCount),
          formatQuantity(row.productionQty),
          formatQuantity(row.transitQty),
          formatQuantity(row.domesticInventoryQty),
          formatQuantity(row.crossBorderInventoryQty),
          formatQuantity(row.inventoryQty)
        ]
      };

  async function exportCurrentView() {
    if (!tableRows.length) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const aoa = [
        tableConfig.columns,
        ...tableRows.map((row) => tableConfig.render(row).map((value) => typeof value === 'string' ? value : String(value ?? '')))
      ];
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(workbook, worksheet, '库存汇总');
      await writeStyledExcelFile(XLSX, workbook, `库存汇总_${todayText()}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="inventory-dashboard">
      <div className="inventory-dashboard-heading">
        <div>
          <h2>库存数据看板</h2>
          <p>采购、头程、国内与跨境库存全量汇总</p>
        </div>
        <span>数据更新：{data?.updatedAt || '暂无'}</span>
      </div>
      {loading ? (
        <div className="inventory-summary-status" role="status">加载中</div>
      ) : error ? (
        <div className="inventory-summary-status error" role="alert">库存汇总加载失败：{error}</div>
      ) : (
        <>
          <div className="toolbar filters-row inventory-summary-filters">
            <MultiSelectFilter label="事业部" allLabel="全部事业部" value={filters.businessUnits} options={options.businessUnits} onChange={(value) => updateFilter('businessUnits', value)} />
            <MultiSelectFilter label="产品线" allLabel="全部产品线" value={filters.productLines} options={options.productLines} onChange={(value) => updateFilter('productLines', value)} />
            <MultiSelectFilter label="系列" allLabel="全部系列" value={filters.productSeries} options={options.productSeries} onChange={(value) => updateFilter('productSeries', value)} />
            <MultiSelectFilter label="SKU" allLabel="全部SKU" value={filters.skus} options={options.skus} onChange={(value) => updateFilter('skus', value)} />
            <input
              className="search-input"
              placeholder="搜索物料编码、SKU、物料名称"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <button type="button" className="ghost compact-button" onClick={clearFilters}>清空筛选</button>
          </div>
          <section className="inventory-kpi-grid" aria-label="库存汇总指标">
            <InventoryPurchaseMetric label="在库合计" quantity={totals.inventoryQty} value={null} note={`${materialCount} 个库存物料`} share={totals.inventoryQty ? 100 : 0} tone="total" />
            <InventoryPurchaseMetric label="在制量" quantity={totals.productionQty} value={null} note="占总数量" share={(totals.inventoryQty + totals.transitQty + totals.productionQty) ? totals.productionQty / (totals.inventoryQty + totals.transitQty + totals.productionQty) * 100 : 0} tone="production" />
            <InventoryPurchaseMetric label="在途量" quantity={totals.transitQty} value={null} note="占总数量" share={(totals.inventoryQty + totals.transitQty + totals.productionQty) ? totals.transitQty / (totals.inventoryQty + totals.transitQty + totals.productionQty) * 100 : 0} tone="transit" />
            <InventoryPurchaseMetric label="国内在库" quantity={totals.domesticInventoryQty} value={null} note="占在库合计" share={totals.inventoryQty ? totals.domesticInventoryQty / totals.inventoryQty * 100 : 0} tone="domestic" />
            <InventoryPurchaseMetric label="跨境在库" quantity={totals.crossBorderInventoryQty} value={null} note="占在库合计" share={totals.inventoryQty ? totals.crossBorderInventoryQty / totals.inventoryQty * 100 : 0} tone="cross-border" />
            <InventoryPurchaseMetric label="在库＋在途＋在制" quantity={totals.inventoryQty + totals.transitQty + totals.productionQty} value={null} note={`当前筛选 ${filteredRows.length} 条`} share={(totals.inventoryQty + totals.transitQty + totals.productionQty) ? 100 : 0} tone="materials" />
          </section>

          <section className="inventory-chart-grid">
            <InventoryLineChart title="事业部库存、在途与在制" rows={businessUnitRows} />
            <InventoryColumnChart title="产品线库存、在途与在制" rows={productLineRows} />
            <InventoryAbcChart rows={filteredRows} />
            <InventoryStructureChart domestic={totals.domesticInventoryQty} crossBorder={totals.crossBorderInventoryQty} />
          </section>

          <div className="inventory-table-tabs">
            <div role="tablist" aria-label="库存汇总表格视图">
              <button type="button" role="tab" aria-selected={tableView === 'materials'} className={tableView === 'materials' ? 'active' : ''} onClick={() => setTableView('materials')}>物料汇总</button>
              <button type="button" role="tab" aria-selected={tableView === 'businessUnits'} className={tableView === 'businessUnits' ? 'active' : ''} onClick={() => setTableView('businessUnits')}>事业部汇总</button>
              <button type="button" role="tab" aria-selected={tableView === 'productLines'} className={tableView === 'productLines' ? 'active' : ''} onClick={() => setTableView('productLines')}>产品线汇总</button>
            </div>
            <div className="inventory-table-actions">
              <span>当前筛选 {filteredRows.length} / {rows.length} 条</span>
              <button type="button" className="ghost compact-button" disabled={exporting || !tableRows.length} onClick={exportCurrentView}>{exporting ? '导出中...' : '导出Excel'}</button>
              <label className="inventory-page-size">每页
                <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                  <option value="10">10 条</option>
                  <option value="25">25 条</option>
                  <option value="50">50 条</option>
                </select>
              </label>
            </div>
          </div>
          <DataTable
            className="inventory-summary-table"
            rows={pageRows}
            columns={tableConfig.columns}
            render={tableConfig.render}
          />
          {tableRows.length > pageSize && (
            <TablePagination label="库存汇总分页" currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} pageSize={pageSize} />
          )}
        </>
      )}
    </section>
  );
}

function inventoryDashboardTotals(rows) {
  const fields = [
    'salesQty', 'salesAmount',
    'fbaInventoryQty', 'fbaInventoryValue', 'fbmInventoryQty', 'fbmInventoryValue',
    'wfsInventoryQty', 'wfsInventoryValue', 'crossBorderInventoryQty', 'crossBorderInventoryValue',
    'domesticMainInventoryQty', 'domesticMainInventoryValue', 'jdInventoryQty', 'jdInventoryValue',
    'domesticInventoryQty', 'domesticInventoryValue', 'inventoryQty', 'inventoryValue',
    'fbaTransitQty', 'fbaTransitValue', 'fbmTransitQty', 'fbmTransitValue',
    'wfsTransitQty', 'wfsTransitValue',
    'jdTransitQty', 'jdTransitValue',
    'transitQty', 'transitValue', 'finishedNotShippedQty', 'finishedNotShippedValue',
    'unpreparedQty', 'unpreparedValue', 'preparedNotStartedQty', 'preparedNotStartedValue',
    'inProductionQty', 'inProductionValue', 'unfulfilledQty', 'unfulfilledValue',
    'normalOrderQty', 'normalOrderValue', 'abnormalOrderQty', 'abnormalOrderValue',
    'scaleQty', 'scaleValue'
  ];
  return rows.reduce((summary, row) => {
    fields.forEach((field) => {
      summary[field] += numberValue(row[field]);
    });
    return summary;
  }, Object.fromEntries(fields.map((field) => [field, 0])));
}

const INVENTORY_DEFAULT_BUSINESS_UNITS = [
  '全球招商事业部',
  '国内事业部',
  '海外事业一部',
  '海外事业二部'
];
const INVENTORY_SUBJECT_MEASURE_FIELDS = [
  'fbaInventoryQty', 'fbaInventoryValue',
  'fbmInventoryQty', 'fbmInventoryValue',
  'wfsInventoryQty', 'wfsInventoryValue',
  'domesticMainInventoryQty', 'domesticMainInventoryValue',
  'jdInventoryQty', 'jdInventoryValue',
  'fbaTransitQty', 'fbaTransitValue',
  'fbmTransitQty', 'fbmTransitValue',
  'wfsTransitQty', 'wfsTransitValue',
  'jdTransitQty', 'jdTransitValue'
];
const INVENTORY_PRODUCT_TYPE_OPTIONS = ['成品', '配件', '不可售'];
const INVENTORY_NON_STOCK_FIELDS = [
  'salesQty', 'salesAmount',
  'finishedNotShippedQty', 'finishedNotShippedValue',
  'unpreparedQty', 'unpreparedValue',
  'preparedNotStartedQty', 'preparedNotStartedValue',
  'inProductionQty', 'inProductionValue',
  'unfulfilledQty', 'unfulfilledValue',
  'normalOrderQty', 'normalOrderValue',
  'abnormalOrderQty', 'abnormalOrderValue'
];

function inventoryDefaultFilters() {
  return {
    businessUnits: [...INVENTORY_DEFAULT_BUSINESS_UNITS],
    inventorySubjects: [],
    productTypes: ['成品'],
    productLines: [],
    productSeries: [],
    skus: [],
    sites: [],
    level1WarehouseCategories: [],
    level2WarehouseCategories: [],
    inventorySources: [],
    keyword: ''
  };
}

function inventoryProductType(row) {
  return normalize(row.baseProductType) || (normalize(row.productLine) === '其他/配件' ? '配件' : '成品');
}

function GlobalLoadingProgress({ state }) {
  if (!state.visible) return null;
  const value = Math.min(100, Math.max(0, Math.round(state.progress || 0)));
  return (
    <div className="global-loading-progress" role="status" aria-live="polite">
      <div className="global-loading-progress-label">
        <span>{value >= 100 ? '数据加载完成' : '正在加载数据'}</span>
        <strong>{value}%</strong>
      </div>
      <div className="global-loading-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={value}>
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function inventoryRowProductTypes(row) {
  const types = new Set([inventoryProductType(row)]);
  (row.inventorySegmentBreakdown || []).forEach((item) => {
    const quantity = INVENTORY_SUBJECT_MEASURE_FIELDS.reduce((sum, field) => (
      field.endsWith('Qty') ? sum + Math.abs(numberValue(item[field])) : sum
    ), 0);
    if (quantity > 0) types.add(normalize(item.productType));
  });
  return [...types].filter(Boolean);
}

function inventorySegmentMatches(item, selectedSubjects, selectedProductTypes) {
  return (selectedSubjects.length === 0 || selectedSubjects.includes(normalize(item.subject)))
    && (selectedProductTypes.length === 0 || selectedProductTypes.includes(normalize(item.productType)));
}

function inventorySourceDetailMatches(item, selectedSubjects, selectedProductTypes, selectedSites, selectedLevel1Categories, selectedLevel2Categories) {
  return inventorySegmentMatches(item, selectedSubjects, selectedProductTypes)
    && (selectedSites.length === 0 || selectedSites.includes(normalize(item.site)))
    && (selectedLevel1Categories.length === 0 || selectedLevel1Categories.includes(normalize(item.level1WarehouseCategory)))
    && (selectedLevel2Categories.length === 0 || selectedLevel2Categories.includes(normalize(item.level2WarehouseCategory)));
}

function inventoryRowMatchesProductTypes(row, selectedSubjects, selectedProductTypes) {
  if (selectedProductTypes.length === 0) return true;
  if (selectedProductTypes.includes(inventoryProductType(row))) return true;
  return (row.inventorySegmentBreakdown || []).some((item) => (
    inventorySegmentMatches(item, selectedSubjects, selectedProductTypes)
    && INVENTORY_SUBJECT_MEASURE_FIELDS.some((field) => field.endsWith('Qty') && Math.abs(numberValue(item[field])) > 0)
  ));
}

function inventoryRowForFilters(row, selectedSubjects, selectedProductTypes, selectedSites, selectedLevel1Categories, selectedLevel2Categories) {
  const subjectSet = new Set(selectedSubjects);
  const typeSet = new Set(selectedProductTypes);
  const siteSet = new Set(selectedSites);
  const level1CategorySet = new Set(selectedLevel1Categories);
  const level2CategorySet = new Set(selectedLevel2Categories);
  const baseProductType = inventoryProductType(row);
  const selectedBreakdown = (row.inventorySegmentBreakdown || []).filter((item) => (
    (subjectSet.size === 0 || subjectSet.has(normalize(item.subject)))
    && (typeSet.size === 0 || typeSet.has(normalize(item.productType)))
  ));
  const selectedSourceDetails = (row.inventorySourceDetails || []).filter((item) => (
    inventorySourceDetailMatches(item, selectedSubjects, selectedProductTypes, selectedSites, selectedLevel1Categories, selectedLevel2Categories)
  ));
  const warehouseScoped = siteSet.size > 0 || level1CategorySet.size > 0 || level2CategorySet.size > 0;
  const amounts = Object.fromEntries(INVENTORY_SUBJECT_MEASURE_FIELDS.map((field) => [
    field,
    (warehouseScoped ? selectedSourceDetails : selectedBreakdown).reduce((sum, item) => sum + numberValue(item[field]), 0)
  ]));
  const includeBaseMeasures = typeSet.size === 0 || typeSet.has(baseProductType);
  const nonStockAmounts = Object.fromEntries(INVENTORY_NON_STOCK_FIELDS.map((field) => [
    field,
    includeBaseMeasures ? numberValue(row[field]) : 0
  ]));
  const crossBorderInventoryQty = amounts.fbaInventoryQty + amounts.fbmInventoryQty + amounts.wfsInventoryQty;
  const crossBorderInventoryValue = amounts.fbaInventoryValue + amounts.fbmInventoryValue + amounts.wfsInventoryValue;
  const domesticInventoryQty = amounts.domesticMainInventoryQty + amounts.jdInventoryQty;
  const domesticInventoryValue = amounts.domesticMainInventoryValue + amounts.jdInventoryValue;
  const inventoryQty = crossBorderInventoryQty + domesticInventoryQty;
  const inventoryValue = crossBorderInventoryValue + domesticInventoryValue;
  const transitQty = amounts.fbaTransitQty + amounts.fbmTransitQty + amounts.wfsTransitQty + amounts.jdTransitQty;
  const transitValue = amounts.fbaTransitValue + amounts.fbmTransitValue + amounts.wfsTransitValue + amounts.jdTransitValue;
  return {
    ...row,
    ...amounts,
    ...nonStockAmounts,
    inventorySubjects: [...new Set((warehouseScoped ? selectedSourceDetails : selectedBreakdown).map((item) => item.subject))],
    inventorySourceDetails: selectedSourceDetails,
    salesByMonth: includeBaseMeasures ? row.salesByMonth : {},
    salesAmountByMonth: includeBaseMeasures ? row.salesAmountByMonth : {},
    purchaseByMonth: includeBaseMeasures ? row.purchaseByMonth : {},
    crossBorderInventoryQty,
    crossBorderInventoryValue,
    domesticInventoryQty,
    domesticInventoryValue,
    inventoryQty,
    inventoryValue,
    transitQty,
    transitValue,
    scaleQty: inventoryQty + transitQty + nonStockAmounts.unfulfilledQty,
    scaleValue: inventoryValue + transitValue + nonStockAmounts.unfulfilledValue
  };
}

function inventorySourceLocation(item) {
  const sourceWarehouse = normalize(item.sourceWarehouseName);
  const receivingWarehouse = normalize(item.receivingWarehouseName);
  const mappedWarehouse = normalize(item.mappedWarehouseName);
  const storeName = normalize(item.storeName);
  const locations = [];
  if (sourceWarehouse) locations.push(sourceWarehouse);
  else if (storeName) locations.push(`店铺：${storeName}`);
  if (receivingWarehouse && !locations.includes(receivingWarehouse)) locations.push(`收货：${receivingWarehouse}`);
  if (mappedWarehouse && !locations.includes(mappedWarehouse)) locations.push(`映射：${mappedWarehouse}`);
  return locations.join(' → ') || '无仓库字段';
}

function inventorySourceWarehouseItems(row) {
  const items = [...new Set((row.inventorySourceDetails || []).map((item) => (
    `${normalize(item.sourceTable) || '未知来源'}：${inventorySourceLocation(item)}`
  )))];
  return items.length ? items : ['无仓库数据'];
}

function inventorySourceWarehouses(row, separator = '；') {
  return inventorySourceWarehouseItems(row).join(separator);
}

function InventorySourceWarehouseCell({ row }) {
  return (
    <div className="inventory-source-warehouse-cell">
      {inventorySourceWarehouseItems(row).map((item) => <span key={item}>{item}</span>)}
    </div>
  );
}

function inventoryDashboardGroups(rows, keyOf) {
  const groups = new Map();
  rows.forEach((row) => {
    const name = normalize(keyOf(row)) || '未匹配';
    const target = groups.get(name) || {
      id: name,
      name,
      inventoryQty: 0,
      inventoryValue: 0,
      transitQty: 0,
      transitValue: 0,
      unfulfilledQty: 0,
      unfulfilledValue: 0
    };
    ['inventoryQty', 'inventoryValue', 'transitQty', 'transitValue', 'unfulfilledQty', 'unfulfilledValue'].forEach((field) => {
      target[field] += numberValue(row[field]);
    });
    groups.set(name, target);
  });
  return [...groups.values()].sort((left, right) => (
    right.inventoryQty - left.inventoryQty
    || left.name.localeCompare(right.name, 'zh-Hans-CN')
  ));
}

function formatDashboardNumber(value) {
  return numberValue(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function formatDashboardWan(value) {
  const amount = numberValue(value);
  if (Math.abs(amount) > 10000) {
    return `${(amount / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}万元`;
  }
  return `${amount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}元`;
}

function formatDashboardPercent(value) {
  return `${numberValue(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}%`;
}

function InventorySummaryMonthlyBars({ title, rows, baseLabel = '销售' }) {
  const [metric, setMetric] = useState('qty');
  const chartRows = [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const valueKey = metric === 'qty' ? 'salesQty' : 'salesAmount';
  const years = [...new Set([
    '2025',
    '2026',
    ...chartRows.map((row) => String(row.id || row.name).slice(0, 4)).filter((year) => /^\d{4}$/.test(year))
  ])].sort();
  const palette = ['#0f8f88', '#1683e8', '#d98619', '#7c5ce7', '#ef5b45'];
  const colorByYear = new Map(years.map((year, index) => [year, palette[index % palette.length]]));
  const rowByMonth = new Map(chartRows.map((row) => [String(row.id || row.name).slice(0, 7), row]));
  const monthGroups = Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, '0');
    return {
      id: month,
      name: `${index + 1}月`,
      series: years.map((year) => {
        const row = rowByMonth.get(`${year}-${month}`);
        return {
          id: `${year}-${month}`,
          year,
          name: `${year}年${index + 1}月`,
          salesQty: numberValue(row?.salesQty),
          salesAmount: numberValue(row?.salesAmount)
        };
      })
    };
  });
  const maxValue = Math.max(...monthGroups.flatMap((group) => group.series.map((row) => Math.abs(numberValue(row[valueKey])))), 1);
  const hasData = chartRows.length > 0;
  return (
    <article className="inventory-chart-panel">
      <div className="inventory-chart-head">
        <h3>{title}</h3>
        <div className="inventory-chart-controls">
          <span className="inventory-chart-legend">
            {years.map((year) => <span key={year}><i style={{ background: colorByYear.get(year) }} />{year}年</span>)}
          </span>
          <InventoryMetricToggle metric={metric} onChange={setMetric} label={title} valueLabel="金额" />
        </div>
      </div>
      {!hasData ? <p className="empty-chart">暂无数据</p> : (
        <div className="inventory-vertical-chart-scroll">
          <div className="inventory-monthly-bars" style={{ minWidth: `${Math.max(1080, monthGroups.length * Math.max(112, years.length * 42))}px` }}>
            {monthGroups.map((group) => (
              <div className="inventory-monthly-group" key={group.id} aria-label={`${group.name}销售数据`}>
                <div className="inventory-monthly-series">
                  {group.series.map((row) => {
                    const value = numberValue(row[valueKey]);
                    const display = metric === 'qty' ? formatDashboardNumber(value) : formatDashboardWan(value);
                    return (
                      <span key={row.id}>
                        <small title={`${row.name}${baseLabel}${metric === 'qty' ? '数量' : '金额'}：${display}`}>{display}</small>
                        <i
                          title={`${row.name}${baseLabel}${metric === 'qty' ? '数量' : '金额'}：${display}`}
                          style={{
                            height: `${Math.max(Math.abs(value) / maxValue * 142, value ? 4 : 0)}px`,
                            background: colorByYear.get(row.year) || palette[0]
                          }}
                        />
                        <em>{row.year}年</em>
                      </span>
                    );
                  })}
                </div>
                <strong>{group.name}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function InventorySummaryVerticalGroupedBars({ title, rows }) {
  const [metric, setMetric] = useState('qty');
  const series = [
    { key: metric === 'qty' ? 'inventoryQty' : 'inventoryValue', label: '在库', color: '#0f8f88' },
    { key: metric === 'qty' ? 'transitQty' : 'transitValue', label: '在途', color: '#1683e8' },
    { key: metric === 'qty' ? 'unfulfilledQty' : 'unfulfilledValue', label: '未交付', color: '#f59e0b' }
  ];
  const maxValue = Math.max(...rows.flatMap((row) => series.map((item) => Math.abs(numberValue(row[item.key])))), 1);
  return (
    <article className="inventory-chart-panel">
      <div className="inventory-chart-head">
        <h3>{title}</h3>
        <div className="inventory-chart-controls">
          <span className="inventory-chart-legend">
            {series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}
          </span>
          <InventoryMetricToggle metric={metric} onChange={setMetric} label={title} />
        </div>
      </div>
      {rows.length === 0 ? <p className="empty-chart">暂无数据</p> : (
        <div className="inventory-vertical-chart-scroll">
          <div className="inventory-business-bars" style={{ minWidth: `${Math.max(720, rows.length * 270)}px` }}>
            {rows.map((row) => (
              <div className="inventory-business-group" key={row.id || row.name}>
                <div className="inventory-business-series">
                  {series.map((item) => {
                    const value = numberValue(row[item.key]);
                    const display = metric === 'qty' ? formatDashboardNumber(value) : formatDashboardWan(value);
                    return (
                      <span key={item.key} data-series-label={item.label}>
                        <small title={`${row.name}${item.label}：${display}`}>{display}</small>
                        <i
                          title={`${row.name}${item.label}：${display}`}
                          style={{
                            height: `${Math.max(Math.abs(value) / maxValue * 150, value ? 4 : 0)}px`,
                            background: item.color
                          }}
                        />
                      </span>
                    );
                  })}
                </div>
                <strong title={row.name}>{row.name}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function InventorySummaryLineChart({ title, rows, monthly = false, baseLabel = '销售' }) {
  const [metric, setMetric] = useState('qty');
  const series = monthly
    ? [{ key: metric === 'qty' ? 'salesQty' : 'salesAmount', label: metric === 'qty' ? `${baseLabel}数量` : `${baseLabel}货值`, color: '#0f8f88' }]
    : [
        { key: metric === 'qty' ? 'inventoryQty' : 'inventoryValue', label: '在库', color: '#0f8f88' },
        { key: metric === 'qty' ? 'transitQty' : 'transitValue', label: '在途', color: '#1683e8' },
        { key: metric === 'qty' ? 'unfulfilledQty' : 'unfulfilledValue', label: '未交付', color: '#f59e0b' }
      ];
  const width = Math.max(760, rows.length * 92);
  const height = 250;
  const left = 48;
  const right = 24;
  const top = 24;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(...rows.flatMap((row) => series.map((item) => numberValue(row[item.key]))), 1);
  const point = (row, index, key) => ({
    x: rows.length <= 1 ? left + plotWidth / 2 : left + index * plotWidth / Math.max(rows.length - 1, 1),
    y: top + plotHeight - numberValue(row[key]) / maxValue * plotHeight
  });
  return (
    <article className="inventory-chart-panel">
      <div className="inventory-chart-head">
        <h3>{title}</h3>
        <div className="inventory-chart-controls">
          <span className="inventory-chart-legend">
            {series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}
          </span>
          <InventoryMetricToggle metric={metric} onChange={setMetric} label={title} />
        </div>
      </div>
      {rows.length === 0 ? <p className="empty-chart">暂无数据</p> : (
        <div className="inventory-scroll-chart">
          <svg style={{ width }} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
              <line key={ratio} className="grid-line" x1={left} x2={width - right} y1={top + plotHeight * ratio} y2={top + plotHeight * ratio} />
            ))}
            {series.map((item) => (
              <polyline
                key={item.key}
                points={rows.map((row, index) => {
                  const p = point(row, index, item.key);
                  return `${p.x},${p.y}`;
                }).join(' ')}
                style={{ stroke: item.color }}
              />
            ))}
            {rows.map((row, index) => (
              <g key={row.id || row.name}>
                {series.map((item) => {
                  const p = point(row, index, item.key);
                  const display = metric === 'qty' ? `${formatDashboardNumber(row[item.key])}件` : formatDashboardWan(row[item.key]);
                  return <circle key={item.key} cx={p.x} cy={p.y} r="4" style={{ fill: item.color }}><title>{`${row.name} ${item.label}：${display}`}</title></circle>;
                })}
                <text className="axis-label" x={point(row, index, series[0].key).x} y={height - 14} textAnchor="middle">{row.name.length > 10 ? `${row.name.slice(0, 10)}…` : row.name}</text>
              </g>
            ))}
          </svg>
        </div>
      )}
    </article>
  );
}

function InventorySummaryGroupedBars({ title, rows }) {
  const [metric, setMetric] = useState('qty');
  const series = [
    { key: metric === 'qty' ? 'inventoryQty' : 'inventoryValue', label: '在库', color: '#0f8f88' },
    { key: metric === 'qty' ? 'transitQty' : 'transitValue', label: '在途', color: '#1683e8' },
    { key: metric === 'qty' ? 'unfulfilledQty' : 'unfulfilledValue', label: '未交付', color: '#f59e0b' }
  ];
  const maxValue = Math.max(...rows.flatMap((row) => series.map((item) => Math.abs(numberValue(row[item.key])))), 1);
  return (
    <article className="inventory-chart-panel">
      <div className="inventory-chart-head">
        <h3>{title}</h3>
        <div className="inventory-chart-controls">
          <span className="inventory-chart-legend">
            {series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}
          </span>
          <InventoryMetricToggle metric={metric} onChange={setMetric} label={title} />
        </div>
      </div>
      {rows.length === 0 ? <p className="empty-chart">暂无数据</p> : (
        <div className="inventory-horizontal-bars">
          {rows.map((row) => (
            <div className="inventory-horizontal-group" key={row.id}>
              <strong title={row.name}>{row.name}</strong>
              <div>
                {series.map((item) => {
                  const value = numberValue(row[item.key]);
                  const display = metric === 'qty' ? `${formatDashboardNumber(value)}件` : formatDashboardWan(value);
                  return (
                    <span key={item.key}>
                      <i style={{ width: `${Math.max(Math.abs(value) / maxValue * 100, value ? 1.5 : 0)}%`, background: item.color }} />
                      <small>{display}</small>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function InventorySummaryAbc({ rows }) {
  const [metric, setMetric] = useState('qty');
  const classField = metric === 'qty' ? 'quantityAbc' : 'amountAbc';
  const valueField = metric === 'qty' ? 'salesQty' : 'salesAmount';
  const buckets = ['A', 'B', 'C'].map((name) => ({
    name,
    value: rows.filter((row) => row[classField] === name).reduce((sum, row) => sum + numberValue(row[valueField]), 0)
  }));
  const total = buckets.reduce((sum, row) => sum + row.value, 0);
  const maxValue = Math.max(...buckets.map((row) => Math.abs(row.value)), 1);
  return (
    <article className="inventory-chart-panel">
      <div className="inventory-chart-head">
        <h3>销售ABC分布</h3>
        <InventoryMetricToggle metric={metric} onChange={setMetric} label="销售ABC分布" />
      </div>
      <div className="inventory-abc-bars">
        {buckets.map((row, index) => (
          <div key={row.name} className={`inventory-abc-item abc-${index + 1}`}>
            <div className="inventory-abc-value">{metric === 'qty' ? formatDashboardNumber(row.value) : formatDashboardWan(row.value)}</div>
            <div className="inventory-abc-track"><i style={{ height: `${Math.max(Math.abs(row.value) / maxValue * 100, row.value ? 8 : 0)}%` }} /></div>
            <strong>{row.name}类</strong>
            <span>{formatDashboardPercent(total ? row.value / total * 100 : 0)}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function InventoryQuantityReconciliation({ data }) {
  const [expanded, setExpanded] = useState(false);
  const summary = data?.summary || {};
  const sources = data?.sources || [];
  const groups = data?.groups || [];
  const warning = data?.status === 'warning';

  useEffect(() => {
    if (warning) setExpanded(true);
  }, [warning]);

  if (!data) return null;
  return (
    <section className={`inventory-quantity-reconciliation ${warning ? 'warning' : 'ok'}`} aria-label="库存数量校准">
      <div className="inventory-reconciliation-head">
        <div>
          <strong>库存数量校准</strong>
          <span>
            {warning
              ? `发现数量异常来源 ${summary.issueSourceCount || 0} 个，请核对遗漏或重叠数量`
              : `已核对 ${summary.sourceCount || 0} 个数量来源，全部完整进入销售与库存看板`}
          </span>
        </div>
        <div className="inventory-reconciliation-metrics">
          <span>核对数量 <strong>{formatDashboardNumber(summary.checkedQuantity)}</strong></span>
          <span className={summary.missingQuantity ? 'has-issue' : ''}>遗漏 <strong>{formatDashboardNumber(summary.missingQuantity)}</strong></span>
          <span className={summary.overlapQuantity ? 'has-issue' : ''}>重叠 <strong>{formatDashboardNumber(summary.overlapQuantity)}</strong></span>
          <button type="button" className="ghost compact-button" onClick={() => setExpanded((current) => !current)}>
            {expanded ? '收起校准明细' : '查看校准明细'}
          </button>
        </div>
      </div>
      {groups.length > 0 && (
        <div className="inventory-reconciliation-groups">
          {groups.map((row) => (
            <span key={row.group} className={row.status === '校准通过' ? 'ok' : 'warning'}>
              {row.group}：来源 {formatDashboardNumber(row.expectedQuantity)} / 看板 {formatDashboardNumber(row.dashboardQuantity)}
            </span>
          ))}
        </div>
      )}
      {expanded && (
        <div className="inventory-reconciliation-table-wrap">
          <table className="inventory-reconciliation-table">
            <thead>
              <tr><th>数量来源</th><th>分组</th><th>来源计算量</th><th>看板展示量</th><th>遗漏数量</th><th>重叠数量</th><th>状态</th></tr>
            </thead>
            <tbody>
              {sources.map((row) => (
                <tr key={row.slotId} className={row.status === '校准通过' ? '' : 'has-issue'}>
                  <td>{row.label}</td>
                  <td>{row.group}</td>
                  <td>{formatDashboardNumber(row.expectedQuantity)}</td>
                  <td>{formatDashboardNumber(row.dashboardQuantity)}</td>
                  <td>{formatDashboardNumber(row.missingQuantity)}</td>
                  <td>{formatDashboardNumber(row.overlapQuantity)}</td>
                  <td><span className={`inventory-reconciliation-status ${row.status === '校准通过' ? 'ok' : 'warning'}`}>{row.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>仅校验数量；库存为 0 的记录按现有规则剔除，不计入遗漏提醒。</p>
        </div>
      )}
    </section>
  );
}

function InventoryManualReconciliation({ token, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reconciliation = data?.manualReconciliation;
  const [category, setCategory] = useState('成品');
  const [filters, setFilters] = useState({ businessUnits: [], productLines: [], productSeries: [], sources: [], statuses: [], keyword: '' });
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [noteDrafts, setNoteDrafts] = useState({});
  const [savedNotes, setSavedNotes] = useState({});
  const [savingNoteKey, setSavingNoteKey] = useState('');
  const [savedNoteKey, setSavedNoteKey] = useState('');
  const [noteError, setNoteError] = useState('');
  const noteKey = (businessUnit, materialCode) => `${businessUnit}\u001f${materialCode}`;
  const rows = useMemo(() => (reconciliation?.rows || []).map((row) => ({
    ...row,
    comparison: row.categories?.[category] || { inventory: {}, transit: {}, sources: [], status: '无法核对', reason: '缺少核对结果', hasData: false }
  })).filter((row) => row.comparison.hasData), [reconciliation, category]);
  const optionValues = (field) => [...new Set(rows.map((row) => row[field]).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN'));
  const options = useMemo(() => ({
    businessUnits: optionValues('businessUnit'),
    productLines: optionValues('productLine'),
    productSeries: optionValues('productSeries'),
    sources: [...new Set(rows.flatMap((row) => row.comparison.sources.map((source) => source.label)))].sort((left, right) => left.localeCompare(right, 'zh-CN')),
    statuses: ['有差异', '无差异', '无法核对']
  }), [rows]);
  const selected = (values, value) => !values.length || values.includes(value);
  const filteredRows = useMemo(() => {
    const keyword = filters.keyword.trim().toLowerCase();
    return rows.filter((row) => {
      const sourceMatch = !filters.sources.length || row.comparison.sources.some((source) => filters.sources.includes(source.label));
      const keywordMatch = !keyword || [row.businessUnit, row.productLine, row.productSeries, row.materialCode, row.sku, row.materialName, row.comparison.reason, noteDrafts[noteKey(row.businessUnit, row.materialCode)]]
        .some((value) => String(value || '').toLowerCase().includes(keyword));
      return selected(filters.businessUnits, row.businessUnit)
        && selected(filters.productLines, row.productLine)
        && selected(filters.productSeries, row.productSeries)
        && selected(filters.statuses, row.comparison.status)
        && sourceMatch
        && keywordMatch;
    });
  }, [rows, filters, noteDrafts]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const summary = reconciliation?.summaryByCategory?.[category] || {};
  const formatQty = (value) => Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 1 });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setNoteError('');
    request(`/api/inventory-summary/manual-reconciliation?category=${encodeURIComponent(category)}`, { token })
      .then((payload) => {
        if (!cancelled) {
          const notes = Object.fromEntries((payload.notes || []).map((note) => [noteKey(note.businessUnit, note.materialCode), note.remark || '']));
          setData(payload);
          setSavedNotes(notes);
          setNoteDrafts(notes);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || '手工库存核对加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category, token]);

  useEffect(() => {
    setCurrentPage(1);
    setExpandedRows(new Set());
  }, [category, filters, pageSize]);

  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const toggleExpanded = (id) => setExpandedRows((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const filteredSources = (row) => row.comparison.sources.filter((source) => !filters.sources.length || filters.sources.includes(source.label));
  const saveNote = async (row) => {
    const key = noteKey(row.businessUnit, row.materialCode);
    setSavingNoteKey(key);
    setSavedNoteKey('');
    setNoteError('');
    try {
      const payload = await request('/api/inventory-summary/manual-reconciliation/note', {
        token,
        method: 'PUT',
        body: JSON.stringify({
          category,
          businessUnit: row.businessUnit,
          materialCode: row.materialCode,
          remark: noteDrafts[key] || ''
        })
      });
      const remark = payload.note?.remark || '';
      setSavedNotes((current) => ({ ...current, [key]: remark }));
      setNoteDrafts((current) => ({ ...current, [key]: remark }));
      setSavedNoteKey(key);
    } catch (err) {
      setNoteError(err.message || '备注保存失败');
    } finally {
      setSavingNoteKey('');
    }
  };
  const exportRows = async () => {
    if (!filteredRows.length || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      const summaryRows = filteredRows.map((row) => ({
        分类: category,
        事业部: row.businessUnit,
        产品线: row.productLine,
        系列: row.productSeries,
        物料编码: row.materialCode,
        SKU: row.sku,
        物料名称: row.materialName,
        系统在库量: row.comparison.inventory.systemQty,
        手工在库量: row.comparison.inventory.manualQty,
        在库差异: row.comparison.inventory.differenceQty,
        系统在途量: row.comparison.transit.systemQty,
        手工在途量: row.comparison.transit.manualQty,
        在途差异: row.comparison.transit.differenceQty,
        是否有差异: row.comparison.status,
        原因分析: row.comparison.reason,
        备注: noteDrafts[noteKey(row.businessUnit, row.materialCode)] || ''
      }));
      const sourceRows = filteredRows.flatMap((row) => filteredSources(row).map((source) => ({
        分类: category,
        事业部: row.businessUnit,
        物料编码: row.materialCode,
        SKU: row.sku,
        物料名称: row.materialName,
        来源: source.label,
        指标: source.group,
        系统数量: source.systemQty,
        手工数量: source.manualQty,
        差异数量: source.differenceQty,
        状态: source.status,
        原因: source.reason,
        系统主体: source.systemSubject,
        系统来源仓库: source.systemWarehouse,
        系统映射仓库: source.systemMappedWarehouse,
        手工主体: source.manualSubject,
        手工仓库: source.manualWarehouse
      })));
      const reasonRows = sourceRows.filter((row) => row.状态 !== '无差异');
      const unavailableRows = (reconciliation.unavailableFiles || []).map((row) => ({
        数据侧: row.side,
        槽位: row.slotId,
        核对来源: row.source,
        状态: row.status
      }));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), '汇总核对');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sourceRows.length ? sourceRows : [{ 提示: '当前筛选无来源明细' }]), '来源差异明细');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(reasonRows.length ? reasonRows : [{ 提示: '当前筛选无差异原因' }]), '原因分析');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(unavailableRows.length ? unavailableRows : [{ 提示: '所有核对文件均已应用' }]), '未应用文件清单');
      await writeStyledExcelFile(XLSX, workbook, `手工库存核对_${category}_${todayText()}.xlsx`);
    } catch (err) {
      setExportError(err.message || '导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="inventory-manual-reconciliation">
      <header className="inventory-methodology-header">
        <button type="button" className="ghost compact-button inventory-methodology-back" onClick={onBack}>← 返回销售与库存看板</button>
        <div>
          <span className="section-kicker">MANUAL INVENTORY CHECK</span>
          <h2>与手工表库存核对</h2>
          <p>按事业部与物料编码核对系统计算和手工表的在库量、在途量，并定位来源差异。</p>
        </div>
      </header>
      {loading ? (
        <div className="inventory-summary-status" role="status">加载中</div>
      ) : error ? (
        <div className="inventory-summary-status error" role="alert">手工库存核对加载失败：{error}</div>
      ) : !reconciliation ? (
        <div className="inventory-summary-status error" role="alert">暂无手工库存核对结果</div>
      ) : (
        <>
          <div className="inventory-manual-category-bar" role="group" aria-label="库存分类">
            {(reconciliation.categories || []).map((value) => (
              <button key={value} type="button" className={category === value ? 'active' : ''} onClick={() => setCategory(value)}>{value}</button>
            ))}
          </div>
          <section className="inventory-manual-metrics">
            <article><span>系统在库量</span><strong>{formatQty(summary.systemInventoryQty)}</strong></article>
            <article><span>手工在库量</span><strong>{formatQty(summary.manualInventoryQty)}</strong><small>差异 {formatQty(Number(summary.systemInventoryQty || 0) - Number(summary.manualInventoryQty || 0))}</small></article>
            <article><span>系统在途量</span><strong>{formatQty(summary.systemTransitQty)}</strong></article>
            <article><span>手工在途量</span><strong>{formatQty(summary.manualTransitQty)}</strong><small>差异 {formatQty(Number(summary.systemTransitQty || 0) - Number(summary.manualTransitQty || 0))}</small></article>
            <article><span>系统库存总量</span><strong>{formatQty(Number(summary.systemInventoryQty || 0) + Number(summary.systemTransitQty || 0))}</strong></article>
            <article><span>手工库存总量</span><strong>{formatQty(Number(summary.manualInventoryQty || 0) + Number(summary.manualTransitQty || 0))}</strong><small>有差异 {Number(summary.issueCount || 0).toLocaleString()} / 共 {Number(summary.rowCount || 0).toLocaleString()} 条</small></article>
          </section>
          <div className="toolbar filters-row inventory-summary-filters inventory-manual-filters">
            <MultiSelectFilter label="事业部" allLabel="全部事业部" value={filters.businessUnits} options={options.businessUnits} onChange={(value) => updateFilter('businessUnits', value)} />
            <MultiSelectFilter label="产品线" allLabel="全部产品线" value={filters.productLines} options={options.productLines} onChange={(value) => updateFilter('productLines', value)} />
            <MultiSelectFilter label="系列" allLabel="全部系列" value={filters.productSeries} options={options.productSeries} onChange={(value) => updateFilter('productSeries', value)} />
            <MultiSelectFilter label="来源" allLabel="全部来源" value={filters.sources} options={options.sources} onChange={(value) => updateFilter('sources', value)} />
            <MultiSelectFilter label="是否有差异" allLabel="全部状态" value={filters.statuses} options={options.statuses} onChange={(value) => updateFilter('statuses', value)} />
            <input className="search-input" placeholder="搜索物料编码、SKU、名称或原因" value={filters.keyword} onChange={(event) => updateFilter('keyword', event.target.value)} />
            <button type="button" className="ghost compact-button" onClick={() => setFilters({ businessUnits: [], productLines: [], productSeries: [], sources: [], statuses: [], keyword: '' })}>清空筛选</button>
            <button type="button" className="compact-button" disabled={exporting || !filteredRows.length} onClick={exportRows}>{exporting ? '正在生成Excel...' : '导出Excel'}</button>
          </div>
          {(exportError || noteError) && <p className="inventory-manual-export-error" role="alert">{exportError || noteError}</p>}
          {(reconciliation.unavailableFiles || []).length > 0 && (
            <div className="inventory-manual-unavailable" role="status">
              当前有 {reconciliation.unavailableFiles.length} 个核对文件未应用，对应来源显示“无法核对”。
            </div>
          )}
          <div className="inventory-manual-table-wrap">
            <table className="inventory-manual-table">
              <thead><tr><th>明细</th><th>事业部</th><th>产品线</th><th>系列</th><th>物料编码</th><th>SKU</th><th>物料名称</th><th>系统在库量</th><th>手工在库量</th><th>在库差异</th><th>系统在途量</th><th>手工在途量</th><th>在途差异</th><th>是否有差异</th><th>原因分析</th><th>备注</th></tr></thead>
              <tbody>
                {pageRows.map((row) => (
                  <Fragment key={row.id}>
                    <tr key={row.id} className={row.comparison.status === '无差异' ? '' : 'has-issue'}>
                      <td><button type="button" className="inventory-manual-expand" onClick={() => toggleExpanded(row.id)} aria-label={`${expandedRows.has(row.id) ? '收起' : '展开'}${row.materialCode}来源明细`}>{expandedRows.has(row.id) ? '−' : '+'}</button></td>
                      <td>{row.businessUnit}</td><td>{row.productLine}</td><td>{row.productSeries}</td><td>{row.materialCode}</td><td>{row.sku}</td><td>{row.materialName}</td>
                      <td>{formatQty(row.comparison.inventory.systemQty)}</td><td>{formatQty(row.comparison.inventory.manualQty)}</td><td>{formatQty(row.comparison.inventory.differenceQty)}</td>
                      <td>{formatQty(row.comparison.transit.systemQty)}</td><td>{formatQty(row.comparison.transit.manualQty)}</td><td>{formatQty(row.comparison.transit.differenceQty)}</td>
                      <td><span className={`inventory-manual-status status-${row.comparison.status}`}>{row.comparison.status}</span></td><td>{row.comparison.reason}</td>
                      <td className="inventory-manual-note-cell">
                        <div className="inventory-manual-note-editor">
                          <input
                            type="text"
                            maxLength="500"
                            aria-label={`${row.businessUnit}${row.materialCode}备注`}
                            placeholder="填写备注"
                            value={noteDrafts[noteKey(row.businessUnit, row.materialCode)] || ''}
                            onChange={(event) => {
                              const key = noteKey(row.businessUnit, row.materialCode);
                              setNoteDrafts((current) => ({ ...current, [key]: event.target.value }));
                              setSavedNoteKey('');
                            }}
                          />
                          <button
                            type="button"
                            className="ghost compact-button"
                            disabled={savingNoteKey === noteKey(row.businessUnit, row.materialCode) || (noteDrafts[noteKey(row.businessUnit, row.materialCode)] || '') === (savedNotes[noteKey(row.businessUnit, row.materialCode)] || '')}
                            onClick={() => saveNote(row)}
                          >
                            {savingNoteKey === noteKey(row.businessUnit, row.materialCode) ? '保存中' : '保存'}
                          </button>
                          {savedNoteKey === noteKey(row.businessUnit, row.materialCode) && <span>已保存</span>}
                        </div>
                      </td>
                    </tr>
                    {expandedRows.has(row.id) && (
                      <tr key={`${row.id}-details`} className="inventory-manual-detail-row"><td colSpan="16">
                        <table><thead><tr><th>来源</th><th>指标</th><th>系统数量</th><th>手工数量</th><th>差异</th><th>状态</th><th>原因</th><th>系统主体</th><th>系统来源仓库</th><th>系统映射仓库</th><th>手工主体</th><th>手工仓库</th></tr></thead>
                          <tbody>{filteredSources(row).map((source, index) => <tr key={source.id || `${source.label}-${source.group}-${index}`}><td>{source.label}</td><td>{source.group}</td><td>{formatQty(source.systemQty)}</td><td>{formatQty(source.manualQty)}</td><td>{formatQty(source.differenceQty)}</td><td>{source.status}</td><td>{source.reason}</td><td>{source.systemSubject || '-'}</td><td>{source.systemWarehouse || '-'}</td><td>{source.systemMappedWarehouse || '-'}</td><td>{source.manualSubject || '-'}</td><td>{source.manualWarehouse || '-'}</td></tr>)}</tbody>
                        </table>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
                {!pageRows.length && <tr><td colSpan="16" className="empty-cell">当前筛选无核对记录</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="inventory-manual-table-footer">
            <span>当前 {filteredRows.length} / {rows.length} 条</span>
            <div className="inventory-manual-page-controls">
              <label className="inventory-manual-page-size">每页
                <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                  {[20, 50, 100, 200].map((size) => <option key={size} value={size}>{size} 行</option>)}
                </select>
              </label>
              {totalPages > 1 && <TablePagination label="手工库存核对分页" currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} pageSize={pageSize} />}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function InventorySummary({ token, active }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(inventoryDefaultFilters);
  const [searchInput, setSearchInput] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [showMethodology, setShowMethodology] = useState(false);
  const [showManualReconciliation, setShowManualReconciliation] = useState(false);
  const [showSourceBreakdown, setShowSourceBreakdown] = useState(false);
  const [showSourceWarehouses, setShowSourceWarehouses] = useState(false);
  const [salesMonthRange, setSalesMonthRange] = useState('3');

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    request('/api/inventory-summary', { token })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || '库存汇总加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => ({ ...current, keyword: searchInput }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const rows = data?.rows || [];
  const filterDefinitions = [
    ['businessUnits', 'businessUnit'],
    ['productLines', 'productLine'],
    ['productSeries', 'productSeries'],
    ['skus', 'sku']
  ];
  const rowMatches = (row, omitted = '') => {
    const scalarMatches = filterDefinitions.every(([filterKey, rowKey]) => (
      omitted === filterKey || filters[filterKey].length === 0 || filters[filterKey].includes(normalize(row[rowKey]))
    ));
    const sourceMatches = omitted === 'inventorySources'
      || filters.inventorySources.length === 0
      || (row.inventorySources || []).some((value) => filters.inventorySources.includes(value));
    const subjectMatches = omitted === 'inventorySubjects'
      || filters.inventorySubjects.length === 0
      || (row.inventorySubjects || []).some((value) => filters.inventorySubjects.includes(value));
    const productTypeMatches = omitted === 'productTypes'
      || filters.productTypes.length === 0
      || inventoryRowMatchesProductTypes(row, filters.inventorySubjects, filters.productTypes);
    const selectedSubjects = omitted === 'inventorySubjects' ? [] : filters.inventorySubjects;
    const selectedProductTypes = omitted === 'productTypes' ? [] : filters.productTypes;
    const selectedSites = omitted === 'sites' ? [] : filters.sites;
    const selectedLevel1Categories = omitted === 'level1WarehouseCategories' ? [] : filters.level1WarehouseCategories;
    const selectedLevel2Categories = omitted === 'level2WarehouseCategories' ? [] : filters.level2WarehouseCategories;
    const warehouseMatches = (selectedSites.length === 0 && selectedLevel1Categories.length === 0 && selectedLevel2Categories.length === 0)
      || (row.inventorySourceDetails || []).some((item) => (
        inventorySourceDetailMatches(item, selectedSubjects, selectedProductTypes, selectedSites, selectedLevel1Categories, selectedLevel2Categories)
      ));
    const keyword = normalize(filters.keyword).toLowerCase();
    const keywordMatches = !keyword || [
      row.matchKey, row.businessUnit, row.productLine, row.productSeries, row.materialCode,
      row.sku, row.materialName, row.rawIdentifier, ...inventoryRowProductTypes(row),
      ...(row.inventorySubjects || []), ...(row.issues || []),
      ...(row.inventorySourceDetails || []).flatMap((item) => [item.site, item.level1WarehouseCategory, item.level2WarehouseCategory]),
      inventorySourceWarehouses(row)
    ].join(' ').toLowerCase().includes(keyword);
    return scalarMatches && sourceMatches && subjectMatches && productTypeMatches && warehouseMatches && keywordMatches;
  };
  const unique = (values) => [...new Set(values.flat().map(normalize).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  const options = useMemo(() => {
    const rowsFor = (key) => rows.filter((row) => rowMatches(row, key));
    const matchingSourceDetails = (row, omitted = '') => (row.inventorySourceDetails || []).filter((item) => (
      inventorySourceDetailMatches(
        item,
        omitted === 'inventorySubjects' ? [] : filters.inventorySubjects,
        omitted === 'productTypes' ? [] : filters.productTypes,
        omitted === 'sites' ? [] : filters.sites,
        omitted === 'level1WarehouseCategories' ? [] : filters.level1WarehouseCategories,
        omitted === 'level2WarehouseCategories' ? [] : filters.level2WarehouseCategories
      )
    ));
    return {
      businessUnits: unique(rowsFor('businessUnits').map((row) => row.businessUnit)),
      inventorySubjects: unique(rowsFor('inventorySubjects').map((row) => matchingSourceDetails(row, 'inventorySubjects').map((item) => item.subject))),
      productTypes: INVENTORY_PRODUCT_TYPE_OPTIONS,
      productLines: unique(rowsFor('productLines').map((row) => row.productLine)),
      productSeries: unique(rowsFor('productSeries').map((row) => row.productSeries)),
      skus: unique(rowsFor('skus').map((row) => row.sku)),
      sites: unique(rowsFor('sites').map((row) => matchingSourceDetails(row, 'sites').map((item) => item.site))),
      level1WarehouseCategories: unique(rowsFor('level1WarehouseCategories').map((row) => matchingSourceDetails(row, 'level1WarehouseCategories').map((item) => item.level1WarehouseCategory))),
      level2WarehouseCategories: unique(rowsFor('level2WarehouseCategories').map((row) => matchingSourceDetails(row, 'level2WarehouseCategories').map((item) => item.level2WarehouseCategory))),
      inventorySources: unique(rowsFor('inventorySources').map((row) => row.inventorySources || []))
    };
  }, [rows, filters]);
  const filteredRows = useMemo(() => rows
    .filter((row) => rowMatches(row))
    .map((row) => inventoryRowForFilters(
      row,
      filters.inventorySubjects,
      filters.productTypes,
      filters.sites,
      filters.level1WarehouseCategories,
      filters.level2WarehouseCategories
    )), [rows, filters]);
  const totals = useMemo(() => inventoryDashboardTotals(filteredRows), [filteredRows]);
  const fullTotals = useMemo(() => inventoryDashboardTotals(rows), [rows]);
  const businessUnitRows = useMemo(() => inventoryDashboardGroups(filteredRows, (row) => row.businessUnit), [filteredRows]);
  const productLineRows = useMemo(() => inventoryDashboardGroups(filteredRows, (row) => row.productLine), [filteredRows]);
  const monthRows = useMemo(() => (data?.months || []).map((month) => ({
    id: month,
    name: `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`,
    salesQty: filteredRows.reduce((sum, row) => sum + numberValue(row.salesByMonth?.[month]), 0),
    salesAmount: filteredRows.reduce((sum, row) => sum + numberValue(row.salesAmountByMonth?.[month]), 0)
  })), [data?.months, filteredRows]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => { setCurrentPage(1); }, [filters, pageSize]);
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const share = (current, full) => full ? current / full * 100 : 0;
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const clearFilters = () => {
    setSearchInput('');
    setFilters(inventoryDefaultFilters());
  };
  const allMonthColumns = [...(data?.months || [])].sort((left, right) => String(left).localeCompare(String(right)));
  const monthColumns = salesMonthRange === 'all'
    ? allMonthColumns
    : allMonthColumns.slice(-Number(salesMonthRange));
  const tableColumns = [
    ...(showSourceWarehouses ? [['来源仓库', (row) => <InventorySourceWarehouseCell row={row} />]] : []),
    ['事业部', (row) => row.businessUnit],
    ['产品线', (row) => row.productLine],
    ['系列', (row) => row.productSeries],
    ['物料编码', (row) => row.materialCode],
    ['SKU', (row) => row.sku],
    ['SKU名称', (row) => row.materialName],
    ...monthColumns.map((month) => [
      `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`,
      (row) => formatDashboardNumber(row.salesByMonth?.[month])
    ]),
    ['销售数量合计', (row) => formatDashboardNumber(row.salesQty)],
    ['销售金额合计', (row) => formatDashboardWan(row.salesAmount)],
    ['销量', (row) => row.quantityAbc],
    ['销售额', (row) => row.amountAbc],
    ['在库量', (row) => formatDashboardNumber(row.inventoryQty)],
    ['在途量', (row) => formatDashboardNumber(row.transitQty)],
    ...(showSourceBreakdown ? [
      ['FBA在库', (row) => formatDashboardNumber(row.fbaInventoryQty)],
      ['FBM在库', (row) => formatDashboardNumber(row.fbmInventoryQty)],
      ['WFS在库', (row) => formatDashboardNumber(row.wfsInventoryQty)],
      ['国内在库', (row) => formatDashboardNumber(row.domesticMainInventoryQty)],
      ['京东在库', (row) => formatDashboardNumber(row.jdInventoryQty)],
      ['FBA在途', (row) => formatDashboardNumber(row.fbaTransitQty)],
      ['FBM在途', (row) => formatDashboardNumber(row.fbmTransitQty)],
      ['WFS在途', (row) => formatDashboardNumber(row.wfsTransitQty)],
      ['京东在途', (row) => formatDashboardNumber(row.jdTransitQty)],
      ['已生产未发货', (row) => formatDashboardNumber(row.finishedNotShippedQty)],
      ['已下单未备料未生产', (row) => formatDashboardNumber(row.unpreparedQty)],
      ['已备料未生产', (row) => formatDashboardNumber(row.preparedNotStartedQty)],
      ['生产中产品', (row) => formatDashboardNumber(row.inProductionQty)]
    ] : []),
    ['未交付数量', (row) => formatDashboardNumber(row.unfulfilledQty)],
    ['是否需正常交货', (row) => row.deliveryStatus],
    ['不含税结算价', (row) => formatDashboardNumber(row.pretaxPrice)],
    ['正常履约订单数量', (row) => formatDashboardNumber(row.normalOrderQty)],
    ['正常履约订单金额', (row) => formatDashboardWan(row.normalOrderValue)],
    ['非正常履约订单数量', (row) => formatDashboardNumber(row.abnormalOrderQty)],
    ['非正常履约订单金额', (row) => formatDashboardWan(row.abnormalOrderValue)]
  ];

  async function exportRows() {
    if (!filteredRows.length) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const aoa = [
        tableColumns.map(([label]) => label),
        ...filteredRows.map((row) => [
          ...(showSourceWarehouses ? [inventorySourceWarehouses(row, '\n')] : []),
          row.businessUnit, row.productLine, row.productSeries, row.materialCode, row.sku, row.materialName,
          ...monthColumns.map((month) => numberValue(row.salesByMonth?.[month])),
          numberValue(row.salesQty), numberValue(row.salesAmount), row.quantityAbc, row.amountAbc,
          numberValue(row.inventoryQty), numberValue(row.transitQty),
          ...(showSourceBreakdown ? [
            numberValue(row.fbaInventoryQty), numberValue(row.fbmInventoryQty), numberValue(row.wfsInventoryQty),
            numberValue(row.domesticMainInventoryQty), numberValue(row.jdInventoryQty),
            numberValue(row.fbaTransitQty), numberValue(row.fbmTransitQty), numberValue(row.wfsTransitQty), numberValue(row.jdTransitQty),
            numberValue(row.finishedNotShippedQty), numberValue(row.unpreparedQty),
            numberValue(row.preparedNotStartedQty), numberValue(row.inProductionQty)
          ] : []),
          numberValue(row.unfulfilledQty), row.deliveryStatus, numberValue(row.pretaxPrice),
          numberValue(row.normalOrderQty), numberValue(row.normalOrderValue),
          numberValue(row.abnormalOrderQty), numberValue(row.abnormalOrderValue)
        ])
      ];
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(aoa);
      worksheet['!cols'] = tableColumns.map(([label]) => ({ wch: label === '来源仓库' ? 64 : Math.max(12, label.length + 2) }));
      XLSX.utils.book_append_sheet(workbook, worksheet, '库存汇总');
      await writeStyledExcelFile(XLSX, workbook, `库存汇总_${todayText()}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  async function exportInventorySummary() {
    if (!filteredRows.length) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const groups = new Map();
      filteredRows.forEach((row) => {
        (row.inventorySourceDetails || []).forEach((item) => {
          const warehouse = normalize(item.sourceWarehouseName)
            || normalize(item.mappedWarehouseName)
            || normalize(item.receivingWarehouseName)
            || '无仓库字段';
          const inventoryQty = numberValue(item.fbaInventoryQty) + numberValue(item.fbmInventoryQty)
            - numberValue(item.wfsInventoryQty) + numberValue(item.domesticMainInventoryQty)
            - numberValue(item.jdInventoryQty);
          const transitQty = numberValue(item.fbaTransitQty) + numberValue(item.fbmTransitQty)
            - numberValue(item.wfsTransitQty) + numberValue(item.jdTransitQty);
          const key = `${normalize(row.businessUnit) || '未匹配'}\u0000${warehouse}`;
          const target = groups.get(key) || {
            businessUnit: normalize(row.businessUnit) || '未匹配',
            warehouse,
            inventoryQty: 0,
            transitQty: 0
          };
          target.inventoryQty += inventoryQty;
          target.transitQty += transitQty;
          groups.set(key, target);
        });
      });
      const summaryRows = [...groups.values()]
        .map((item) => ({ ...item, totalQty: item.inventoryQty + item.transitQty }))
        .sort((left, right) => (
          left.businessUnit.localeCompare(right.businessUnit, 'zh-Hans-CN')
          || (right.totalQty - left.totalQty)
        ));
      const aoa = [
        ['事业部', '仓库名称', '在库量', '在途量', '库存合计(在库+在途)'],
        ...summaryRows.map((item) => [
          item.businessUnit, item.warehouse,
          item.inventoryQty, item.transitQty, item.totalQty
        ])
      ];
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(aoa);
      worksheet['!cols'] = [
        { wch: 20 }, { wch: 48 }, { wch: 12 }, { wch: 12 }, { wch: 18 }
      ];
      XLSX.utils.book_append_sheet(workbook, worksheet, '库存汇总');
      await writeStyledExcelFile(XLSX, workbook, `库存汇总_事业部仓库_${todayText()}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  if (showMethodology) {
    return (
      <React.Suspense fallback={<div className="loading-fallback">加载中...</div>}>
        <InventoryCalculationGuide onBack={() => setShowMethodology(false)} />
      </React.Suspense>
    );
  }

  if (showManualReconciliation) {
    return (
      <InventoryManualReconciliation
        token={token}
        onBack={() => setShowManualReconciliation(false)}
      />
    );
  }

  return (
    <section className="inventory-dashboard">
      <div className="inventory-dashboard-heading">
        <div>
          <div className="inventory-dashboard-title-row">
            <h2>销售与库存看板</h2>
            <div className="inventory-dashboard-entry-actions">
              <button type="button" className="ghost compact-button inventory-methodology-entry" onClick={() => setShowMethodology(true)}>库存计算口径</button>
              <button type="button" className="ghost compact-button inventory-reconciliation-entry" onClick={() => setShowManualReconciliation(true)}>与手工表库存核对</button>
            </div>
          </div>
          <p>销售、在库、在途与采购未交付统一口径</p>
        </div>
        <span>数据更新：{data?.updatedAt || '暂无'}</span>
      </div>
      {loading ? (
        <div className="inventory-summary-status" role="status">加载中</div>
      ) : error ? (
        <div className="inventory-summary-status error" role="alert">库存汇总加载失败：{error}</div>
      ) : (
        <>
          <div className="toolbar filters-row inventory-summary-filters inventory-summary-filter-grid">
            <MultiSelectFilter label="事业部" allLabel="全部事业部" value={filters.businessUnits} options={options.businessUnits} onChange={(value) => updateFilter('businessUnits', value)} />
            <MultiSelectFilter label="库存主体" allLabel="全部库存主体" value={filters.inventorySubjects} options={options.inventorySubjects} onChange={(value) => updateFilter('inventorySubjects', value)} />
            <MultiSelectFilter label="站点" allLabel="全部站点" value={filters.sites} options={options.sites} onChange={(value) => updateFilter('sites', value)} />
            <MultiSelectFilter label="一级仓库分类" allLabel="全部一级仓库分类" value={filters.level1WarehouseCategories} options={options.level1WarehouseCategories} onChange={(value) => updateFilter('level1WarehouseCategories', value)} />
            <MultiSelectFilter label="二级仓库分类" allLabel="全部二级仓库分类" value={filters.level2WarehouseCategories} options={options.level2WarehouseCategories} onChange={(value) => updateFilter('level2WarehouseCategories', value)} />
            <MultiSelectFilter label="成品/配件" allLabel="全部类型" value={filters.productTypes} options={options.productTypes} onChange={(value) => updateFilter('productTypes', value)} />
            <MultiSelectFilter label="产品线" allLabel="全部产品线" value={filters.productLines} options={options.productLines} onChange={(value) => updateFilter('productLines', value)} />
            <MultiSelectFilter label="系列" allLabel="全部系列" value={filters.productSeries} options={options.productSeries} onChange={(value) => updateFilter('productSeries', value)} />
            <MultiSelectFilter label="SKU" allLabel="全部SKU" value={filters.skus} options={options.skus} onChange={(value) => updateFilter('skus', value)} />
            <MultiSelectFilter label="库存来源" allLabel="全部库存来源" value={filters.inventorySources} options={options.inventorySources} onChange={(value) => updateFilter('inventorySources', value)} />
            <input className="search-input" placeholder="搜索事业部、物料编码、SKU或名称" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
            <button type="button" className="ghost compact-button" onClick={clearFilters}>清除筛选</button>
          </div>

          <section className="inventory-kpi-grid inventory-five-kpis" aria-label="销售与库存指标">
            <InventoryPurchaseMetric label="销售" quantity={totals.salesQty} value={formatDashboardWan(totals.salesAmount)} note="当前筛选/全量" share={share(totals.salesQty, fullTotals.salesQty)} tone="total" />
            <InventoryPurchaseMetric label="在库" quantity={totals.inventoryQty} value={formatDashboardWan(totals.inventoryValue)} note="当前筛选/全量" share={share(totals.inventoryQty, fullTotals.inventoryQty)} tone="domestic" />
            <InventoryPurchaseMetric label="在途" quantity={totals.transitQty} value={formatDashboardWan(totals.transitValue)} note="当前筛选/全量" share={share(totals.transitQty, fullTotals.transitQty)} tone="transit" />
            <InventoryPurchaseMetric label="采购未交付" quantity={totals.unfulfilledQty} value={formatDashboardWan(totals.unfulfilledValue)} note="当前筛选/全量" share={share(totals.unfulfilledQty, fullTotals.unfulfilledQty)} tone="production" />
            <InventoryPurchaseMetric label="库存规模合计" quantity={totals.scaleQty} value={formatDashboardWan(totals.scaleValue)} note="在库+在途+未交付" share={share(totals.scaleQty, fullTotals.scaleQty)} tone="materials" />
          </section>

          <div className="inventory-composition-row">
            <section className="inventory-transit-breakdown" aria-labelledby="inventoryStockBreakdownTitle">
              <div className="inventory-transit-breakdown-head">
                <h3 id="inventoryStockBreakdownTitle">在库构成</h3>
                <span>主数字按当前筛选；文件全量不受页面筛选影响</span>
              </div>
              <div className="inventory-kpi-grid inventory-stock-kpis">
                <InventoryPurchaseMetric label="FBA在库" quantity={totals.fbaInventoryQty} fullQuantity={fullTotals.fbaInventoryQty} value={formatDashboardWan(totals.fbaInventoryValue)} note="占筛选后在库合计" share={share(totals.fbaInventoryQty, totals.inventoryQty)} tone="fba-stock" />
                <InventoryPurchaseMetric label="FBM在库" quantity={totals.fbmInventoryQty} fullQuantity={fullTotals.fbmInventoryQty} value={formatDashboardWan(totals.fbmInventoryValue)} note="占筛选后在库合计" share={share(totals.fbmInventoryQty, totals.inventoryQty)} tone="fbm-stock" />
                <InventoryPurchaseMetric label="WFS在库" quantity={totals.wfsInventoryQty} fullQuantity={fullTotals.wfsInventoryQty} value={formatDashboardWan(totals.wfsInventoryValue)} note="占筛选后在库合计" share={share(totals.wfsInventoryQty, totals.inventoryQty)} tone="wfs-stock" />
                <InventoryPurchaseMetric label="国内在库" quantity={totals.domesticMainInventoryQty} fullQuantity={fullTotals.domesticMainInventoryQty} value={formatDashboardWan(totals.domesticMainInventoryValue)} note="占筛选后在库合计" share={share(totals.domesticMainInventoryQty, totals.inventoryQty)} tone="domestic" />
                <InventoryPurchaseMetric label="京东在库" quantity={totals.jdInventoryQty} fullQuantity={fullTotals.jdInventoryQty} value={formatDashboardWan(totals.jdInventoryValue)} note="占筛选后在库合计" share={share(totals.jdInventoryQty, totals.inventoryQty)} tone="jd-stock" />
              </div>
            </section>

            <section className="inventory-transit-breakdown" aria-labelledby="inventoryTransitBreakdownTitle">
              <div className="inventory-transit-breakdown-head">
                <h3 id="inventoryTransitBreakdownTitle">在途构成</h3>
                <span>主数字按当前筛选；文件全量不受页面筛选影响</span>
              </div>
              <div className="inventory-kpi-grid inventory-transit-kpis">
                <InventoryPurchaseMetric label="FBA在途" quantity={totals.fbaTransitQty} fullQuantity={fullTotals.fbaTransitQty} value={formatDashboardWan(totals.fbaTransitValue)} note="占筛选后在途合计" share={share(totals.fbaTransitQty, totals.transitQty)} tone="fba-transit" />
                <InventoryPurchaseMetric label="FBM在途" quantity={totals.fbmTransitQty} fullQuantity={fullTotals.fbmTransitQty} value={formatDashboardWan(totals.fbmTransitValue)} note="占筛选后在途合计" share={share(totals.fbmTransitQty, totals.transitQty)} tone="fbm-transit" />
                <InventoryPurchaseMetric label="WFS在途" quantity={totals.wfsTransitQty} fullQuantity={fullTotals.wfsTransitQty} value={formatDashboardWan(totals.wfsTransitValue)} note="占筛选后在途合计" share={share(totals.wfsTransitQty, totals.transitQty)} tone="wfs-transit" />
                <InventoryPurchaseMetric label="京东在途" quantity={totals.jdTransitQty} fullQuantity={fullTotals.jdTransitQty} value={formatDashboardWan(totals.jdTransitValue)} note="占筛选后在途合计" share={share(totals.jdTransitQty, totals.transitQty)} tone="jd-transit" />
              </div>
            </section>
          </div>

          <section className="inventory-chart-grid">
            <InventorySummaryMonthlyBars title="每月销售变化趋势" rows={monthRows} />
            <InventorySummaryVerticalGroupedBars title="销售产品线库存、在途与未交付" rows={productLineRows} />
            <InventorySummaryVerticalGroupedBars title="事业部库存、在途与未交付" rows={businessUnitRows} />
            <InventorySummaryAbc rows={filteredRows} />
          </section>

          <div className="inventory-table-tabs inventory-summary-table-head">
            <strong>事业部订单库存明细</strong>
            <div className="inventory-table-actions">
              <span>当前筛选 {filteredRows.length} / {rows.length} 条，异常 {filteredRows.filter((row) => row.mappingStatus !== '完整').length} 条</span>
              <button type="button" className="ghost compact-button" onClick={() => setShowSourceWarehouses((current) => !current)}>{showSourceWarehouses ? '隐藏来源仓库' : '显示来源仓库'}</button>
              <button type="button" className="ghost compact-button" onClick={() => setShowSourceBreakdown((current) => !current)}>{showSourceBreakdown ? '隐藏来源分层' : '显示来源分层'}</button>
              <label className="inventory-page-size inventory-sales-month-range">销售月份
                <select value={salesMonthRange} onChange={(event) => setSalesMonthRange(event.target.value)}>
                  <option value="3">最近3个月</option>
                  <option value="6">最近6个月</option>
                  <option value="12">最近12个月</option>
                  <option value="all">全部月份</option>
                </select>
              </label>
              <button type="button" className="ghost compact-button" disabled={exporting || !filteredRows.length} onClick={exportInventorySummary}>{exporting ? '导出中...' : '导出库存汇总'}</button>
              <button type="button" className="ghost compact-button" disabled={exporting || !filteredRows.length} onClick={exportRows}>{exporting ? '导出中...' : '导出Excel'}</button>
              <label className="inventory-page-size">每页
                <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                  {[10, 25, 50, 100].map((value) => <option key={value} value={value}>{value} 条</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="inventory-detail-scroll">
            <table className={`inventory-detail-table${showSourceWarehouses ? ' show-source-warehouses' : ''}`}>
              <thead><tr>{tableColumns.map(([label]) => <th key={label}>{label}</th>)}</tr></thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr><td colSpan={tableColumns.length}>暂无数据</td></tr>
                ) : pageRows.map((row) => (
                  <tr key={row.id} className={row.mappingStatus !== '完整' ? 'mapping-conflict' : ''}>
                    {tableColumns.map(([label, valueOf]) => (
                      <td key={label} title={label === '来源仓库' ? inventorySourceWarehouses(row, '\n') : String(valueOf(row) ?? '')}>{valueOf(row)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredRows.length > pageSize && (
            <TablePagination label="库存汇总分页" currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} pageSize={pageSize} />
          )}
        </>
      )}
    </section>
  );
}

function SeriesBarChart({ title, rows, valueKey }) {
  const chartRows = rows
    .map((row) => ({ name: row.series, value: numberValue(row[valueKey]) }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  const maxValue = Math.max(...chartRows.map((row) => row.value), 1);
  return (
    <article className="panel series-chart">
      <h3>{title}</h3>
      <div className="bar-list">
        {chartRows.length === 0 ? (
          <p className="empty-chart">暂无数据</p>
        ) : chartRows.map((row) => (
          <div key={row.name} className="bar-row series-bar-row">
            <span title={row.name}>{row.name}</span>
            <div className="bar-track"><i style={{ width: `${Math.max(row.value / maxValue * 100, 6)}%` }} /></div>
            <strong>{row.value.toLocaleString()}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function ProgressStackedChart({ title, rows, groupBy }) {
  const chartRows = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      const name = normalize(groupBy(row)) || '未分类';
      const record = map.get(name) || {
        name,
        remainingQty: 0,
        unpreparedQty: 0,
        preparedNotStartedQty: 0,
        inProductionQty: 0,
        finishedQty: 0
      };
      record.remainingQty += numberValue(row.remainingInboundQty);
      record.unpreparedQty += numberValue(row.unpreparedQty);
      record.preparedNotStartedQty += numberValue(row.preparedNotStartedQty);
      record.inProductionQty += numberValue(row.inProductionQty);
      record.finishedQty += numberValue(row.finishedQty);
      map.set(name, record);
    });
    return [...map.values()]
      .filter((row) => row.remainingQty > 0 || row.unpreparedQty > 0 || row.preparedNotStartedQty > 0 || row.inProductionQty > 0 || row.finishedQty > 0)
      .sort((a, b) => b.remainingQty - a.remainingQty)
      .slice(0, 15);
  }, [rows, groupBy]);
  const maxDisplayQty = Math.max(...chartRows.map((row) => Math.max(
    numberValue(row.remainingQty),
    numberValue(row.unpreparedQty) + numberValue(row.preparedNotStartedQty) + numberValue(row.inProductionQty) + numberValue(row.finishedQty)
  )), 1);

  return (
    <article className="panel progress-stack-chart">
      <div className="chart-title-row">
        <h3>{title}</h3>
        <span className="chart-legend">
          <i className="unprepared" />未备料
          <i className="prepared" />已备料
          <i className="in-production" />生产中
          <i className="finished" />完工未发
        </span>
      </div>
      <div className="stack-list">
        {chartRows.length === 0 ? (
          <p className="empty-chart">暂无数据</p>
        ) : chartRows.map((row) => {
          const remainingQty = numberValue(row.remainingQty);
          const segments = [
            ['unprepared', numberValue(row.unpreparedQty)],
            ['prepared', numberValue(row.preparedNotStartedQty)],
            ['in-production', numberValue(row.inProductionQty)],
            ['finished', numberValue(row.finishedQty)]
          ];
          const segmentTotal = segments.reduce((sum, [, value]) => sum + value, 0);
          const displayQty = Math.max(remainingQty, segmentTotal);
          const barPct = Math.max(Math.min(displayQty / maxDisplayQty * 100, 100), 8);
          const visibleSegments = segments.filter(([, value]) => value > 0).length;
          return (
            <div key={row.name} className="stack-row">
              <span title={row.name}>{row.name}</span>
              <div className="stack-track" title={`未交付 ${row.remainingQty}，未备料 ${row.unpreparedQty}，已备料 ${row.preparedNotStartedQty}，生产中 ${row.inProductionQty}，完工未发 ${row.finishedQty}`}>
                <div className="stack-total" data-segments={visibleSegments} style={{ width: `${barPct}%` }}>
                  {segments.map(([className, value]) => value > 0 && (
                    <div key={className} className={`stack-fill ${className}`} style={{ width: `${value / Math.max(segmentTotal, 1) * 100}%` }}>
                      <b>{value.toLocaleString()}</b>
                    </div>
                  ))}
                </div>
              </div>
              <strong className="stack-summary">{remainingQty.toLocaleString()}</strong>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function InventoryRankingChart({ title, rows, groupBy, valueKey = 'availableQty', valueLabel = '库存数量' }) {
  const chartRows = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      const name = normalize(groupBy(row)) || '未分类';
      map.set(name, numberValue(map.get(name)) + numberValue(row[valueKey]));
    });
    return [...map.entries()]
      .map(([name, value]) => ({ name, value }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 15);
  }, [rows, groupBy]);
  const maxValue = Math.max(...chartRows.map((row) => row.value), 1);

  return (
    <article className="panel progress-stack-chart">
      <div className="chart-title-row">
        <h3>{title}</h3>
        <span className="chart-legend"><i className="in-production" />{valueLabel}</span>
      </div>
      <div className="stack-list">
        {chartRows.length === 0 ? (
          <p className="empty-chart">暂无数据</p>
        ) : chartRows.map((row) => {
          const barPct = Math.max(Math.min(row.value / maxValue * 100, 100), 8);
          return (
            <div key={row.name} className="stack-row">
              <span title={row.name}>{row.name}</span>
              <div className="stack-track" title={`${row.name}：${row.value.toLocaleString()}`}>
                <div className="stack-total" data-segments="1" style={{ width: `${barPct}%` }}>
                  <div className="stack-fill in-production" style={{ width: '100%' }}>
                    <b>{row.value.toLocaleString()}</b>
                  </div>
                </div>
              </div>
              <strong className="stack-summary">{row.value.toLocaleString()}</strong>
            </div>
          );
        })}
      </div>
    </article>
  );
}

const FIRST_MILE_BAR_COLORS = ['#1683ff', '#2ccf66', '#ff9f0a', '#a855f7', '#ff315f', '#38bdf8', '#5454d4', '#22c55e'];

function FirstMileDimensionChart({ title, rows, groupBy }) {
  const total = rows.reduce((sum, row) => sum + numberValue(row.quantity), 0);
  const grouped = new Map();
  rows.forEach((row) => {
    const name = normalize(groupBy(row)) || '未匹配';
    grouped.set(name, numberValue(grouped.get(name)) + numberValue(row.quantity));
  });
  const chartRows = [...grouped.entries()]
    .map(([name, value]) => ({ name, value }))
    .filter((row) => row.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, 8);
  const maxValue = Math.max(...chartRows.map((row) => row.value), 1);

  return (
    <article className="panel first-mile-dimension-chart">
      <div className="first-mile-chart-title">
        <h3>{title}</h3>
        <span>合计 {formatQuantity(total)} 件</span>
      </div>
      <div className="first-mile-bar-list">
        {chartRows.length === 0 ? (
          <p className="empty-chart">暂无数据</p>
        ) : chartRows.map((row, index) => {
          const percentage = total > 0 ? row.value / total * 100 : 0;
          return (
            <div className="first-mile-bar-row" key={row.name}>
              <span title={row.name}>{row.name}</span>
              <div className="first-mile-bar-track" title={`${row.name}：${formatQuantity(row.value)} 件，占 ${percentage.toFixed(2)}%`}>
                <i style={{ width: `${Math.max(row.value / maxValue * 100, 2)}%`, background: FIRST_MILE_BAR_COLORS[index % FIRST_MILE_BAR_COLORS.length] }} />
              </div>
              <strong>{formatQuantity(row.value)} / {percentage.toFixed(2)}%</strong>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function DataTable({ columns, rows, render, renderRow, className = '', showHeader = true, tableWrapRef = null }) {
  return (
    <div className={`table-wrap ${className}`} ref={tableWrapRef}>
      <table>
        {showHeader && <thead>
          <tr>{columns.map((column, index) => <th key={typeof column === 'string' ? column : `column-${index}`}>{column}</th>)}</tr>
        </thead>}
        <tbody>
          {rows.length === 0 ? (
            <tr><td className="empty" colSpan={columns.length}>暂无数据</td></tr>
          ) : rows.map((row, index) => (
            renderRow ? renderRow(row, index) : (
              <tr key={row.rowKey || row.demandKey || row.id || `${index}-${row.materialCode || row.stock_key}`}>
                {render(row, index).map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
              </tr>
            )
          ))}
        </tbody>
      </table>
    </div>
  );
}

function paginationPageNumbers(currentPage, totalPages) {
  const visiblePages = totalPages <= 7
    ? Array.from({ length: totalPages }, (_, index) => index + 1)
    : [...new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1].filter((page) => page >= 1 && page <= totalPages))].sort((a, b) => a - b);
  return visiblePages.flatMap((page, index) => (
    index > 0 && page - visiblePages[index - 1] > 1 ? [`ellipsis-${page}`, page] : [page]
  ));
}

function TablePagination({ label, currentPage, totalPages, onPageChange, pageSize = 20 }) {
  const pageNumbers = paginationPageNumbers(currentPage, totalPages);
  return (
    <nav className="table-pagination" aria-label={label}>
      <button type="button" className="ghost compact-button" disabled={currentPage === 1} onClick={() => onPageChange(1)}>首页</button>
      <button type="button" className="ghost compact-button" disabled={currentPage === 1} onClick={() => onPageChange(Math.max(1, currentPage - 1))}>上一页</button>
      <div className="pagination-pages">
        {pageNumbers.map((page) => (
          typeof page === 'string'
            ? <span key={page} className="pagination-ellipsis">…</span>
            : <button key={page} type="button" className={`pagination-page${page === currentPage ? ' active' : ''}`} onClick={() => onPageChange(page)}>{page}</button>
        ))}
      </div>
      <button type="button" className="ghost compact-button" disabled={currentPage === totalPages} onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}>下一页</button>
      <button type="button" className="ghost compact-button" disabled={currentPage === totalPages} onClick={() => onPageChange(totalPages)}>末页</button>
      <span className="section-count">第 {currentPage} / {totalPages} 页，每页 {pageSize} 条</span>
    </nav>
  );
}

function PersistentHorizontalScrollbar({ activeTab }) {
  const scrollbarRef = useRef(null);
  const sourceRef = useRef(null);
  const sourceScrollHandlerRef = useRef(null);
  const [layout, setLayout] = useState({ visible: false, left: 0, width: 0, contentWidth: 0 });

  useEffect(() => {
    let animationFrame = 0;
    let resizeObserver;
    let mutationObserver;

    const detachSource = () => {
      if (sourceRef.current && sourceScrollHandlerRef.current) {
        sourceRef.current.removeEventListener('scroll', sourceScrollHandlerRef.current);
      }
      sourceRef.current = null;
      sourceScrollHandlerRef.current = null;
    };

    const attachSource = (source) => {
      if (sourceRef.current === source) return;
      detachSource();
      sourceRef.current = source;
      if (!source) return;
      sourceScrollHandlerRef.current = () => {
        if (scrollbarRef.current && Math.abs(scrollbarRef.current.scrollLeft - source.scrollLeft) > 1) {
          scrollbarRef.current.scrollLeft = source.scrollLeft;
        }
      };
      source.addEventListener('scroll', sourceScrollHandlerRef.current, { passive: true });
    };

    const update = () => {
      animationFrame = 0;
      const pane = document.querySelector(`.page-pane[data-page="${activeTab}"]:not([hidden])`);
      const candidates = pane
        ? [...pane.querySelectorAll('.table-wrap, .board-table-wrap')].filter((element) => (
          element.offsetParent !== null && element.scrollWidth > element.clientWidth + 1
        ))
        : [];
      if (!candidates.length) {
        attachSource(null);
        setLayout((current) => current.visible ? { ...current, visible: false } : current);
        return;
      }

      const viewportHeight = window.innerHeight;
      const ranked = candidates.map((element) => {
        const rect = element.getBoundingClientRect();
        const intersection = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        const distance = intersection > 0 ? 0 : Math.min(Math.abs(rect.top - viewportHeight), Math.abs(rect.bottom));
        return { element, rect, intersection, distance };
      }).sort((a, b) => b.intersection - a.intersection || a.distance - b.distance);
      const { element: source, rect, intersection } = ranked[0];
      if (intersection <= 0) {
        attachSource(null);
        setLayout((current) => current.visible ? { ...current, visible: false } : current);
        return;
      }
      attachSource(source);
      setLayout({
        visible: true,
        left: Math.max(0, rect.left),
        width: Math.max(0, Math.min(rect.width, window.innerWidth - Math.max(0, rect.left))),
        contentWidth: source.scrollWidth
      });
      window.requestAnimationFrame(() => {
        if (scrollbarRef.current && sourceRef.current === source) scrollbarRef.current.scrollLeft = source.scrollLeft;
      });
    };

    const scheduleUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(update);
    };

    const pane = document.querySelector(`.page-pane[data-page="${activeTab}"]`);
    window.addEventListener('resize', scheduleUpdate, { passive: true });
    window.addEventListener('scroll', scheduleUpdate, { passive: true, capture: true });
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(scheduleUpdate);
      const content = document.querySelector('.content');
      if (content) resizeObserver.observe(content);
      if (pane) resizeObserver.observe(pane);
    }
    if (window.MutationObserver && pane) {
      mutationObserver = new MutationObserver(scheduleUpdate);
      mutationObserver.observe(pane, { childList: true, subtree: true, attributes: true });
    }
    scheduleUpdate();

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      detachSource();
    };
  }, [activeTab]);

  function syncToSource(event) {
    if (sourceRef.current && Math.abs(sourceRef.current.scrollLeft - event.currentTarget.scrollLeft) > 1) {
      sourceRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
  }

  return (
    <div
      ref={scrollbarRef}
      className="persistent-horizontal-scrollbar"
      hidden={!layout.visible}
      style={{ left: layout.left, width: layout.width }}
      onScroll={syncToSource}
      aria-label="表格横向滚动条"
    >
      <div style={{ width: layout.contentWidth }} />
    </div>
  );
}

function PagePane({ page, activeTab, children }) {
  return (
    <div className="page-pane" data-page={page} hidden={activeTab !== page}>
      {children}
    </div>
  );
}

function SelectField({ label, value, options, onChange }) {
  const availableOptions = (options || []).filter(Boolean);
  if (availableOptions.length === 0) return null;
  return (
    <label className="filter-control">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">全部</option>
        {availableOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function usePaginatedRows(rows, resetKey, pageSize = 20) {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  useEffect(() => setCurrentPage(1), [resetKey]);
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [pageSize, rows, safePage]
  );
  return { currentPage: safePage, pageRows, pageSize, setCurrentPage, totalPages };
}

function MultiSelectFilter({ label, allLabel, value = [], options = [], onChange }) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const availableOptions = useMemo(
    () => [...new Set(options.map(normalize).filter(Boolean))],
    [options]
  );
  const selectedValues = Array.isArray(value) ? value : (normalize(value) ? [normalize(value)] : []);
  const selected = selectedValues.filter((item) => availableOptions.includes(item));

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (
        rootRef.current
        && !rootRef.current.contains(event.target)
        && !menuRef.current?.contains(event.target)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!open || !buttonRef.current) {
      setMenuPosition(null);
      return undefined;
    }
    const updateMenuPosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(250, rect.width);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setMenuPosition({ left, top: rect.bottom + 4, width });
    };
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open]);

  if (availableOptions.length === 0) return null;
  const buttonLabel = selected.length === 0
    ? allLabel
    : selected.length <= 2
      ? selected.join('、')
      : `已选${selected.length}项`;
  const toggle = (option) => {
    const next = selected.includes(option)
      ? selected.filter((item) => item !== option)
      : [...selected, option];
    onChange(next);
  };

  return (
    <div className="multi-filter" ref={rootRef}>
      <span className="multi-filter-label">{label}</span>
      <button ref={buttonRef} type="button" className="multi-filter-button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span>{buttonLabel}</span>
        <b aria-hidden="true">⌄</b>
      </button>
      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          className="multi-filter-menu"
          style={{ position: 'fixed', zIndex: 10000, ...menuPosition }}
        >
          <label className="multi-filter-option">
            <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
            <span>{allLabel}</span>
          </label>
          {availableOptions.map((option) => (
            <label key={option} className="multi-filter-option">
              <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
              <span>{option}</span>
            </label>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function MonthCalendarFilter({ label, value = [], options = [], onChange, multiple = true, showWhenEmpty = false }) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const availableOptions = useMemo(() => [...new Set(options.filter(Boolean))], [options]);
  const selected = multiple ? (Array.isArray(value) ? value : []) : (value ? [value] : []);
  const yearSource = selected[0] || availableOptions[0] || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const [calendarYear, setCalendarYear] = useState(Number(yearSource.slice(0, 4)) || new Date().getFullYear());
  const optionSet = useMemo(() => new Set(availableOptions), [availableOptions]);
  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (
        rootRef.current
        && !rootRef.current.contains(event.target)
        && !menuRef.current?.contains(event.target)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!open || !buttonRef.current) {
      setMenuPosition(null);
      return undefined;
    }
    const updateMenuPosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 300;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setMenuPosition({ left, top: rect.bottom + 4, width });
    };
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (selected[0]) setCalendarYear(Number(selected[0].slice(0, 4)) || calendarYear);
  }, [selected[0]]);

  const updateSelected = (next) => {
    const normalized = [...new Set(next.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    onChange(multiple ? normalized : (normalized[0] || ''));
  };
  const toggleMonth = (month) => {
    if (!multiple) {
      updateSelected(selected.includes(month) ? [] : [month]);
      setOpen(false);
      return;
    }
    updateSelected(selected.includes(month) ? selected.filter((item) => item !== month) : [...selected, month]);
  };
  const buttonText = selected.length === 0
    ? '全部'
    : selected.length <= 2
      ? selected.map((month) => `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`).join('、')
      : `已选${selected.length}项`;
  const monthKeys = monthNames.map((_, index) => `${calendarYear}-${String(index + 1).padStart(2, '0')}`);
  const visibleMonths = monthKeys
    .map((month, index) => ({ month, label: monthNames[index] }))
    .filter(({ month }) => optionSet.has(month));

  if (availableOptions.length === 0 && !showWhenEmpty) return null;

  return (
    <div className="filter-control month-calendar-filter" ref={rootRef}>
      <span>{label}</span>
      <button
        ref={buttonRef}
        type="button"
        className="filter-button"
        disabled={availableOptions.length === 0}
        onClick={() => setOpen(!open)}
        title={availableOptions.length === 0 ? '暂无原下单月份数据' : buttonText}
      >{buttonText}</button>
      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          className="filter-menu month-calendar-menu"
          style={{ position: 'fixed', zIndex: 10000, ...menuPosition }}
        >
          <div className="month-calendar-head">
            <button type="button" onClick={() => setCalendarYear(calendarYear - 1)}>‹</button>
            <strong>{calendarYear}年</strong>
            <button type="button" onClick={() => setCalendarYear(calendarYear + 1)}>›</button>
          </div>
          <div className="month-calendar-grid">
            {visibleMonths.map(({ month, label: monthLabel }) => {
              const isSelected = selected.includes(month);
              return (
                <button
                  type="button"
                  key={month}
                  className={`month-calendar-cell ${isSelected ? 'selected' : ''} has-data`}
                  onClick={() => toggleMonth(month)}
                >
                  <strong>{monthLabel}</strong>
                  <span>有数据</span>
                </button>
              );
            })}
          </div>
          <div className="month-calendar-actions">
            <button type="button" onClick={() => updateSelected([])}>全部月份</button>
            <button type="button" onClick={() => setOpen(false)}>确定</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function FieldMapping({ fields, columns, mapping, onChange, requiredFields = [], manual = false, note = '', confirmed = false, onConfirm = () => {} }) {
  const required = new Set(requiredFields);
  const usedColumns = new Set(Object.values(mapping || {}).filter(Boolean));
  const mappedCount = fields.filter(([key]) => mapping[key]).length;
  const requiredMappedCount = requiredFields.filter((key) => mapping[key]).length;
  return (
    <div className="mapping-grid">
      {manual && <p className="mapping-grid-note">{note || '请核对标记为必选的字段；其他未选择字段按空值保存。'}</p>}
      <p className="mapping-grid-summary">已映射 {mappedCount}/{fields.length}{requiredFields.length ? `，必选 ${requiredMappedCount}/${requiredFields.length}` : ''}</p>
      {fields.map(([key, label, description]) => (
        <label key={key}>
          <span>{label}{required.has(key) ? '（必选）' : ''}</span>
          {description && <small>{description}</small>}
          <select value={mapping[key] || ''} onChange={(event) => onChange({ ...mapping, [key]: event.target.value })}>
            <option value="">请选择字段</option>
            {columns.map((column) => <option key={column} value={column} disabled={usedColumns.has(column) && mapping[key] !== column}>{column}{usedColumns.has(column) && mapping[key] !== column ? '（已用）' : ''}</option>)}
          </select>
        </label>
      ))}
      {manual && (
        <label className="mapping-confirmation">
          <input type="checkbox" checked={confirmed} onChange={(event) => onConfirm(event.target.checked)} />
          <span>我已核对字段含义和映射关系</span>
        </label>
      )}
    </div>
  );
}

function isInventoryMappingSlot(slotId) {
  return /^inventory(?:Summary|Manual)File\d+$/.test(normalize(slotId));
}

function hasMappedInventoryFields(mapping = {}, fields = []) {
  return fields.some(([key]) => normalize(mapping?.[key]));
}

function clearInvalidFilterValues(filters, optionMap) {
  const next = { ...filters };
  let changed = false;
  Object.entries(optionMap).forEach(([key, options]) => {
    const available = new Set(options || []);
    if (Array.isArray(next[key])) {
      const filteredValues = next[key].filter((value) => available.has(value));
      if (filteredValues.length !== next[key].length) {
        next[key] = filteredValues;
        changed = true;
      }
      return;
    }
    if (next[key] && !available.has(next[key])) {
      next[key] = '';
      changed = true;
    }
  });
  return changed ? next : null;
}

function watermarkTime(value = new Date()) {
  const pad = (number) => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function SecurityWatermark({ userName }) {
  const [time, setTime] = useState(watermarkTime);

  useEffect(() => {
    const timer = window.setInterval(() => setTime(watermarkTime()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const text = `采购跟单&头程数据 · ${normalize(userName) || '已登录用户'} · ${time}`;
  return (
    <div className="security-watermark" aria-hidden="true">
      {Array.from({ length: 120 }, (_, index) => <span key={index}>{text}</span>)}
    </div>
  );
}


function AppliedTimeNote({ label = '采购订单列表应用时间', value = '' }) {
  return <div className="dashboard-applied-note">{label}：{value || '暂无'}</div>;
}

function SourceApplicationsNote({ sources = [] }) {
  const text = sources.length
    ? sources.map((source) => `${source.label}${source.fileName ? `（${source.fileName}）` : ''}${source.requiresReupload ? '【需按最新口径重新上传】' : ''}：${source.appliedAt || '暂无'}`).join('；')
    : '暂无';
  return <div className="dashboard-applied-note">文件应用时间：{text}</div>;
}

const CROSS_BORDER_FILTER_DEFAULTS = {
  inventoryType: '', sku: '', marketplace: '', warehouseName: '', kingdeeWarehouse: '',
  businessUnit: '', level1WarehouseCategory: '', level2WarehouseCategory: '', productLine: '',
  productSeries: '', stockStatus: '有库存', mappingStatus: '', keyword: ''
};







const PROGRESS_COLUMNS = [
  ['purchaseOwner', '采购下单人'], ['orderType', '订单类型'], ['reportingMonth', '下单月份'], ['month', '当前订单月份'],
  ['orderNo', '当前采购订单号'], ['currentOrderDate', '当前订单创建日期'], ['currentPurchaseQty', '当前订单采购数量'],
  ['originalOrderNo', '原采购订单号'], ['originalOrderDate', '原订单创建日期'], ['originalPurchaseQty', '原订单采购数量'],
  ['changeValidationStatus', '变更校验'], ['orderCreator', '创建人'],
  ['dataStatus', '数据状态'],
  ['documentStatus', '单据状态'], ['purchaseOrg', '采购组织'], ['supplier', '供应商'], ['supplierShortName', '供应商简称'],
  ['businessUnit', '事业部'], ['operatorName', '运营'], ['productLine', '产品线'], ['productSeries', '系列'], ['materialCode', '物料编码'],
  ['sku', 'SKU'], ['materialName', '物料名称'], ['operationStockQty', '运营备货数量'], ['remainingInboundQty', '未交付数量'],
  ['shippedQty', '已发货数量'], ['unpreparedQty', '未备料未生产'], ['preparedNotStartedQty', '已备料未生产'],
  ['inProductionQty', '生产中产品'], ['finishedQty', '完工未发产品'], ['contractDeliveryDates', '合同约定交期'],
  ['productionDeliveryDate', '生产中交付时间'], ['unproducedEstimatedDeliveryDate', '未生产预计交付时间'],
  ['fulfillmentStatus', '是否正常履约'], ['fulfillmentRemark', '跟单备注'], ['pretaxPrice', '不含税采购价'], ['normalFulfillmentQty', '正常履约数量'],
  ['normalFulfillmentAmount', '正常履约金额'], ['abnormalFulfillmentQty', '非正常履约数量'],
  ['abnormalFulfillmentAmount', '非正常履约金额'], ['unfulfilledReason', '未履约原因'], ['reasonDetail', '原因详情'],
  ['remark', '备注'], ['oaFlowNo', 'OA备货流程号'], ['sourceRows', '源行明细'], ['validationStatus', '状态校验'], ['action', '操作']
];

const PROGRESS_DEFAULT_COLUMNS = [
  'documentStatus', 'supplierShortName', 'businessUnit', 'operatorName', 'productLine', 'materialCode', 'sku',
  'operationStockQty', 'remainingInboundQty', 'shippedQty', 'unpreparedQty', 'preparedNotStartedQty',
  'inProductionQty', 'finishedQty', 'contractDeliveryDates', 'productionDeliveryDate',
  'unproducedEstimatedDeliveryDate', 'fulfillmentStatus', 'fulfillmentRemark', 'remark', 'oaFlowNo', 'action'
];

const PROGRESS_STICKY_COLUMN_KEYS = new Set([
  '__select', 'documentStatus', 'supplierShortName', 'businessUnit', 'operatorName', 'productLine', 'materialCode', 'sku',
  'operationStockQty', 'remainingInboundQty', 'shippedQty'
]);

function DimensionLibrary({ token, reloadDemands, reloadDemandData = true, setMessage, title = '维度表库', slots = DIMENSION_SLOTS, gridColumns = 2, onDataApplied = () => {}, highlightSlotId = '' }) {
  const [records, setRecords] = useState([]);
  const [local, setLocal] = useState({});
  const [issuePage, setIssuePage] = useState(1);
  const mappingPresetsRef = useRef({});
  const isFirstMileLibrary = slots.some((slot) => slot.firstMile);
  const issuePageSize = 20;
  const issueRows = useMemo(() => records.flatMap((record) => {
    const summary = record.mapping?.__firstMileSummary;
    if (!summary || !slots.some((slot) => slot.id === record.slot_id && slot.firstMile)) return [];
    return (summary.issues || []).map((issue, index) => ({
      id: `${record.slot_id}-${issue.sourceSheet || ''}-${issue.sourceExcelRow || ''}-${index}`,
      owner: summary.owner || '',
      fileName: record.file_name || '',
      ...issue
    }));
  }), [records, slots]);
  const issueTotalPages = Math.max(1, Math.ceil(issueRows.length / issuePageSize));
  const currentIssuePage = Math.min(issuePage, issueTotalPages);
  const pagedIssueRows = issueRows.slice((currentIssuePage - 1) * issuePageSize, currentIssuePage * issuePageSize);

  function setSlotState(slotId, patch) {
    setLocal((prev) => ({ ...prev, [slotId]: { ...(prev[slotId] || {}), ...patch } }));
  }

  async function load() {
    const payload = await request('/api/dimensions', { token });
    const rows = payload.rows || [];
    setRecords(rows);
    mappingPresetsRef.current = Object.fromEntries(
      rows
        .filter((row) => isInventoryMappingSlot(row.slot_id))
        .map((row) => [row.slot_id, row.mapping || {}])
    );
  }

  function persistInventoryMapping(slot, mapping) {
    if (!isInventoryMappingSlot(slot.id)) return;
    mappingPresetsRef.current = { ...mappingPresetsRef.current, [slot.id]: mapping };
  }

  useEffect(() => { load().catch(() => {}); }, []);
  useEffect(() => {
    if (issuePage > issueTotalPages) setIssuePage(issueTotalPages);
  }, [issuePage, issueTotalPages]);
  useEffect(() => {
    if (!highlightSlotId) return;
    window.setTimeout(() => document.getElementById(`dimension-slot-${highlightSlotId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }, [highlightSlotId]);

  async function inspect(slot, file) {
    setSlotState(slot.id, {
      file,
      columns: [],
      sheetNames: [],
      selectedSheetNames: [],
      sheetPreviews: [],
      progress: 12,
      statusText: '正在读取文件...',
      statusType: 'active',
      busy: 'inspect'
    });
    try {
      const data = new FormData();
      data.append('file', file);
      data.append('slotId', slot.id);
      const payload = await request('/api/workbook/inspect', { token, method: 'POST', body: data });
      const record = records.find((item) => item.slot_id === slot.id);
      const columns = payload.columns || [];
      const inspectRowCount = payload.rowCount == null ? null : Number(payload.rowCount || 0);
      const productProjectSummary = payload.parseSummary?.parserType === 'productProject' ? payload.parseSummary : null;
      const requiresSheetSelection = Boolean(slot.requiresSheetSelection && (payload.sheetNames?.length || 0) > 1);
      const requiresMultipleSheets = Number(slot.requiredSheetCount || 0) > 0;
      setLocal((prev) => {
        const prevState = prev[slot.id] || {};
        const savedMapping = [
          prevState.mapping,
          prevState.savedMapping,
          mappingPresetsRef.current[slot.id],
          record?.mapping
        ].find((candidate) => hasMappedInventoryFields(candidate, slot.fields || [])) || {};
        const hasSavedMapping = hasMappedInventoryFields(savedMapping, slot.fields || []);
        const sheetMappings = { ...(prevState.sheetMappings || {}) };
        const mapping = validMappingForColumns(
          sheetMappings[''] || savedMapping,
          columns,
          slot.fields,
          Boolean(slot.autoMap) || (!slot.manualFieldSelection && !hasSavedMapping)
        );
        if (record?.sheetName) {
          const recordSheet = (payload.sheetPreviews || []).find((item) => item.sheetName === record.sheetName);
          sheetMappings[record.sheetName] = validMappingForColumns(
            record.mapping || {},
            recordSheet?.columns || columns,
            slot.fields,
            false
          );
        }
        return {
          ...prev,
          [slot.id]: {
            ...prevState,
            file,
            columns,
            sheetNames: payload.sheetNames || [],
            selectedSheetNames: [],
            sheetPreviews: payload.sheetPreviews || [],
            savedMapping,
            sheetMappings: { ...sheetMappings, '': mapping },
            mapping,
            mappingConfirmed: false,
            sheetName: '',
            inspectRowCount,
            progress: columns.length ? 100 : 70,
            statusText: requiresMultipleSheets
              ? `检测到 ${payload.sheetNames?.length || 0} 个工作表，请选择 ${slot.requiredSheetCount} 个工作表应用`
              : requiresSheetSelection
              ? `检测到 ${payload.sheetNames.length} 个工作表，请先选择要使用的工作表`
              : productProjectSummary
              ? `已识别重点工作表“${productProjectSummary.primarySheet}”，共 ${productProjectSummary.validRows || 0} 个产品项目`
              : columns.length
              ? slot.firstMile || slot.fullInventory
                ? `解析完成：识别 ${payload.recognizedSheets || payload.sheetNames?.length || 1} 个业务工作表，共 ${inspectRowCount} 行`
                : `解析完成：识别 ${payload.sheetNames?.length || 1} 个工作表，共 ${inspectRowCount} 行，请检查字段映射`
              : '未识别到表头，请检查前10行是否包含字段名',
            statusType: columns.length && !requiresSheetSelection && !requiresMultipleSheets ? 'success' : 'warning',
            busy: ''
          }
        };
      });
      if (!columns.length) {
        setMessage(`${slot.title} 未识别到表头，请检查前10行是否包含字段名`);
      } else if (requiresMultipleSheets) {
        setMessage(`${slot.title} 检测到 ${payload.sheetNames?.length || 0} 个工作表，请选择 ${slot.requiredSheetCount} 个工作表应用`);
      } else if (requiresSheetSelection) {
        setMessage(`${slot.title} 检测到多个工作表，请先选择要使用的工作表`);
      } else {
        setMessage(productProjectSummary
          ? `${slot.title} 已自动识别重点工作表“${productProjectSummary.primarySheet}”，将解析 ${productProjectSummary.validRows || 0} 个产品项目`
          : slot.firstMile || slot.fullInventory
          ? `${slot.title} 解析完成，将自动读取全部业务工作表`
          : `${slot.title} 解析完成，请检查字段映射后上传保存`);
      }
    } catch (err) {
      setSlotState(slot.id, {
        progress: 100,
        statusText: `文件解析失败：${err.message}`,
        statusType: 'error',
        busy: ''
      });
      setMessage(`${slot.title} 文件解析失败：${err.message}`);
    }
  }

  async function selectSheet(slot, sheetName) {
    const state = local[slot.id] || {};
    const sheet = state.sheetPreviews?.find((s) => s.sheetName === sheetName);
    const nextColumns = sheetName ? (sheet?.columns || []) : (state.sheetPreviews?.[0]?.columns || state.columns || []);
    const currentKey = state.sheetName || '';
    const nextKey = sheetName || '';
    const sheetMappings = { ...(state.sheetMappings || {}), [currentKey]: state.mapping || {} };
    const savedMapping = [
      sheetMappings[nextKey],
      state.mapping,
      state.savedMapping,
      mappingPresetsRef.current[slot.id]
    ].find((candidate) => hasMappedInventoryFields(candidate, slot.fields || [])) || {};
    const hasSavedMapping = hasMappedInventoryFields(savedMapping, slot.fields || []);
    const mapping = validMappingForColumns(
      savedMapping,
      nextColumns,
      slot.fields,
      Boolean(slot.autoMap) || (!slot.manualFieldSelection && !hasSavedMapping)
    );
    const inspectRowCount = sheetName
      ? (sheet?.rowCount == null ? null : Number(sheet.rowCount || 0))
      : (state.sheetPreviews || []).every((item) => item.rowCount != null)
        ? (state.sheetPreviews || []).reduce((sum, item) => sum + Number(item.rowCount || 0), 0)
        : null;
    const requiresSheetSelection = Boolean(slot.requiresSheetSelection && (state.sheetNames?.length || 0) > 1);
    setSlotState(slot.id, {
      sheetName,
      columns: nextColumns,
      sheetMappings,
      mapping,
      mappingConfirmed: false,
      inspectRowCount,
      progress: 100,
      statusText: sheetName
        ? `已选择工作表：${sheetName}${inspectRowCount == null ? '' : `，共 ${inspectRowCount} 行`}`
        : requiresSheetSelection
          ? '请选择要使用的工作表'
          : `已切换到全部工作表，共 ${inspectRowCount} 行`,
      statusType: sheetName || !requiresSheetSelection ? 'success' : 'warning'
    });
  }

  function toggleSelectedSheet(slot, sheetName) {
    const state = local[slot.id] || {};
    const selected = state.selectedSheetNames || [];
    const nextSelected = selected.includes(sheetName)
      ? selected.filter((name) => name !== sheetName)
      : selected.length < slot.requiredSheetCount
        ? [...selected, sheetName]
        : selected;
    const selectedPreviews = (state.sheetPreviews || []).filter((sheet) => nextSelected.includes(sheet.sheetName));
    const selectedRows = selectedPreviews.every((sheet) => sheet.rowCount != null)
      ? selectedPreviews.reduce((sum, sheet) => sum + Number(sheet.rowCount || 0), 0)
      : null;
    const complete = nextSelected.length === slot.requiredSheetCount;
    setSlotState(slot.id, {
      selectedSheetNames: nextSelected,
      inspectRowCount: selectedRows,
      progress: complete ? 100 : 80,
      statusText: complete
        ? `已选择：${nextSelected.join('、')}${selectedRows == null ? '' : `，共 ${selectedRows} 行`}`
        : `已选择 ${nextSelected.length}/${slot.requiredSheetCount} 个工作表`,
      statusType: complete ? 'success' : 'warning'
    });
  }

  async function uploadSlot(slot) {
    const state = local[slot.id];
    if (!state?.file) {
      setMessage(`${slot.title} 请先选择文件`);
      return;
    }
    if (slot.requiresSheetSelection && (state.sheetNames?.length || 0) > 1 && !state.sheetName) {
      setSlotState(slot.id, {
        progress: 100,
        statusText: '检测到多个工作表，请先选择要使用的工作表',
        statusType: 'warning',
        busy: ''
      });
      setMessage(`${slot.title} 检测到多个工作表，请先选择要使用的工作表`);
      return;
    }
    if (slot.requiredSheetCount && (state.selectedSheetNames?.length || 0) !== slot.requiredSheetCount) {
      setSlotState(slot.id, {
        progress: 100,
        statusText: `请选择 ${slot.requiredSheetCount} 个工作表后再上传保存`,
        statusType: 'warning',
        busy: ''
      });
      setMessage(`${slot.title} 必须选择 ${slot.requiredSheetCount} 个工作表`);
      return;
    }
    if (slot.manualFieldSelection) {
      const labels = new Map(slot.fields || []);
      const missingFields = (slot.requiredFields || []).filter((field) => !state.mapping?.[field]);
      if (missingFields.length) {
        const missingLabels = missingFields.map((field) => labels.get(field) || field).join('、');
        setSlotState(slot.id, {
          progress: 100,
          statusText: `请选择必选字段：${missingLabels}`,
          statusType: 'warning',
          busy: ''
        });
        setMessage(`${slot.title} 请选择必选字段：${missingLabels}`);
        return;
      }
      const duplicateColumns = duplicateMappingColumns(state.mapping, slot.fields || []);
      if (duplicateColumns.length) {
        const duplicateText = duplicateColumns.map(({ column, targets }) => `${column}→${targets.join('、')}`).join('；');
        setSlotState(slot.id, {
          progress: 100,
          statusText: `同一源列不能重复映射：${duplicateText}`,
          statusType: 'warning',
          busy: ''
        });
        setMessage(`${slot.title} 存在重复字段映射，请修正后上传`);
        return;
      }
      if (slot.requireMappingConfirmation && !state.mappingConfirmed) {
        setSlotState(slot.id, {
          progress: 100,
          statusText: '请勾选“我已核对字段含义和映射关系”',
          statusType: 'warning',
          busy: ''
        });
        setMessage(`${slot.title} 请先确认字段映射`);
        return;
      }
    }
    setSlotState(slot.id, {
      progress: 35,
      statusText: '正在上传保存...',
      statusType: 'active',
      busy: 'upload'
    });
    try {
      const data = new FormData();
      data.append('file', state.file);
      data.append('mapping', JSON.stringify(state.mapping || {}));
      if (state.sheetName) data.append('sheetName', state.sheetName);
      if (slot.requiredSheetCount) data.append('sheetNames', JSON.stringify(state.selectedSheetNames || []));
      const payload = await request(`/api/dimensions/${slot.id}/upload`, { token, method: 'POST', body: data });
      persistInventoryMapping(slot, state.mapping || {});
      const parseSummary = payload.parseSummary;
      const productProjectSummary = parseSummary?.parserType === 'productProject' ? parseSummary : null;
      const inventoryParseSummary = parseSummary?.parserType === 'inventorySummary' ? parseSummary : null;
      const manualParseSummary = parseSummary?.parserType === 'inventoryManual' ? parseSummary : null;
      const jdParseSummaryText = inventoryParseSummary?.jdFormat
        ? `，识别格式 ${inventoryParseSummary.jdFormat}，区域行过滤 ${inventoryParseSummary.filteredJdRegionalRows || 0} 行，有效库存 ${numberValue(inventoryParseSummary.jdScopeQuantity).toLocaleString(undefined, { maximumFractionDigits: 1 })}`
        : '';
      const uploadSummaryText = productProjectSummary
        ? `上传保存完成：重点工作表 ${productProjectSummary.primarySheet}，有效项目 ${payload.rowCount} 个`
        : inventoryParseSummary
        ? `上传保存完成：源数据 ${inventoryParseSummary.sourceRowCount || 0} 行，有效保存 ${payload.rowCount} 行${jdParseSummaryText}`
        : manualParseSummary
          ? `上传保存完成：源数据 ${manualParseSummary.sourceRowCount || 0} 行，有效保存 ${payload.rowCount} 行`
        : parseSummary
          ? `上传保存完成：${payload.rowCount} 行，${parseSummary.issueRows || 0} 行异常`
          : `上传保存完成：${payload.rowCount} 行`;
      const appliedSummaryText = productProjectSummary
        ? `${slot.title} 已从重点工作表“${productProjectSummary.primarySheet}”解析并应用 ${payload.rowCount} 个产品项目。`
        : inventoryParseSummary
        ? `${slot.title} 已自动解析并应用 ${payload.rowCount} 行；源数据 ${inventoryParseSummary.sourceRowCount || 0} 行，零数量过滤 ${inventoryParseSummary.filteredZeroQtyRows || 0} 行，汇总行过滤 ${inventoryParseSummary.filteredSummaryRows || 0} 行${jdParseSummaryText}。`
        : manualParseSummary
          ? `${slot.title} 已按手工映射解析并应用 ${payload.rowCount} 行。`
        : parseSummary
          ? `${slot.title} 已自动解析并应用 ${payload.rowCount} 行，异常 ${parseSummary.issueRows || 0} 行。`
          : slot.requiresSheetSelection && payload.sheetName
            ? `${slot.title} 已上传并应用工作表“${payload.sheetName}”，共 ${payload.rowCount} 行。`
            : `${slot.title} 已上传 ${payload.rowCount} 行，并已自动应用刷新。`;
      setSlotState(slot.id, {
        progress: 78,
        statusText: `${uploadSummaryText}，正在应用刷新...`,
        statusType: 'active',
        busy: 'apply'
      });
      setMessage(appliedSummaryText);
      await load();
      if (reloadDemandData) await reloadDemands();
      onDataApplied(slot.id);
      setSlotState(slot.id, {
        progress: 100,
        statusText: `已应用刷新：${payload.rowCount} 行`,
        statusType: 'success',
        busy: ''
      });
    } catch (err) {
      setSlotState(slot.id, {
        progress: 100,
        statusText: `上传失败：${err.message}`,
        statusType: 'error',
        busy: ''
      });
      setMessage(`${slot.title} 上传失败：${err.message}`);
    }
  }

  async function applySlot(slot) {
    setSlotState(slot.id, {
      progress: 50,
      statusText: '正在应用刷新...',
      statusType: 'active',
      busy: 'apply'
    });
    try {
      await request(`/api/dimensions/${slot.id}/apply`, { token, method: 'POST' });
      setMessage(`${slot.title} 已应用。`);
      await load();
      if (reloadDemandData) await reloadDemands();
      onDataApplied(slot.id);
      setSlotState(slot.id, {
        progress: 100,
        statusText: '应用刷新完成',
        statusType: 'success',
        busy: ''
      });
    } catch (err) {
      setSlotState(slot.id, {
        progress: 100,
        statusText: `应用失败：${err.message}`,
        statusType: 'error',
        busy: ''
      });
      setMessage(`${slot.title} 应用失败：${err.message}`);
    }
  }

  async function downloadSlot(slot, record) {
    setSlotState(slot.id, {
      progress: 45,
      statusText: '正在准备下载...',
      statusType: 'active',
      busy: 'download'
    });
    try {
      const response = await fetch(`${API}/api/dimensions/${encodeURIComponent(slot.id)}/download`, {
        headers: authHeaders(token)
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `下载失败（${response.status}）`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = record?.file_name || `${slot.title}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
      setSlotState(slot.id, {
        progress: 100,
        statusText: '文件下载已开始',
        statusType: 'success',
        busy: ''
      });
      setMessage(`${slot.title} 原文件下载已开始。`);
    } catch (err) {
      setSlotState(slot.id, {
        progress: 100,
        statusText: `下载失败：${err.message}`,
        statusType: 'error',
        busy: ''
      });
      setMessage(`${slot.title} 下载失败：${err.message}`);
    }
  }

  async function deleteSlot(slot) {
    setSlotState(slot.id, {
      progress: 40,
      statusText: '正在删除...',
      statusType: 'active',
      busy: 'delete'
    });
    try {
      await request(`/api/dimensions/${slot.id}`, { token, method: 'DELETE' });
      await load();
      onDataApplied(slot.id);
      setSlotState(slot.id, {
        file: null,
        columns: [],
        sheetNames: [],
        selectedSheetNames: [],
        sheetPreviews: [],
        mapping: {},
        sheetName: '',
        progress: 100,
        statusText: '已删除',
        statusType: 'success',
        busy: ''
      });
    } catch (err) {
      setSlotState(slot.id, {
        progress: 100,
        statusText: `删除失败：${err.message}`,
        statusType: 'error',
        busy: ''
      });
      setMessage(`${slot.title} 删除失败：${err.message}`);
    }
  }

  function diagnosticsText(slotId, diagnostics) {
    if (!diagnostics) return '';
    if (slotId === 'purchaseAssignment') {
      return `诊断：有采购下单人 ${diagnostics.ownerRows || 0} 行，供应商+物料编码 ${diagnostics.keyRows || 0} 行`;
    }
    if (slotId === 'productCategory') {
      return `诊断：物料编码 ${diagnostics.keyRows || 0} 个`;
    }
    return '';
  }

  return (
    <>
      <div className="section-heading-row"><h2>{title}</h2><span className="section-count">{slots.length} 个槽位，字段映射后应用</span></div>
      <section className={`library-grid ${gridColumns === 3 ? 'library-grid-three' : ''} ${gridColumns === 4 ? 'library-grid-four' : ''}`}>
        {slots.map((slot, index) => {
          const record = records.find((item) => item.slot_id === slot.id);
          const state = local[slot.id] || {};
          const busy = Boolean(state.busy);
          const hasSheets = !slot.firstMile && !slot.fullInventory && !slot.productProjectWorkbook && (state.sheetNames?.length || record?.sheetNames?.length || 0) > 1;
          const sheetNames = state.sheetNames?.length ? state.sheetNames : (record?.sheetNames || []);
          const currentSheet = state.file ? (state.sheetName || '') : (state.sheetName || record?.sheetName || '');
          const selectedSheetNames = state.file
            ? (state.selectedSheetNames || [])
            : (state.selectedSheetNames?.length ? state.selectedSheetNames : (record?.selectedSheetNames || []));
          return (
            <article id={`dimension-slot-${slot.id}`} key={slot.id} className={`library-slot ${highlightSlotId === slot.id ? 'highlighted' : ''}`}>
              <div className="slot-head">
                <div><span className="slot-kicker">槽位 {index + 1}</span><h3>{slot.title}</h3></div>
                <span className={`slot-state ${record?.applied ? 'applied' : record ? 'pending' : ''}`}>{record?.applied ? '已应用' : record ? '待应用' : '缺失'}</span>
              </div>
              <label className="drop-zone">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  disabled={busy}
                  onClick={(event) => { event.currentTarget.value = ''; }}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) inspect(slot, file);
                  }}
                />
                <strong>{state.file?.name || record?.file_name || '上传维度表'}</strong>
                <span>{busy ? '处理中，请稍候' : '点击选择 Excel / CSV'}</span>
              </label>
              {state.statusText && (
                <div className={`slot-progress ${state.statusType || ''}`}>
                  <div className="slot-progress-meta">
                    <span>{state.statusText}</span>
                    <strong>{Math.min(100, Math.max(0, Math.round(state.progress || 0)))}%</strong>
                  </div>
                  <div className="slot-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(100, Math.max(0, Math.round(state.progress || 0)))}>
                    <span style={{ width: `${Math.min(100, Math.max(0, Math.round(state.progress || 0)))}%` }} />
                  </div>
                </div>
              )}
              {hasSheets && (
                slot.requiredSheetCount ? (
                  <fieldset className="sheet-multi-selector" disabled={busy || !state.file}>
                    <legend>选择 {slot.requiredSheetCount} 个工作表 <span>{selectedSheetNames.length}/{slot.requiredSheetCount}</span></legend>
                    <div>
                      {sheetNames.map((name) => (
                        <label key={name}>
                          <input
                            type="checkbox"
                            checked={selectedSheetNames.includes(name)}
                            disabled={busy || (!selectedSheetNames.includes(name) && selectedSheetNames.length >= slot.requiredSheetCount)}
                            onChange={() => toggleSelectedSheet(slot, name)}
                          />
                          <span title={name}>{name}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : (
                <div className="sheet-selector">
                  <label>{slot.requiresSheetSelection ? '选择应用的工作表' : '选择工作表'}
                    <select value={currentSheet} disabled={busy} onChange={(e) => selectSheet(slot, e.target.value)}>
                      <option value="">{slot.requiresSheetSelection ? '请选择工作表' : '全部工作表'}</option>
                      {sheetNames.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </label>
                </div>
                )
              )}
              {!slot.productProjectWorkbook && state.columns?.length > 0 && slot.fields.length > 0 && (
                <FieldMapping
                  fields={slot.fields}
                  columns={state.columns}
                  mapping={state.mapping || {}}
                  requiredFields={slot.manualFieldSelection ? (slot.requiredFields || []) : []}
                  manual={Boolean(slot.manualFieldSelection)}
                  note={slot.mappingNote || ''}
                  confirmed={Boolean(state.mappingConfirmed)}
                  onConfirm={(mappingConfirmed) => setSlotState(slot.id, { mappingConfirmed })}
                  onChange={(mapping) => {
                    const nextMapping = validMappingForColumns(mapping, state.columns, slot.fields, false);
                    const sheetKey = state.sheetName || '';
                    setLocal((prev) => ({
                      ...prev,
                      [slot.id]: {
                        ...(prev[slot.id] || {}),
                        mapping: nextMapping,
                        mappingConfirmed: false,
                        savedMapping: nextMapping,
                        sheetMappings: { ...(prev[slot.id]?.sheetMappings || {}), [sheetKey]: nextMapping }
                      }
                    }));
                    persistInventoryMapping(slot, nextMapping);
                  }}
                />
              )}
              <div className="slot-info">
                {slot.mappingNote && !state.file && <span className="slot-mapping-note">{slot.mappingNote}</span>}
                {record && <span>文件：{record.file_name}</span>}
                {record && slot.fields.length > 0 && (
                  <span className={hasMappedInventoryFields(record.mapping, slot.fields) ? 'slot-mapping-saved' : 'slot-mapping-pending'}>
                    {hasMappedInventoryFields(record.mapping, slot.fields)
                      ? `已确认映射：${slot.fields.filter(([key]) => record.mapping?.[key]).length}/${slot.fields.length} 个字段`
                      : '旧文件尚未确认字段映射，重新上传时需核对'}
                  </span>
                )}
                {hasSheets && <span>工作表：{sheetNames.join('、')}</span>}
                {record?.sheet_name && <span>已应用工作表：{record.sheet_name}</span>}
                {record?.selectedSheetNames?.length > 0 && <span>已应用工作表：{record.selectedSheetNames.join('、')}</span>}
                {state.file && state.inspectRowCount != null && <span>本次解析行数：{state.inspectRowCount}</span>}
                {record && <span>已保存行数：{record.rowCount}</span>}
                {record?.diagnostics && diagnosticsText(slot.id, record.diagnostics) && <span>{diagnosticsText(slot.id, record.diagnostics)}</span>}
                {slot.firstMile && record?.mapping?.__firstMileSummary && (
                  <span>
                    业务工作表：{record.mapping.__firstMileSummary.recognizedSheets?.length || 0}，
                    有效 {record.mapping.__firstMileSummary.validRows || 0} 行，
                    异常 {record.mapping.__firstMileSummary.issueRows || 0} 行
                  </span>
                )}
                {slot.firstMile && record && !record.hasOriginalFile && (
                  <span className="issue-reason">当前文件在下载功能上线前上传，请重新上传一次后下载原文件。</span>
                )}
                {record?.mapping?.__productProject && (
                  <span>
                    重点工作表：{record.mapping.__productProject.primarySheet}，
                    有效项目 {record.mapping.__productProject.validRows || record.rowCount || 0} 个，
                    跳过 {record.mapping.__productProject.skippedRows || 0} 行
                  </span>
                )}
                {record?.mapping?.__inventorySummary && (
                  <span>
                    解析：源数据 {record.mapping.__inventorySummary.sourceRowCount ?? record.rowCount} 行，
                    有效保存 {record.mapping.__inventorySummary.rowCount ?? record.rowCount} 行，
                    零数量过滤 {record.mapping.__inventorySummary.filteredZeroQtyRows || 0} 行，
                    汇总行过滤 {record.mapping.__inventorySummary.filteredSummaryRows || 0} 行
                  </span>
                )}
                {record?.mapping?.__inventoryManual && (
                  <span>
                    手工解析：源数据 {record.mapping.__inventoryManual.sourceRowCount ?? record.rowCount} 行，
                    有效保存 {record.mapping.__inventoryManual.rowCount ?? record.rowCount} 行
                  </span>
                )}
                {slot.id === 'inventorySummaryFile7' && record?.mapping?.__inventorySummary && (
                  <span>
                    京东口径：{record.mapping.__inventorySummary.jdFormat || '旧版全国现货库存列'}，
                    区域行过滤 {record.mapping.__inventorySummary.filteredJdRegionalRows || 0} 行，
                    全国范围 {record.mapping.__inventorySummary.jdScopeRows || 0} 行，
                    有效库存 {numberValue(record.mapping.__inventorySummary.jdScopeQuantity).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </span>
                )}
                {slot.id === 'inventorySummaryFile1' && record?.mapping?.__inventorySummary && (
                  <span>
                    FBA完整性：库存属性=全部 {record.mapping.__inventorySummary.fbaScopeRows || 0} 行，
                    数量 {numberValue(record.mapping.__inventorySummary.fbaScopeQuantity).toLocaleString(undefined, { maximumFractionDigits: 1 })}；
                    源SKU空值 {record.mapping.__inventorySummary.fbaBlankSkuRows || 0} 行，
                    对应数量 {numberValue(record.mapping.__inventorySummary.fbaBlankSkuQuantity).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </span>
                )}
                {slot.id === 'inventorySummaryFile1' && record && numberValue(record.mapping?.__inventorySummary?.parserVersion) < 3 && (
                  <span className="issue-reason">当前文件仍是旧数量口径，请重新上传原始FBA库存报表，系统将按“期末库存(含移仓)-数量”重新解析。</span>
                )}
                {record && <span>更新：{record.updated_at}</span>}
              </div>
              <div className="card-actions">
                {state.file && <button type="button" className="compact-button" disabled={busy} onClick={() => uploadSlot(slot)}>{state.busy === 'upload' ? '上传中...' : '上传保存'}</button>}
                {slot.firstMile && record && <button type="button" className="ghost compact-button" disabled={busy} onClick={() => downloadSlot(slot, record)}>{state.busy === 'download' ? '下载中...' : '下载文件'}</button>}
                {record && <button type="button" className="compact-button" disabled={busy} onClick={() => applySlot(slot)}>{state.busy === 'apply' ? '应用中...' : '应用刷新'}</button>}
                {record && <button type="button" className="ghost compact-button" disabled={busy} onClick={() => deleteSlot(slot)}>{state.busy === 'delete' ? '删除中...' : '删除'}</button>}
              </div>
            </article>
          );
        })}
      </section>
      {isFirstMileLibrary && (
        <section className="first-mile-issue-section">
          <div className="section-heading-row">
            <h3>异常行明细</h3>
            <span className="section-count">共 {issueRows.length} 条，每页 {issuePageSize} 条</span>
          </div>
          <DataTable
            className="first-mile-issue-table"
            rows={pagedIssueRows}
            columns={['来源负责人', '文件', 'Sheet', 'Excel行号', 'OA审批单号', '物料编码', 'SKU', '原始数量', '异常原因']}
            render={(row) => [
              row.owner || '未识别',
              <span className="tight-cell" title={row.fileName}>{row.fileName || '-'}</span>,
              row.sourceSheet || '-',
              row.sourceExcelRow || '-',
              row.oaApprovalNo || '-',
              row.materialCode || '-',
              row.sourceSku || '-',
              row.quantitySource || '-',
              <span className="issue-reason" title={row.reason}>{row.reason || '-'}</span>
            ]}
          />
          {issueRows.length > 0 && (
            <TablePagination
              label="头程数据库异常行分页"
              currentPage={currentIssuePage}
              totalPages={issueTotalPages}
              onPageChange={setIssuePage}
              pageSize={issuePageSize}
            />
          )}
        </section>
      )}
    </>
  );
}


function App() {
  const [globalLoading, setGlobalLoading] = useState(getLoadingProgress);
  const token = 'local';
  const [user, setUser] = useState(null);
  const [pages, setPages] = useState(PAGE_LABELS);
  const [activeTab, setActiveTab] = useState(storedActivePage);
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try {
      const saved = window.localStorage.getItem('gendanjinduCollapsedGroups');
      const parsed = saved ? JSON.parse(saved) : [];
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  });
  const toggleGroup = (title) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      try {
        window.localStorage.setItem('gendanjinduCollapsedGroups', JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };
  const [visitedPages, setVisitedPages] = useState(() => {
    const savedPage = storedActivePage();
    return new Set(savedPage ? [savedPage] : []);
  });
  const [message, setMessage] = useState('');

  useEffect(() => subscribeLoadingProgress(setGlobalLoading), []);

  async function reloadDemands() {
    return;
  }

  async function bootstrap(currentToken = token) {
    const payload = await request('/api/bootstrap', { token: currentToken });
    setUser(payload.user);
    setPages(payload.pages || PAGE_LABELS);
    setActiveTab((currentPage) => resolveActivePage(payload.user, currentPage));
  }

  useEffect(() => {
    bootstrap(token).catch((error) => {
      setMessage(`系统初始化失败：${error.message}`);
    });
  }, [token]);

  useEffect(() => {
    if (!user || !activeTab || !visiblePagesForUser(user).includes(activeTab)) return;
    setVisitedPages((current) => {
      if (current.has(activeTab)) return current;
      const next = new Set(current);
      next.add(activeTab);
      return next;
    });
    try {
      window.sessionStorage.setItem(ACTIVE_PAGE_KEY, activeTab);
    } catch {
      // Session storage availability does not affect navigation.
    }
  }, [activeTab, user]);

  const loadingProgress = <GlobalLoadingProgress state={globalLoading} />;

  if (!user) return <>{loadingProgress}{message && <p className="message">{message}</p>}</>;

  const visiblePages = visiblePagesForUser(user);
  const canView = (page) => visiblePages.includes(page);
  const shouldMount = (page) => canView(page) && visitedPages.has(page);

  return (
    <main className="app-shell" onClick={() => setMessage('')}>
      {loadingProgress}
      <SecurityWatermark userName={user.name} />
      <aside className="sidebar" onClick={(event) => event.stopPropagation()}>
          <h1>备货出货计划</h1>
          <span className="app-version-time">服务器共享数据</span>
          <nav className="sidebar-nav">
            {NAV_GROUPS.map((group) => {
              const groupPages = group.pages.filter((page) => visiblePages.includes(page));
              if (!groupPages.length) return null;
              const collapsed = collapsedGroups.has(group.title);
              return (
                <div className={`sidebar-nav-group${collapsed ? ' collapsed' : ''}`} key={group.title}>
                  <button type="button" className="sidebar-nav-title" onClick={() => toggleGroup(group.title)} aria-expanded={!collapsed}>
                    <span className="sidebar-nav-arrow" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
                    {group.title}
                  </button>
                  {!collapsed && groupPages.map((page) => (
                    <button key={page} type="button" className={activeTab === page ? 'active' : ''} onClick={() => setActiveTab(page)}>
                      {pages[page] || PAGE_LABELS[page]}
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="user-box">
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </div>
      </aside>
      <section className="content" onClick={(event) => event.stopPropagation()}>
        {message && <p className="message">{message}</p>}
        {shouldMount('fullInventorySummary') && <PagePane page="fullInventorySummary" activeTab={activeTab}><React.Suspense fallback={<div className="loading-fallback">加载中...</div>}><FullInventorySummaryPage token={token} active={activeTab === 'fullInventorySummary'} /></React.Suspense></PagePane>}
        {shouldMount('supplyPlanBoard') && <PagePane page="supplyPlanBoard" activeTab={activeTab}><React.Suspense fallback={<div className="loading-fallback">加载中...</div>}><SupplyPlanBoard token={token} active={activeTab === 'supplyPlanBoard'} /></React.Suspense></PagePane>}
        {shouldMount('inventorySummaryLibrary') && <PagePane page="inventorySummaryLibrary" activeTab={activeTab}><DimensionLibrary token={token} reloadDemands={reloadDemands} reloadDemandData={false} setMessage={setMessage} title="底表文件" slots={INVENTORY_SUMMARY_LIBRARY_SLOTS} gridColumns={4} /></PagePane>}
        {shouldMount('dimensionLibrary') && <PagePane page="dimensionLibrary" activeTab={activeTab}><DimensionLibrary token={token} reloadDemands={reloadDemands} setMessage={setMessage} gridColumns={3} /></PagePane>}
        <PersistentHorizontalScrollbar activeTab={activeTab} />
      </section>
    </main>
  );
}

export default App;
