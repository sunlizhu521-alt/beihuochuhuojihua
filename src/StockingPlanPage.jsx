import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { API } from './api-base.js';
import { buildStockingPlanRows, groupStockingPlanRowsByMaterial } from './stocking-plan.js';

const MATERIALS_PER_PAGE = 20;

function numberText(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '0';
}

async function apiRequest(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '请求失败');
  return payload;
}

const StockingPlanRow = memo(function StockingPlanRow({
  row,
  rowSpan,
  forecastMode,
  expectedDelivery,
  onExpectedDeliveryChange
}) {
  const forecastValues = forecastMode === 'month' ? row.monthForecasts : row.weeklyForecast;
  return (
    <tr>
      <td>{row.businessUnit || '-'}</td>
      <td>{row.materialCode || '-'}</td>
      <td>{row.sku || '-'}</td>
      <td className="stocking-plan-name-cell" title={row.productName}>{row.productName || '-'}</td>
      <td>{row.productLine || '-'}</td>
      <td>{row.productSeries || '-'}</td>
      <td>{row.model || '-'}</td>
      {forecastValues.map((value, index) => <td className="numeric-cell" key={index}>{numberText(value)}</td>)}
      <td className="numeric-cell">{numberText(row.onHandQty)}</td>
      <td className="numeric-cell">{numberText(row.inTransitQty)}</td>
      <td className="numeric-cell">{numberText(row.undeliveredQty)}</td>
      <td className="numeric-cell">{numberText(row.finishedQty)}</td>
      {rowSpan ? <td className="numeric-cell stocking-plan-purchase-cell" rowSpan={rowSpan}>{numberText(row.suggestedPurchaseQty)}</td> : null}
      <td>
        <input
          type="date"
          className="stocking-plan-date-input"
          aria-label={`期望交期 ${row.businessUnit} ${row.materialCode}`}
          value={expectedDelivery}
          onChange={(event) => onExpectedDeliveryChange(row.rowKey, event.target.value)}
        />
      </td>
    </tr>
  );
});

export default function StockingPlanPage({ token, active }) {
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forecastMode, setForecastMode] = useState('month');
  const [page, setPage] = useState(1);
  const [expectedDeliveries, setExpectedDeliveries] = useState(() => new Map());

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    apiRequest('/api/stocking-plan/source', token, { signal: controller.signal })
      .then(setSource)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message || '备货需求计划加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active, token]);

  const plan = useMemo(() => buildStockingPlanRows(source || {}), [source]);
  const materialGroups = useMemo(() => groupStockingPlanRowsByMaterial(plan.rows), [plan.rows]);
  const totalPages = Math.max(1, Math.ceil(materialGroups.length / MATERIALS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const visibleGroups = useMemo(
    () => materialGroups.slice((currentPage - 1) * MATERIALS_PER_PAGE, currentPage * MATERIALS_PER_PAGE),
    [currentPage, materialGroups]
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const setExpectedDelivery = useCallback((rowKey, value) => {
    setExpectedDeliveries((current) => {
      const next = new Map(current);
      if (value) next.set(rowKey, value);
      else next.delete(rowKey);
      return next;
    });
  }, []);

  if (!source && loading) return <div className="loading-fallback">正在加载备货需求计划...</div>;

  return (
    <section className="stocking-plan-page">
      <div className="page-heading-row stocking-plan-heading">
        <div>
          <h2>备货需求计划</h2>
          <p>按事业部＋物料编码展示，建议采购数量按物料编码跨事业部汇总计算。</p>
        </div>
        <div className="stocking-plan-view-toggle" role="group" aria-label="预测视图切换">
          <button type="button" className={forecastMode === 'month' ? 'active' : ''} onClick={() => setForecastMode('month')}>月预测</button>
          <button type="button" className={forecastMode === 'week' ? 'active' : ''} onClick={() => setForecastMode('week')}>周预测</button>
        </div>
      </div>
      <div className="stocking-plan-meta">
        <span>共 {materialGroups.length} 个物料编码，{plan.rows.length} 条事业部明细</span>
        {source?.updatedAt ? <span>数据更新：{source.updatedAt}</span> : null}
      </div>
      {error ? <p className="error-message">{error}</p> : null}
      {!loading && !error && plan.rows.length === 0 ? (
        <div className="stocking-plan-empty" role="status">
          <strong>暂无备货需求计划数据</strong>
          <span>请先在底表文件和维度表库上传并应用槽位 18、19、21 及商品分类。</span>
        </div>
      ) : null}
      {plan.rows.length > 0 ? (
        <>
          <div className="stocking-plan-table-wrap">
            <table className="stocking-plan-table">
              <thead>
                <tr>
                  {['事业部', '物料编码', 'SKU', '产品名称', '产品线', '系列', '型号'].map((label) => <th key={label}>{label}</th>)}
                  {forecastMode === 'month'
                    ? Array.from({ length: 6 }, (_, index) => <th key={`M${index + 1}`}>M{index + 1}预测</th>)
                    : plan.weeks.map((week) => <th className="stocking-plan-week-column" key={week.key}><strong>{week.label}</strong><small>{week.dateRange}</small></th>)}
                  {['在库量', '在途量', '未交付量', '已完工未发货', '建议采购数量', '期望交期'].map((label) => <th key={label}>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {visibleGroups.flatMap((group) => group.rows.map((row, index) => (
                  <StockingPlanRow
                    key={row.rowKey}
                    row={row}
                    rowSpan={index === 0 ? group.rows.length : 0}
                    forecastMode={forecastMode}
                    expectedDelivery={expectedDeliveries.get(row.rowKey) || ''}
                    onExpectedDeliveryChange={setExpectedDelivery}
                  />
                )))}
              </tbody>
            </table>
          </div>
          <div className="stocking-plan-pagination" aria-label="备货需求计划分页">
            <span>每页 {MATERIALS_PER_PAGE} 个物料编码，第 {currentPage} / {totalPages} 页</span>
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button>
          </div>
        </>
      ) : null}
    </section>
  );
}
