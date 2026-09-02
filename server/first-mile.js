import xlsx from 'xlsx';

export const FIRST_MILE_PARSER_VERSION = 5;

const EMPTY_SHEET_PATTERN = /^Sheet\d*$/i;
const FIRST_MILE_SLOT_OWNERS = {
  firstMileData1: '张婷婷',
  firstMileData2: '扈翠芸',
  firstMileData3: '魏静',
  firstMileData4: '李紫媛',
  firstMileData5: '李宛宸',
  firstMileSpare: '备用'
};

function text(value) {
  return String(value ?? '').trim();
}

function compact(value) {
  return text(value).normalize('NFKC').replace(/[\s\n\r_\-—:：()（）/\\]/g, '').toLowerCase();
}

function safeDate(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return text(value);
}

function parseQuantity(value) {
  const normalized = text(value).replace(/,/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueHeaders(headers) {
  const seen = new Map();
  return headers.map((header, index) => {
    const value = text(header) || `未命名列${index + 1}`;
    const count = seen.get(value) || 0;
    seen.set(value, count + 1);
    return count ? `${value}_${count + 1}` : value;
  });
}

function expandedSheetRows(sheet) {
  const rows = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: true
  });
  (sheet?.['!merges'] || []).forEach((range) => {
    const value = rows[range.s.r]?.[range.s.c] ?? '';
    if (value === '') return;
    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex++) {
      rows[rowIndex] ||= [];
      for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex++) {
        if (rows[rowIndex][columnIndex] === undefined || rows[rowIndex][columnIndex] === '') {
          rows[rowIndex][columnIndex] = value;
        }
      }
    }
  });
  return rows;
}

function sheetKind(sheetName, rows) {
  if (EMPTY_SHEET_PATTERN.test(text(sheetName))) return null;
  if (text(sheetName).includes('空运')) return 'air';
  if (text(sheetName).includes('外贸')) return 'foreignTrade';
  if (text(sheetName).includes('海外仓配件')) return 'accessory';
  const headerText = [...(rows[1] || []), ...(rows[2] || [])].map(text).join('|');
  if (headerText.includes('OA审批单号') && headerText.includes('小包装数量')) {
    return /头程.*发货/.test(text(sheetName)) ? 'firstMile' : 'historical';
  }
  return null;
}

function destinationWarehouseColumnIndexes(rows, headerRows) {
  const parentRowIndex = headerRows[0];
  const childRowIndex = headerRows.at(-1);
  const columnCount = Math.max(...headerRows.map((rowIndex) => (rows[rowIndex] || []).length), 0);
  const destinationKey = compact('目的仓');
  const virtualKey = compact('领星虚拟仓');
  const candidates = Array.from({ length: columnCount }, (_, columnIndex) => ({
    columnIndex,
    parent: compact(rows[parentRowIndex]?.[columnIndex]),
    child: compact(rows[childRowIndex]?.[columnIndex])
  })).filter(({ parent }) => parent.includes(destinationKey));
  if (!candidates.length) return null;
  const physical = candidates.find(({ child }) => child.includes(compact('仓库')) && !child.includes(virtualKey))
    || candidates[0];
  const virtual = candidates.find(({ child, columnIndex }) => child.includes(virtualKey) && columnIndex !== physical.columnIndex)
    || candidates.find(({ columnIndex }) => columnIndex !== physical.columnIndex);
  return {
    physicalIndex: physical.columnIndex,
    virtualIndex: virtual?.columnIndex ?? -1
  };
}

function parsedSheet(sheetName, sheet) {
  const rows = expandedSheetRows(sheet);
  const kind = sheetKind(sheetName, rows);
  if (!kind) return { sheetName, kind: null, rows: [], columns: [], skipped: true };

  const headerRows = kind === 'air' ? [0] : kind === 'foreignTrade' ? [1] : [1, 2];
  const dataStart = kind === 'air' ? 1 : kind === 'foreignTrade' ? 2 : 3;
  const columnCount = Math.max(...headerRows.map((rowIndex) => (rows[rowIndex] || []).length), 0);
  const destinationWarehouseColumns = destinationWarehouseColumnIndexes(rows, headerRows);
  const columns = uniqueHeaders(Array.from({ length: columnCount }, (_, columnIndex) => {
    const parts = headerRows
      .map((rowIndex) => text(rows[rowIndex]?.[columnIndex]).replace(/\s+/g, ''))
      .filter(Boolean);
    return [...new Set(parts)].join('/');
  }));
  const dataRows = rows.slice(dataStart).map((values, index) => {
    const row = {};
    columns.forEach((column, columnIndex) => {
      row[column] = values[columnIndex] ?? '';
    });
    const destinationWarehouseSource = destinationWarehouseColumns
      ? {
          physical: values[destinationWarehouseColumns.physicalIndex] ?? '',
          virtual: destinationWarehouseColumns.virtualIndex >= 0
            ? values[destinationWarehouseColumns.virtualIndex] ?? ''
            : ''
        }
      : null;
    return { row, excelRow: dataStart + index + 1, destinationWarehouseSource };
  }).filter(({ row }) => Object.values(row).some((value) => text(value)));
  return { sheetName, kind, rows: dataRows, columns, skipped: false };
}

function valueFor(row, aliases, { contains = false } = {}) {
  const aliasKeys = aliases.map(compact);
  for (const [key, value] of Object.entries(row || {})) {
    const keyText = compact(key.replace(/_\d+$/, ''));
    const matched = aliasKeys.some((alias) => contains ? keyText.includes(alias) : keyText === alias);
    if (matched && text(value)) return text(value);
  }
  return '';
}

function firstValue(row, aliasGroups) {
  for (const aliases of aliasGroups) {
    const value = valueFor(row, aliases, { contains: true });
    if (value) return value;
  }
  return '';
}

function warehouseValue(value) {
  const normalized = text(value);
  return /^(?:\/|-|—|未填写)$/.test(normalized) ? '' : normalized;
}

function destinationWarehouseInfo(row, source) {
  const entries = Object.entries(row || {});
  const virtualWarehouse = entries.find(([key]) => compact(key).includes(compact('领星虚拟仓')));
  const destinationColumns = entries.filter(([key]) => compact(key.replace(/_\d+$/, '')) === compact('目的仓'));
  const physicalWarehouse = entries.find(([key]) => {
    const keyText = compact(key);
    return keyText.includes(compact('目的仓')) && !keyText.includes(compact('领星虚拟仓'));
  });
  const physicalValue = warehouseValue(source ? source.physical : physicalWarehouse?.[1]);
  const virtualValue = warehouseValue(source
    ? source.virtual
    : virtualWarehouse?.[1] ?? (destinationColumns.length > 1 ? destinationColumns[1][1] : ''));
  if (/^[A-Za-z]/.test(physicalValue)) {
    return { destinationWarehouse: physicalValue, inboundWarehouseType: 'FBA仓' };
  }
  if (virtualValue) {
    return { destinationWarehouse: virtualValue, inboundWarehouseType: 'FBM仓' };
  }
  return { destinationWarehouse: physicalValue, inboundWarehouseType: '' };
}

function sourceModifiedAt(workbook) {
  const value = workbook?.Props?.ModifiedDate || workbook?.Custprops?.ModifiedDate;
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : '';
}

function normalizeTransport(kind, row) {
  if (kind === 'air') return '空运';
  if (kind === 'foreignTrade') return '外贸直发';
  const source = valueFor(row, ['整柜/散货', '整柜散货'], { contains: true });
  if (source.includes('整柜')) return '整柜';
  if (source.includes('散货')) return '散货';
  return '未填写';
}

function normalizeFirstMileRow({ row, excelRow, destinationWarehouseSource, sheetName, kind, owner, fileName, modifiedAt }) {
  const destinationWarehouse = destinationWarehouseInfo(row, destinationWarehouseSource);
  const materialCode = firstValue(row, [
    ['发货单SKU+识别码/物料编码'],
    ['物料编码'],
    ['FBA货件SKU+识别码/物料编码']
  ]);
  const sourceSku = firstValue(row, [
    ['发货单SKU+识别码/库存SKU'],
    ['库存SKU'],
    ['FBA货件SKU+识别码/库存SKU'],
    ['MSKU']
  ]);
  const quantitySource = valueFor(row, ['小包装数量']);
  const quantity = parseQuantity(quantitySource);
  const listingAt = valueFor(row, ['上架时间']);
  const factoryShippedAt = valueFor(row, ['工厂发货时间'], { contains: true });
  const cargoStatus = kind === 'foreignTrade'
    ? (factoryShippedAt ? '外贸订单已发货' : '外贸订单未发货')
    : (listingAt ? '已上架' : '海上在途');
  const oaApprovalNo = valueFor(row, ['OA审批单号']);
  const shipmentNo = firstValue(row, [
    ['FBA货件号'],
    ['领星备/发货单号'],
    ['领星备货单号'],
    ['提单号/进仓单号']
  ]);
  const businessType = kind === 'air'
    ? '空运'
    : kind === 'foreignTrade'
      ? '外贸'
      : kind === 'accessory'
        ? '海外仓配件'
        : kind === 'historical'
          ? '历史头程'
          : '头程成品发货';
  return {
    id: `${fileName}|${sheetName}|${excelRow}`,
    businessType,
    transportMode: normalizeTransport(kind, row),
    cargoStatus,
    businessUnit: firstValue(row, [['所属事业部'], ['所属巴']]) || '未填写',
    storeName: valueFor(row, ['店铺', '店铺金蝶为准'], { contains: true }) || '未填写',
    ...destinationWarehouse,
    operatorName: valueFor(row, ['运营']) || '未填写',
    oaApprovalNo,
    materialCode,
    sourceSku,
    materialName: valueFor(row, ['中文名称']),
    msku: valueFor(row, ['MSKU']),
    fnsku: valueFor(row, ['FNSKU']),
    shipmentNo,
    quantity: quantity ?? 0,
    quantitySource,
    largePackageQty: parseQuantity(valueFor(row, ['大包装数量'])) ?? 0,
    expectedSailingAt: safeDate(valueFor(row, ['预计开船时间'])),
    actualSailingAt: safeDate(
      valueFor(row, ['开船时间'])
      || valueFor(row, ['航班（起飞日）', '航班起飞日'])
    ),
    expectedArrivalAt: safeDate(valueFor(row, ['预计到港时间'])),
    actualArrivalAt: safeDate(valueFor(row, ['到港时间'])),
    expectedDeliveryAt: safeDate(valueFor(row, ['预计派送时间'])),
    actualDeliveryAt: safeDate(valueFor(row, ['实际派送时间'])),
    listingAt: safeDate(listingAt),
    factoryShippedAt: safeDate(factoryShippedAt),
    sourceOwner: owner,
    sourceFile: fileName,
    sourceSheet: sheetName,
    sourceExcelRow: excelRow,
    sourceModifiedAt: modifiedAt,
    sourceFiles: [fileName],
    sourceSheets: [sheetName],
    parseIssue: quantity === null ? (quantitySource ? '小包装数量无法解析' : '小包装数量为空') : ''
  };
}

export function isFirstMileSlot(slotId) {
  return Object.prototype.hasOwnProperty.call(FIRST_MILE_SLOT_OWNERS, slotId);
}

export function firstMileOwner(slotId) {
  return FIRST_MILE_SLOT_OWNERS[slotId] || '未填写';
}

export function inspectFirstMileWorkbook(file) {
  if (!file?.buffer) throw new Error('未收到上传文件');
  const workbook = xlsx.read(file.buffer, { type: 'buffer', cellDates: true });
  const sheetPreviews = workbook.SheetNames.map((sheetName) => {
    const parsed = parsedSheet(sheetName, workbook.Sheets[sheetName]);
    return {
      sheetName,
      recognized: Boolean(parsed.kind),
      businessType: parsed.kind || '',
      columns: parsed.columns,
      rowCount: parsed.rows.length,
      previewRows: parsed.rows.slice(0, 8).map(({ row }) => row),
      headerRow: parsed.kind === 'air' ? 1 : parsed.kind === 'foreignTrade' ? 2 : parsed.kind ? 3 : 0
    };
  });
  const recognized = sheetPreviews.filter((sheet) => sheet.recognized);
  return {
    sheetNames: workbook.SheetNames,
    sheetPreviews,
    columns: recognized[0]?.columns || [],
    previewRows: recognized[0]?.previewRows || [],
    rowCount: recognized.reduce((sum, sheet) => sum + sheet.rowCount, 0),
    totalRowCount: recognized.reduce((sum, sheet) => sum + sheet.rowCount, 0),
    recognizedSheets: recognized.length,
    skippedSheets: sheetPreviews.filter((sheet) => !sheet.recognized).map((sheet) => sheet.sheetName)
  };
}

export function parseFirstMileWorkbook(file, { slotId, fileName }) {
  if (!file?.buffer) throw new Error('未收到上传文件');
  const workbook = xlsx.read(file.buffer, { type: 'buffer', cellDates: true });
  const owner = firstMileOwner(slotId);
  const modifiedAt = sourceModifiedAt(workbook);
  const parsedSheets = workbook.SheetNames.map((sheetName) => parsedSheet(sheetName, workbook.Sheets[sheetName]));
  const recognizedSheets = parsedSheets.filter((sheet) => sheet.kind);
  const normalizedRows = recognizedSheets.flatMap((sheet) => sheet.rows.map((entry) => normalizeFirstMileRow({
    ...entry,
    sheetName: sheet.sheetName,
    kind: sheet.kind,
    owner,
    fileName,
    modifiedAt
  })));
  const rows = normalizedRows.filter((row) => !row.parseIssue);
  const issues = normalizedRows.filter((row) => row.parseIssue).map((row) => ({
    sourceSheet: row.sourceSheet,
    sourceExcelRow: row.sourceExcelRow,
    reason: row.parseIssue,
    oaApprovalNo: row.oaApprovalNo,
    materialCode: row.materialCode,
    sourceSku: row.sourceSku,
    quantitySource: row.quantitySource
  }));
  return {
    rows,
    summary: {
      parserVersion: FIRST_MILE_PARSER_VERSION,
      owner,
      workbookModifiedAt: modifiedAt,
      recognizedSheets: recognizedSheets.map((sheet) => ({ sheetName: sheet.sheetName, businessType: sheet.kind, rowCount: sheet.rows.length })),
      skippedSheets: parsedSheets.filter((sheet) => !sheet.kind).map((sheet) => sheet.sheetName),
      parsedRows: normalizedRows.length,
      validRows: rows.length,
      issueRows: issues.length,
      issues
    },
    sheetNames: workbook.SheetNames
  };
}

export function reparseFirstMileSource({ slotId, fileName, sourceFile, mapping = {} } = {}) {
  const parserVersion = Number(mapping?.__firstMileSummary?.parserVersion || 0);
  if (parserVersion >= FIRST_MILE_PARSER_VERSION) return null;
  const buffer = sourceFile ? Buffer.from(sourceFile) : Buffer.alloc(0);
  if (!buffer.length) return null;
  const parsed = parseFirstMileWorkbook({ buffer }, { slotId, fileName });
  return {
    rows: parsed.rows,
    mapping: { ...mapping, __firstMileSummary: parsed.summary },
    sheetNames: parsed.sheetNames,
    selectedSheetNames: parsed.summary.recognizedSheets.map((sheet) => sheet.sheetName),
    summary: parsed.summary
  };
}

function completeness(row) {
  return [
    row.materialCode, row.sourceSku, row.materialName, row.shipmentNo,
    row.destinationWarehouse, row.inboundWarehouseType,
    row.expectedSailingAt, row.actualSailingAt, row.expectedArrivalAt, row.actualArrivalAt,
    row.expectedDeliveryAt, row.actualDeliveryAt, row.listingAt, row.factoryShippedAt
  ].filter((value) => text(value)).length;
}

function dedupeKey(row) {
  const product = text(row.materialCode) || text(row.sourceSku);
  const base = [row.businessType, row.oaApprovalNo, product, row.storeName].map(compact);
  if (!row.oaApprovalNo || !product) return '';
  const shipment = compact(row.shipmentNo);
  const fallback = [row.expectedSailingAt, row.actualSailingAt, row.quantity].map(compact).join('|');
  return [...base, shipment || fallback].join('|');
}

export function dedupeFirstMileRows(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = dedupeKey(row);
    if (!key) {
      groups.set(`source:${row.id}`, [row]);
      return;
    }
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  });
  const mergeGroup = (group) => {
    const sorted = [...group].sort((left, right) => (
      completeness(right) - completeness(left)
      || text(right.sourceModifiedAt).localeCompare(text(left.sourceModifiedAt))
      || text(right.sourceFile).localeCompare(text(left.sourceFile), 'zh-Hans-CN')
    ));
    const merged = { ...sorted[0] };
    const fields = new Set(sorted.flatMap((row) => Object.keys(row)));
    fields.forEach((field) => {
      if (text(merged[field]) || Array.isArray(merged[field])) return;
      const source = sorted.find((row) => text(row[field]));
      if (source) merged[field] = source[field];
    });
    merged.sourceFiles = [...new Set(sorted.flatMap((row) => row.sourceFiles || [row.sourceFile]).filter(Boolean))];
    merged.sourceSheets = [...new Set(sorted.flatMap((row) => row.sourceSheets || [row.sourceSheet]).filter(Boolean))];
    merged.duplicateCount = sorted.length;
    merged.cargoStatus = merged.businessType === '外贸'
      ? (merged.factoryShippedAt ? '外贸订单已发货' : '外贸订单未发货')
      : (merged.listingAt ? '已上架' : '海上在途');
    return merged;
  };
  return [...groups.values()].flatMap((group) => {
    if (group.length === 1) return group;
    const byFile = new Map();
    group.forEach((row) => {
      const fileRows = byFile.get(row.sourceFile) || [];
      fileRows.push(row);
      byFile.set(row.sourceFile, fileRows);
    });
    if (byFile.size === 1) return group;
    const orderedFiles = [...byFile.values()].map((fileRows) => (
      [...fileRows].sort((left, right) => Number(left.sourceExcelRow || 0) - Number(right.sourceExcelRow || 0))
    ));
    const resultCount = Math.max(...orderedFiles.map((fileRows) => fileRows.length));
    return Array.from({ length: resultCount }, (_, index) => {
      const candidates = orderedFiles.map((fileRows) => fileRows[index]).filter(Boolean);
      return mergeGroup(candidates);
    });
  });
}
