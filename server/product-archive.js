function text(value) {
  return String(value ?? '').trim();
}

function identifier(value) {
  return text(value)
    .replace(/\u3000/g, ' ')
    .replace(/[\uFF01-\uFF5E]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, '')
    .replace(/\.0$/, '')
    .toUpperCase();
}

function productKey(row, index) {
  const materialCode = identifier(row.materialCode);
  if (materialCode) return `material:${materialCode}`;
  const sku = identifier(row.sku);
  if (sku) return `sku:${sku}`;
  return `row:${index}`;
}

function mergeProduct(existing, row) {
  if (!existing) return { ...row };
  const merged = { ...existing };
  Object.entries(row || {}).forEach(([key, value]) => {
    if (!text(merged[key]) && text(value)) merged[key] = value;
  });
  return merged;
}

export function buildProductArchive({ productRows = [], feedbackSources = [] } = {}) {
  const products = new Map();
  productRows.forEach((row, index) => {
    const key = productKey(row, index);
    products.set(key, mergeProduct(products.get(key), row));
  });

  const materialIndex = new Map();
  const skuIndex = new Map();
  products.forEach((row, key) => {
    const materialCode = identifier(row.materialCode);
    const sku = identifier(row.sku);
    if (materialCode) materialIndex.set(materialCode, key);
    if (sku) skuIndex.set(sku, key);
  });

  const feedbackByProduct = new Map();
  const feedbackSlots = feedbackSources.map((source) => {
    let matchedCount = 0;
    let unmatchedCount = 0;
    const latestByProduct = new Map();
    (source.rows || []).forEach((row) => {
      const materialCode = identifier(row.materialCode);
      const sku = identifier(row.sku);
      const key = (materialCode && materialIndex.get(materialCode)) || (sku && skuIndex.get(sku));
      if (!key) {
        if (materialCode || sku) unmatchedCount += 1;
        return;
      }
      latestByProduct.set(key, {
        slotId: source.slotId,
        businessUnit: source.title,
        productLifecycle: text(row.productLifecycle),
        productPositioning: text(row.productPositioning),
        feedbackRemark: text(row.feedbackRemark),
        fileName: source.fileName || '',
        updatedAt: source.updatedAt || ''
      });
    });
    latestByProduct.forEach((feedback, key) => {
      matchedCount += 1;
      const list = feedbackByProduct.get(key) || [];
      list.push(feedback);
      feedbackByProduct.set(key, list);
    });
    return {
      slotId: source.slotId,
      title: source.title,
      fileName: source.fileName || '',
      updatedAt: source.updatedAt || '',
      uploadedBy: source.uploadedBy || '',
      applied: Boolean(source.applied),
      rowCount: (source.rows || []).length,
      matchedCount,
      unmatchedCount
    };
  });

  const rows = [...products].map(([key, row]) => ({
    id: key,
    materialCode: text(row.materialCode),
    sku: text(row.sku),
    logisticsCode: text(row.logisticsCode),
    materialName: text(row.materialName),
    brand: text(row.brand),
    productType: text(row.productType),
    productLine: text(row.productLine),
    productSeries: text(row.productSeries),
    model: text(row.model),
    salesRegion: text(row.salesRegion),
    pretaxPrice: row.pretaxPrice ?? '',
    feedbacks: feedbackByProduct.get(key) || []
  })).sort((left, right) => (
    left.productLine.localeCompare(right.productLine, 'zh-Hans-CN')
    || left.productSeries.localeCompare(right.productSeries, 'zh-Hans-CN')
    || left.materialCode.localeCompare(right.materialCode, 'zh-Hans-CN')
    || left.sku.localeCompare(right.sku, 'zh-Hans-CN')
  ));

  return { rows, feedbackSlots };
}
