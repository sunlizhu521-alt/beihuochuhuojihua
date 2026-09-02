import { useEffect, useMemo, useRef, useState } from 'react';
import { writeStyledExcelFile } from '../shared/excel-export.js';

const API = import.meta.env.DEV ? 'http://localhost:4003' : '';
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function emptyFilters() {
  return { businessUnits: [], productLines: [], productSeries: [] };
}

function text(value) {
  return String(value ?? '').trim();
}

function numberValue(value) {
  const parsed = Number(text(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberText(value) {
  return numberValue(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function todayText() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((value, index) => index === 0 ? String(value) : String(value).padStart(2, '0'))
    .join('');
}

const INVENTORY_COLUMNS = [
  ['businessUnit', '事业部'], ['warehouse', '仓库名称'], ['productLine', '产品线'], ['productSeries', '系列'],
  ['materialCode', '物料编码'], ['sku', 'SKU'],
  ['inventoryQty', '在库'], ['transitQty', '在途']
];

const FULFILLMENT_COLUMNS = [
  ['purchaseGroup', '采购组'], ['purchaseOwner', '采购下单人'], ['month', '下单月份'],
  ['oaFlowNo', 'OA备货流程号'], ['businessUnit', '事业部'], ['operatorName', '运营'],
  ['orderNo', '采购订单号'], ['supplierShortName', '供应商简称'], ['productLine', '产品线'],
  ['productSeries', '系列'], ['materialCode', '物料编码'], ['sku', 'SKU'],
  ['materialName', '物料名称'], ['borrowOrder', '借调订单'], ['borrowRemark', '借调备注'],
  ['manualRemainingQty', '未交付数量'], ['unpreparedQty', '已下单未备料未生产'],
  ['preparedNotStartedQty', '已备料未生产'], ['inProductionQty', '生产中产品'],
  ['finishedQty', '完工未发产品'], ['sourceShippedQty', '已发货数量'],
  ['sourceContractDeliveryDate', '合同约定交期'], ['productionDeliveryDate', '生产中交付时间'],
  ['unproducedEstimatedDeliveryDate', '未生产预计交付时间'], ['fulfillmentStatus', '是否正常履约'],
  ['unfulfilledReason', '未履约原因'], ['reasonDetail', '原因详情'], ['remark', '备注']
];

const FULFILLMENT_SUMMARY_COLUMNS = [
  ['purchaseOwner', '采购下单人'], ['month', '下单月份'], ['businessUnit', '事业部'],
  ['operatorName', '运营'], ['orderNo', '采购订单号'], ['supplierShortName', '供应商简称'],
  ['productLine', '产品线'], ['productSeries', '系列'], ['materialCode', '物料编码'],
  ['sku', 'SKU'], ['materialName', '物料名称'], ['manualRemainingQty', '未交付数量'],
  ['unpreparedQty', '已下单未备料未生产'], ['preparedNotStartedQty', '已备料未生产'],
  ['inProductionQty', '生产中产品'], ['finishedQty', '完工未发产品'],
  ['sourceContractDeliveryDate', '合同约定交期']
];

async function apiRequest(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '请求失败');
  return payload;
}

export function filterFullInventoryRows(rows, filters, keyword) {
  const search = text(keyword).toLowerCase();
  return rows.filter((row) => (
    (!filters.businessUnits.length || filters.businessUnits.includes(text(row.businessUnit)))
    && (!filters.productLines.length || filters.productLines.includes(text(row.productLine)))
    && (!filters.productSeries.length || filters.productSeries.includes(text(row.productSeries)))
    && (!search || [row.businessUnit, row.materialCode, row.sku].some((value) => text(value).toLowerCase().includes(search)))
  ));
}

function uniqueValues(rows, field) {
  return [...new Set(rows.map((row) => text(row[field])).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }));
}

function FullInventoryMultiSelect({ label, allLabel, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const availableOptions = useMemo(
    () => [...new Set([...options, ...value].map(text).filter(Boolean))],
    [options, value]
  );
  const selected = value.filter((item) => availableOptions.includes(item));

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const buttonLabel = selected.length === 0
    ? allLabel
    : selected.length <= 2
      ? selected.join('、')
      : `已选${selected.length}项`;

  return (
    <div className="multi-filter" ref={rootRef}>
      <span className="multi-filter-label">{label}</span>
      <button type="button" className="multi-filter-button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span>{buttonLabel}</span><b aria-hidden="true">⌄</b>
      </button>
      {open ? (
        <div className="multi-filter-menu">
          <label className="multi-filter-option">
            <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
            <span>{allLabel}</span>
          </label>
          {availableOptions.map((option) => (
            <label className="multi-filter-option" key={option}>
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() => onChange(selected.includes(option)
                  ? selected.filter((item) => item !== option)
                  : [...selected, option])}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function FullInventorySummaryPage({ token, active }) {
  const [data, setData] = useState({ updatedAt: '', groups: [] });
  const [activeGroupKey, setActiveGroupKey] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [keyword, setKeyword] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [showFulfillmentDetail, setShowFulfillmentDetail] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    apiRequest('/api/full-inventory-summary', token, { signal: controller.signal })
      .then((payload) => {
        const groups = Array.isArray(payload.groups) ? payload.groups : [];
        setData({
          updatedAt: text(payload.updatedAt),
          groups
        });
        setActiveGroupKey((current) => groups.some((group) => group.key === current) ? current : groups[0]?.key || '');
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message || '全量库存汇总加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active, token]);

  const currentGroup = useMemo(
    () => data.groups.find((group) => group.key === activeGroupKey) || data.groups[0] || { key: '', label: '', rows: [] },
    [activeGroupKey, data.groups]
  );
  const isFulfillment = currentGroup.key === 'undelivered';
  const columns = isFulfillment
    ? (showFulfillmentDetail ? FULFILLMENT_COLUMNS : FULFILLMENT_SUMMARY_COLUMNS)
    : INVENTORY_COLUMNS;
  const sourceRows = Array.isArray(currentGroup.rows) ? currentGroup.rows : [];
  const options = useMemo(() => ({
    businessUnits: uniqueValues(sourceRows, 'businessUnit'),
    productLines: uniqueValues(sourceRows, 'productLine'),
    productSeries: uniqueValues(sourceRows, 'productSeries')
  }), [sourceRows]);
  function cellValue(row, key) {
    const value = row[key];
    return key.endsWith('Qty') || ['inventoryQty', 'transitQty'].includes(key)
      ? numberText(value)
      : text(value);
  }
  const filteredRows = useMemo(
    () => filterFullInventoryRows(sourceRows, filters, keyword),
    [filters, keyword, sourceRows]
  );
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = useMemo(
    () => filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, filteredRows, pageSize]
  );

  useEffect(() => setPage(1), [activeGroupKey, filters, keyword, pageSize]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function selectGroup(groupKey) {
    setActiveGroupKey(groupKey);
    setFilters(emptyFilters());
    setKeyword('');
    setPage(1);
  }

  function clearFilters() {
    setFilters(emptyFilters());
    setKeyword('');
    setPage(1);
  }

  async function exportRows() {
    if (!filteredRows.length || !currentGroup.label) return;
    setExporting(true);
    setError('');
    try {
      const XLSX = await import('xlsx');
      const worksheet = XLSX.utils.json_to_sheet(filteredRows.map((row) => {
        const out = {};
        columns.forEach(([key, label]) => {
          out[label] = cellValue(row, key);
        });
        return out;
      }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, currentGroup.label.slice(0, 31));
      await writeStyledExcelFile(XLSX, workbook, `全量库存汇总_${currentGroup.label}_${todayText()}.xlsx`);
    } catch (exportError) {
      setError(exportError.message || '全量库存导出失败');
    } finally {
      setExporting(false);
    }
  }

  if (!active) return null;

  return (
    <div className="inventory-risk-page full-inventory-page">
      <header className="inventory-risk-header">
        <div>
          <span className="inventory-risk-eyebrow">FULL INVENTORY</span>
          <h2>全量库存汇总</h2>
          <p>数据更新时间：{data.updatedAt || '尚未上传并应用全量库存底表'}</p>
        </div>
        <div className="inventory-risk-actions">
          <button className="inventory-risk-button secondary" type="button" disabled={!filteredRows.length || exporting} onClick={exportRows}>
            {exporting ? '导出中...' : '导出 Excel'}
          </button>
        </div>
      </header>

      <div className="full-inventory-tabs" role="tablist" aria-label="全量库存分类">
        {data.groups.map((group) => (
          <button
            type="button"
            role="tab"
            aria-selected={currentGroup.key === group.key}
            className={currentGroup.key === group.key ? 'active' : ''}
            key={group.key}
            onClick={() => selectGroup(group.key)}
          >
            {group.label}<span>{numberText(group.rows?.length || 0)}</span>
          </button>
        ))}
      </div>

      <section className="inventory-risk-filters" aria-label="全量库存筛选器">
        <FullInventoryMultiSelect label="事业部" allLabel="全部事业部" value={filters.businessUnits} options={options.businessUnits} onChange={(value) => setFilters((current) => ({ ...current, businessUnits: value }))} />
        <FullInventoryMultiSelect label="产品线" allLabel="全部产品线" value={filters.productLines} options={options.productLines} onChange={(value) => setFilters((current) => ({ ...current, productLines: value }))} />
        <FullInventoryMultiSelect label="系列" allLabel="全部系列" value={filters.productSeries} options={options.productSeries} onChange={(value) => setFilters((current) => ({ ...current, productSeries: value }))} />
        <label className="full-inventory-filter-field">
          <span>搜索</span>
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="事业部 / 物料编码 / SKU" />
        </label>
        <button className="inventory-risk-button secondary inventory-risk-filter-clear" type="button" onClick={clearFilters}>清除筛选</button>
        <span className="inventory-risk-filter-count">当前 {numberText(filteredRows.length)} 条</span>
      </section>

      {loading ? <div className="inventory-risk-loading">正在加载全量库存数据...</div> : null}
      {error ? <div className="inventory-risk-alert error">{error}</div> : null}

      <section className="inventory-risk-result inventory-risk-result-combined">
        <div className="inventory-risk-section-heading">
          <div><span className="inventory-risk-section-kicker">全量库存明细</span><h3>{currentGroup.label || '暂无分类'}</h3></div>
          {isFulfillment ? (
            <div className="inventory-risk-section-actions">
              <button type="button" className="inventory-risk-button secondary" onClick={() => setShowFulfillmentDetail((value) => !value)}>
                {showFulfillmentDetail ? '不展示明细' : '展示明细'}
              </button>
            </div>
          ) : null}
        </div>
        <div className="inventory-risk-table-wrap">
          <table className={`inventory-risk-table full-inventory-table${isFulfillment ? ' fulfillment-wide' : ''}`}>
            <thead><tr>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr key={`${row.businessUnit || ''}\u001f${row.materialCode || ''}\u001f${index}`}>
                  {columns.map(([key]) => <td key={key}>{cellValue(row, key) || '-'}</td>)}
                </tr>
              ))}
              {!visibleRows.length ? <tr><td className="inventory-risk-empty" colSpan={columns.length}>{loading ? '数据加载中...' : '当前页签和筛选条件下没有数据'}</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="inventory-risk-pagination full-inventory-pagination">
          <label>每页
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <span>第 {currentPage}/{totalPages} 页，共 {numberText(filteredRows.length)} 条</span>
          <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button>
          <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>下一页</button>
        </div>
      </section>
    </div>
  );
}
