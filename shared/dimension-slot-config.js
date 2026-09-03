export const DIMENSION_SLOTS = [
  {
    id: 'productCategory',
    title: '商品分类',
    fields: [
      ['materialCode', '物料编码', '金蝶物料的唯一编码；不与 SKU 或领星 SKU 混用'],
      ['sku', 'SKU', '销售 SKU；源表中“领星SKU”是另一列'],
      ['materialName', '物料名称', '通常对应源表“金蝶名称”'],
      ['brand', '品牌'],
      ['productType', '销售产品分类', '用于区分产品类型，不是物料编码'],
      ['productLine', '销售产品线'],
      ['productSeries', '销售系列'],
      ['model', '型号'],
      ['salesRegion', '销售区域'],
      ['pretaxPrice', '不含税结算价']
    ],
    requiredFields: ['materialCode', 'sku', 'materialName', 'productType', 'productLine', 'productSeries', 'model', 'salesRegion', 'pretaxPrice'],
    mappingNote: '已删除无实际来源和下游用途的“物流编码”。SKU 与领星 SKU 为不同源列，本表只取 SKU。'
  },
  {
    id: 'purchaseAssignment',
    title: '采购分工',
    fields: [
      ['supplier', '供应商'],
      ['supplierShortName', '供应商简称'],
      ['productLineDetailSupplier', '产品线明细供应商'],
      ['materialCode', '物料编码'],
      ['productLineDetailPurchaseGroup', '产品线明细-采购组'],
      ['productLineDetailPurchaseOwner', '产品线明细-采购下单人'],
      ['purchaseOwner', '采购下单人'],
      ['purchaseGroup', '采购组'],
      ['purchaseOrg', '采购组织']
    ],
    requiredFields: ['materialCode', 'purchaseOwner'],
    mappingNote: '供应商、供应商简称和产品线明细供应商是不同口径，不允许自动共用同一源列。'
  },
  {
    id: 'spare1',
    title: '仓库名称',
    fields: [
      ['subject', '使用组织'],
      ['warehouseCode', '仓库编码', '可对应源表“编码”'],
      ['warehouseName', '仓库名称', '可对应源表“金蝶名称”'],
      ['warehouseLocation', '仓位位置'],
      ['salesChannel', '销售渠道'],
      ['marketplace', '站点'],
      ['level1WarehouseCategory', '一级仓库分类'],
      ['level2WarehouseCategory', '二级仓库分类'],
      ['level3WarehouseCategory', '三级仓库分类']
    ],
    requiredFields: ['subject', 'warehouseCode', 'warehouseName', 'level1WarehouseCategory', 'level2WarehouseCategory']
  },
  {
    id: 'warehouseMaterialMap',
    title: '产品迭代关系',
    fields: [
      ['productLine', '产品线'], ['productSeries', '系列'], ['model', '型号'], ['versionType', '版本类型'],
      ['latestMaterialCode', '最新物料编码'], ['latestSku', '最新SKU'], ['latestMaterialName', '最新金蝶名称'], ['latestCreatedAt', '最新物料金蝶创建时间'],
      ['relatedMaterialCode', '关联物料编码'], ['relatedSku', '关联SKU'], ['relatedMaterialName', '关联金蝶名称'], ['relatedCreatedAt', '关联物料金蝶创建时间'],
      ['productManager', '产品经理'], ['isCorrect', '是否正确'], ['remark', '备注'], ['salesChannel', '销售渠道']
    ],
    requiredFields: ['productLine', 'productSeries', 'model', 'versionType', 'latestMaterialCode', 'latestSku', 'latestMaterialName', 'latestCreatedAt'],
    requiresSheetSelection: true,
    mappingNote: '最新物料与关联物料必须分开映射；无迭代物料的关联字段可以留空。'
  },
  {
    id: 'dimensionSpare',
    title: '产品定位',
    fields: [
      ['businessUnit', '事业部'], ['materialCode', '物料编码'], ['sku', 'SKU'], ['materialName', '物料名称'],
      ['onHandFlag', '在库是否有库存'], ['inTransitFlag', '在途是否有库存'], ['undeliveredFlag', '未交付是否有库存'],
      ['unifiedStage', '统一阶段'], ['unifiedPositioning', '统一定位'], ['remark', '备注']
    ],
    requiredFields: ['businessUnit', 'materialCode', 'onHandFlag', 'inTransitFlag', 'undeliveredFlag', 'unifiedStage', 'unifiedPositioning']
  },
  {
    id: 'lingxingWarehouseMap',
    title: '安全库存',
    fields: [
      ['businessUnit', '事业部'], ['materialCode', '物料编码'], ['sku', 'SKU'], ['materialName', '物料名称'],
      ['productLine', '产品线'], ['productSeries', '系列'], ['model', '型号'], ['safetyStockQty', '安全库存数量'], ['remark', '备注']
    ],
    requiredFields: ['businessUnit', 'materialCode', 'safetyStockQty'],
    mappingNote: '安全库存按“事业部 + 物料编码”确认，数量不与天数参数混用。'
  },
  { id: 'dimensionSpare2', title: '备用', fields: [], mappingNote: '备用槽位未定义业务口径，上传后按源列原样保存。' },
  { id: 'spare2', title: '备用2', fields: [], mappingNote: '备用槽位未定义业务口径，上传后按源列原样保存。' },
  { id: 'dimensionSpare3', title: '备用3', fields: [], mappingNote: '备用槽位未定义业务口径，上传后按源列原样保存。' }
].map((slot) => slot.fields.length ? {
  ...slot,
  manualFieldSelection: true,
  autoMap: true,
  requireMappingConfirmation: true
} : slot);

export const INVENTORY_SUMMARY_LIBRARY_SLOTS = [
  {
    id: 'inventorySummaryFile18', title: '库存数据',
    fields: [['businessUnit', '事业部'], ['materialCode', '物料编码'], ['sku', 'SKU'], ['materialName', '名称'], ['onHandQty', '在库量'], ['inTransitQty', '在途量']],
    requiredFields: ['businessUnit', 'materialCode', 'onHandQty', 'inTransitQty'],
    mappingNote: '按“事业部 + 物料编码”核算，SKU 和名称用于展示与复核。'
  },
  {
    id: 'inventorySummaryFile19', title: '未交付数据',
    fields: [
      ['businessUnit', '事业部'], ['materialCode', '物料编码'], ['sku', 'SKU'], ['materialName', '名称'], ['undeliveredQty', '未交付数量'],
      ['finishedQty', '已生产未发货'], ['unpreparedQty', '已下单未备料未生产'], ['preparedNotStartedQty', '已备料未生产'], ['inProductionQty', '生产中产品']
    ],
    requiredFields: ['businessUnit', 'materialCode', 'undeliveredQty'],
    mappingNote: '未交付总量为核心字段，履约阶段数量用于原因复核。'
  },
  {
    id: 'inventorySummaryFile20', title: '销售数据',
    fields: [['businessUnit', '事业部'], ['materialCode', '物料编码'], ['sku', 'SKU'], ['materialName', '名称'], ['salesQty', '销售数量合计'], ['salesAmount', '销售金额合计']],
    requiredFields: ['businessUnit', 'materialCode', 'salesQty'],
    mappingNote: '月度或周度明细列会按源列名保留，这里只确认主键和合计口径。'
  },
  {
    id: 'inventorySummaryFile21', title: 'M+6 预测',
    fields: [
      ['businessUnit', '事业部'], ['materialCode', '物料编码'], ['sku', 'SKU'], ['materialName', '名称'],
      ['forecastM1', 'M+1 预测'], ['forecastM2', 'M+2 预测'], ['forecastM3', 'M+3 预测'],
      ['forecastM4', 'M+4 预测'], ['forecastM5', 'M+5 预测'], ['forecastM6', 'M+6 预测']
    ],
    requiredFields: ['businessUnit', 'materialCode', 'forecastM1', 'forecastM2', 'forecastM3', 'forecastM4', 'forecastM5', 'forecastM6'],
    mappingNote: '上传时把实际月份列依次对应到 M+1 至 M+6，避免月份错位。'
  }
].map((slot) => ({
  ...slot,
  manualFieldSelection: true,
  autoMap: true,
  requireMappingConfirmation: true
}));

export const MAPPED_SLOT_CONFIGS = Object.fromEntries(
  [...DIMENSION_SLOTS, ...INVENTORY_SUMMARY_LIBRARY_SLOTS]
    .filter((slot) => slot.fields.length)
    .map((slot) => [slot.id, slot])
);
