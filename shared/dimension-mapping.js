export const FIELD_MAPPING_ALIASES = {
  subject: ['主体', '使用组织', '库存组织'],
  materialCode: ['物料编码', '物料代码', '品号'],
  sku: ['SKU', '产品SKU', '商品SKU'],
  materialName: ['物料名称', '金蝶名称', 'SKU名称', '名称'],
  productType: ['销售产品分类', '产品类型', '产品分类'],
  productLine: ['销售产品线', '产品线'],
  productSeries: ['销售系列', '系列'],
  businessUnit: ['事业部'],
  warehouseCode: ['仓库编码', '仓库代码', '仓库编号', '金蝶仓库编码', '仓库ID', '编码'],
  warehouseName: ['仓库名称', '仓库名', '金蝶仓库名称', '金蝶名称'],
  warehouseLocation: ['仓位位置', '仓库位置', '仓位'],
  pretaxPrice: ['不含税结算价'], salesRegion: ['销售区域'], salesChannel: ['销售渠道'],
  marketplace: ['站点', '站点名称', '国家站点', '销售站点', '国家/地区'],
  level1WarehouseCategory: ['一级仓库分类', '仓库一级分类', '一级分类', '仓库大类'],
  level2WarehouseCategory: ['二级仓库分类', '仓库二级分类', '二级分类', '仓库小类'],
  level3WarehouseCategory: ['三级仓库分类', '仓库三级分类', '三级分类'],
  onHandQty: ['在库量', '库存量', '在库数量'], inTransitQty: ['在途量', '在途数量'],
  undeliveredQty: ['未交付数量', '未交付量', '备货剩余数量'],
  salesQty: ['销售数量合计', '销量', '销售数量'], salesAmount: ['销售金额合计', '销售额', '销售金额'],
  safetyStockQty: ['安全库存数量', '安全库存', '安全库存量']
};

function normalizedMappingName(value) {
  return String(value ?? '').trim().normalize('NFKC').toLowerCase()
    .replace(/[(（]?(必填|选填|required)[)）]?/gi, '')
    .replace(/[\s_\-—:：/\\]+/g, '');
}

export function inferredMappingColumn(key, label, columns, unavailableColumns = new Set()) {
  const aliases = [label, key, ...(FIELD_MAPPING_ALIASES[key] || [])].map(normalizedMappingName).filter(Boolean);
  const ranked = columns.filter((column) => !unavailableColumns.has(column)).map((column) => {
    const candidate = normalizedMappingName(column);
    const score = aliases.reduce((best, alias) => {
      if (candidate === alias) return Math.max(best, 1000 + alias.length);
      if (alias.length >= 2 && (candidate.startsWith(alias) || candidate.endsWith(alias))) return Math.max(best, 500 + alias.length);
      if (alias.length >= 2 && candidate.includes(alias)) return Math.max(best, 200 + alias.length);
      return best;
    }, 0);
    return { column, score };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score);
  if (!ranked.length || (ranked[1] && ranked[0].score === ranked[1].score)) return '';
  return ranked[0].column;
}

export function validMappingForColumns(mapping = {}, columns = [], fields = [], inferMissing = true) {
  const validColumns = new Set(columns);
  const usedColumns = new Set();
  const next = {};
  fields.forEach(([key]) => {
    const value = mapping[key] || '';
    if (value && validColumns.has(value) && !usedColumns.has(value)) {
      next[key] = value;
      usedColumns.add(value);
    } else {
      next[key] = '';
    }
  });
  if (inferMissing) {
    fields.forEach(([key, label]) => {
      if (next[key]) return;
      const inferred = inferredMappingColumn(key, label, columns, usedColumns);
      next[key] = inferred;
      if (inferred) usedColumns.add(inferred);
    });
  }
  return next;
}

export function duplicateMappingColumns(mapping = {}, fields = []) {
  const labels = new Map(fields.map(([key, label]) => [key, label]));
  const byColumn = new Map();
  fields.forEach(([key]) => {
    const column = String(mapping[key] || '').trim();
    if (!column) return;
    byColumn.set(column, [...(byColumn.get(column) || []), labels.get(key) || key]);
  });
  return [...byColumn.entries()].filter(([, targets]) => targets.length > 1).map(([column, targets]) => ({ column, targets }));
}

export function mappingValidation(mapping = {}, fields = [], requiredFields = [], columns = []) {
  const validColumns = new Set(columns);
  return {
    missingFields: requiredFields.filter((field) => !String(mapping[field] || '').trim()),
    duplicateColumns: duplicateMappingColumns(mapping, fields),
    unknownColumns: fields.map(([key]) => String(mapping[key] || '').trim()).filter((column) => column && !validColumns.has(column))
  };
}
