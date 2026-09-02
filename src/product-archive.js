export const PRODUCT_ARCHIVE_PAGE_SIZE = 50;

function text(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
}

export function activeFeedbackSlots(slots = []) {
  return slots.filter((slot, index) => index < 3 || slot.applied || slot.fileName || slot.rowCount > 0);
}

export function flattenProductArchive(rows = [], slots = []) {
  const activeSlots = activeFeedbackSlots(slots);
  return rows.flatMap((product) => activeSlots.map((slot) => {
    const feedback = (product.feedbacks || []).find((item) => item.slotId === slot.slotId) || {};
    return {
      ...product,
      rowKey: `${product.id}:${slot.slotId}`,
      slotId: slot.slotId,
      businessUnit: slot.title,
      productLifecycle: text(feedback.productLifecycle),
      productPositioning: text(feedback.productPositioning),
      feedbackRemark: text(feedback.feedbackRemark),
      feedbackFileName: text(feedback.fileName || slot.fileName),
      feedbackUpdatedAt: text(feedback.updatedAt || slot.updatedAt),
      feedbackComplete: Boolean(text(feedback.productLifecycle) || text(feedback.productPositioning))
    };
  }));
}

export function productArchiveFilterOptions(rows = []) {
  return {
    businessUnits: unique(rows.map((row) => row.businessUnit)),
    productLines: unique(rows.map((row) => row.productLine)),
    productSeries: unique(rows.map((row) => row.productSeries)),
    lifecycles: ['待反馈', ...unique(rows.map((row) => row.productLifecycle))],
    positions: ['待反馈', ...unique(rows.map((row) => row.productPositioning))]
  };
}

export function filterProductArchiveRows(rows = [], filters = {}) {
  const keyword = text(filters.keyword).toLowerCase();
  return rows.filter((row) => (
    (!filters.businessUnit || row.businessUnit === filters.businessUnit)
    && (!filters.productLine || row.productLine === filters.productLine)
    && (!filters.productSeries || row.productSeries === filters.productSeries)
    && (!filters.productLifecycle || (filters.productLifecycle === '待反馈' ? !row.productLifecycle : row.productLifecycle === filters.productLifecycle))
    && (!filters.productPositioning || (filters.productPositioning === '待反馈' ? !row.productPositioning : row.productPositioning === filters.productPositioning))
    && (!keyword || [
      row.materialCode,
      row.sku,
      row.logisticsCode,
      row.materialName,
      row.brand,
      row.model,
      row.productLine,
      row.productSeries,
      row.productLifecycle,
      row.productPositioning,
      row.feedbackRemark
    ].some((value) => text(value).toLowerCase().includes(keyword)))
  ));
}

export function productArchiveMetrics(products = [], flatRows = []) {
  const coveredProducts = new Set(flatRows.filter((row) => row.feedbackComplete).map((row) => row.id)).size;
  const feedbackCount = flatRows.filter((row) => row.feedbackComplete).length;
  return {
    productCount: products.length,
    coveredProducts,
    feedbackCount,
    pendingCount: Math.max(0, flatRows.length - feedbackCount)
  };
}
