import xlsx from 'xlsx';

export const PRODUCT_PROJECT_PRIMARY_SHEET = '（整机）在研项目-绝对创新+微创新';

export const PRODUCT_PROJECT_OUTPUT_COLUMNS = [
  '项目名称',
  '优先级',
  '创新类型',
  '当前阶段',
  '责任部门',
  '项目负责人',
  '技术对接人',
  '供应链对接人',
  '生产商（已重新盘点）',
  '项目类型',
  '产品线',
  '1-需求立项',
  '最新周会纪要'
];

const HEADER_SCAN_ROWS = 15;
const WEEKLY_NOTE_PATTERN = /(?:周会纪要|周会记录|会议纪要)/;

function text(value) {
  return String(value ?? '').normalize('NFKC').replace(/\u00a0/g, ' ').trim();
}

function compact(value) {
  return text(value).replace(/[\s_\-—－:：()（）/\\]+/g, '').toLowerCase();
}

function dateParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return '';
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function excelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return dateParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = xlsx.SSF.parse_date_code(value);
    return parsed ? dateParts(parsed.y, parsed.m, parsed.d) : '';
  }
  const source = text(value);
  if (!source) return '';
  let match = source.match(/(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?/);
  if (match) return dateParts(match[1], match[2], match[3]);
  match = source.match(/\b(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(20\d{2}|\d{2})\b/);
  if (match) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    return dateParts(year, match[1], match[2]);
  }
  return '';
}

function findHeaderIndex(aoa) {
  for (let rowIndex = 0; rowIndex < Math.min(HEADER_SCAN_ROWS, aoa.length); rowIndex += 1) {
    const headers = (aoa[rowIndex] || []).map(compact);
    if (headers.includes('项目名称') && headers.includes('当前阶段') && headers.includes('责任部门')) return rowIndex;
  }
  return -1;
}

function columnIndex(headers, aliases) {
  const normalizedAliases = aliases.map(compact);
  return headers.findIndex((header) => normalizedAliases.includes(compact(header)));
}

function valueAt(row, index) {
  return index >= 0 ? row[index] : '';
}

function mergedValue(sheet, rowIndex, columnIndexValue, fallback) {
  if (text(fallback)) return fallback;
  const merge = (sheet['!merges'] || []).find(({ s, e }) => (
    rowIndex >= s.r && rowIndex <= e.r && columnIndexValue >= s.c && columnIndexValue <= e.c
  ));
  if (!merge) return fallback;
  return sheet[xlsx.utils.encode_cell(merge.s)]?.v ?? fallback;
}

function displayedCellValue(sheet, rowIndex, columnIndexValue, fallback) {
  if (columnIndexValue < 0) return fallback;
  const cell = sheet[xlsx.utils.encode_cell({ r: rowIndex, c: columnIndexValue })];
  return text(cell?.w) || cell?.v || fallback;
}

function projectStatus(stage) {
  const value = text(stage);
  if (/已完结|已完成|完成/.test(value)) return '已完成';
  if (/终止|取消/.test(value)) return '已终止';
  if (/暂停|搁置/.test(value)) return '已暂停';
  return '进行中';
}

function projectRemark({ pending, weeklyHeader, weeklyNote, priority, projectType, productLine }) {
  const parts = [];
  if (text(priority)) parts.push(`优先级：${text(priority)}`);
  if (text(projectType)) parts.push(`项目类型：${text(projectType)}`);
  if (text(productLine)) parts.push(`产品线：${text(productLine)}`);
  if (text(pending)) parts.push(`项目待办：${text(pending)}`);
  if (text(weeklyNote)) parts.push(`${text(weeklyHeader) || '最新周会纪要'}：${text(weeklyNote)}`);
  return parts.join('；');
}

function findWorkbookUpdateDate(aoa, headerIndex) {
  for (let rowIndex = 0; rowIndex < Math.min(headerIndex, 6); rowIndex += 1) {
    for (const value of aoa[rowIndex] || []) {
      const normalized = excelDate(value);
      if (normalized) return normalized;
    }
  }
  return '';
}

function createSummary({ sheetNames, headerIndex, sourceRowCount, rows, skippedRows, issues, workbookUpdateDate }) {
  return {
    parserType: 'productProject',
    parserVersion: 1,
    primarySheet: PRODUCT_PROJECT_PRIMARY_SHEET,
    sheetNames,
    headerRow: headerIndex + 1,
    sourceRowCount,
    validRows: rows.length,
    rowCount: rows.length,
    skippedRows,
    issueRows: issues.length,
    issues: issues.slice(0, 100),
    workbookUpdateDate
  };
}

export function parseProductProjectWorkbook(file) {
  if (!file?.buffer) throw Object.assign(new Error('未收到产品项目文件'), { status: 400 });
  const workbook = xlsx.read(file.buffer, {
    type: 'buffer',
    cellDates: true,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    WTF: false
  });
  const sheetName = workbook.SheetNames.find((name) => text(name) === text(PRODUCT_PROJECT_PRIMARY_SHEET));
  if (!sheetName) {
    const error = new Error(`未找到重点工作表“${PRODUCT_PROJECT_PRIMARY_SHEET}”，请上传包含该工作表的产品项目文件`);
    error.status = 400;
    error.publicMessage = error.message;
    throw error;
  }
  const sheet = workbook.Sheets[sheetName];
  const aoa = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: true });
  const headerIndex = findHeaderIndex(aoa);
  if (headerIndex < 0) {
    const error = new Error(`工作表“${PRODUCT_PROJECT_PRIMARY_SHEET}”前 ${HEADER_SCAN_ROWS} 行未识别到项目表头`);
    error.status = 400;
    error.publicMessage = error.message;
    throw error;
  }

  const headers = aoa[headerIndex] || [];
  const indexes = {
    group: 0,
    projectName: columnIndex(headers, ['项目名称']),
    priority: columnIndex(headers, ['优先级']),
    innovationType: columnIndex(headers, ['创新类型']),
    currentStage: columnIndex(headers, ['当前阶段']),
    responsibilityDepartment: columnIndex(headers, ['责任部门']),
    owner: columnIndex(headers, ['项目负责人']),
    technicalContact: columnIndex(headers, ['技术对接人']),
    supplyChainContact: columnIndex(headers, ['供应链对接人']),
    manufacturer: columnIndex(headers, ['生产商（已重新盘点）', '生产商']),
    projectType: columnIndex(headers, ['项目类型']),
    productLine: columnIndex(headers, ['产品线']),
    demandInitiation: columnIndex(headers, ['1-需求立项']),
    trialProduction: columnIndex(headers, ['9-试产（供应链）', '9-试产(供应链)', '9-试产']),
    projectFile: columnIndex(headers, ['项目文件']),
    pending: columnIndex(headers, ['项目待办'])
  };
  const weeklyColumns = headers
    .map((header, index) => ({ header: text(header), index }))
    .filter(({ header }) => WEEKLY_NOTE_PATTERN.test(header));
  const currentWeeklyColumn = weeklyColumns.find(({ header }) => compact(header).startsWith('本周周会纪要')) || weeklyColumns[0];
  const workbookUpdateDate = findWorkbookUpdateDate(aoa, headerIndex);
  const rows = [];
  const issues = [];
  let sourceRowCount = 0;
  let skippedRows = 0;

  for (let rowIndex = headerIndex + 1; rowIndex < aoa.length; rowIndex += 1) {
    const sourceRow = aoa[rowIndex] || [];
    const name = text(valueAt(sourceRow, indexes.projectName));
    if (!name) continue;
    sourceRowCount += 1;
    const stage = text(valueAt(sourceRow, indexes.currentStage));
    const owner = text(valueAt(sourceRow, indexes.owner));
    const responsibility = text(mergedValue(sheet, rowIndex, indexes.responsibilityDepartment, valueAt(sourceRow, indexes.responsibilityDepartment)));
    const group = text(mergedValue(sheet, rowIndex, indexes.group, valueAt(sourceRow, indexes.group)));
    if (!stage && !owner && !responsibility && !group) {
      skippedRows += 1;
      continue;
    }
    const weekly = currentWeeklyColumn;
    const priority = text(mergedValue(sheet, rowIndex, indexes.priority, valueAt(sourceRow, indexes.priority)));
    const innovationType = text(mergedValue(sheet, rowIndex, indexes.innovationType, valueAt(sourceRow, indexes.innovationType)));
    const projectType = text(mergedValue(sheet, rowIndex, indexes.projectType, valueAt(sourceRow, indexes.projectType)));
    const productLine = text(mergedValue(sheet, rowIndex, indexes.productLine, valueAt(sourceRow, indexes.productLine)));
    const businessUnit = responsibility || group || '未分配事业部';
    const demandInitiationValue = displayedCellValue(
      sheet,
      rowIndex,
      indexes.demandInitiation,
      valueAt(sourceRow, indexes.demandInitiation)
    );
    const trialProductionValue = displayedCellValue(
      sheet,
      rowIndex,
      indexes.trialProduction,
      valueAt(sourceRow, indexes.trialProduction)
    );
    rows.push({
      projectName: name,
      businessUnit,
      productPositioning: innovationType,
      projectStage: stage,
      owner,
      plannedLaunchDate: excelDate(trialProductionValue),
      projectStatus: projectStatus(stage),
      remark: projectRemark({
        pending: valueAt(sourceRow, indexes.pending),
        weeklyHeader: weekly?.header,
        weeklyNote: weekly ? valueAt(sourceRow, weekly.index) : '',
        priority,
        projectType,
        productLine
      }),
      materialCode: '',
      sku: '',
      modifiedAt: workbookUpdateDate,
      priority,
      innovationType,
      productLine,
      projectType,
      demandInitiationDate: excelDate(demandInitiationValue),
      responsibilityDepartment: responsibility,
      technicalContact: text(valueAt(sourceRow, indexes.technicalContact)),
      supplyChainContact: text(valueAt(sourceRow, indexes.supplyChainContact)),
      manufacturer: text(valueAt(sourceRow, indexes.manufacturer)),
      weeklyMeetingTitle: weekly?.header || '',
      weeklyMeetingNote: weekly ? text(valueAt(sourceRow, weekly.index)) : '',
      projectFile: text(valueAt(sourceRow, indexes.projectFile)),
      sourceSheet: sheetName,
      sourceExcelRow: rowIndex + 1
    });
  }

  if (!rows.length) {
    const error = new Error(`工作表“${PRODUCT_PROJECT_PRIMARY_SHEET}”未解析到有效产品项目`);
    error.status = 400;
    error.publicMessage = error.message;
    throw error;
  }
  const summary = createSummary({
    sheetNames: workbook.SheetNames,
    headerIndex,
    sourceRowCount,
    rows,
    skippedRows,
    issues,
    workbookUpdateDate
  });
  return {
    sheetName,
    sheetNames: workbook.SheetNames,
    columns: PRODUCT_PROJECT_OUTPUT_COLUMNS,
    previewRows: rows.slice(0, 8),
    rowCount: rows.length,
    totalRowCount: rows.length,
    headerRow: headerIndex + 1,
    rows,
    sheets: [{ sheetName, rows, columns: PRODUCT_PROJECT_OUTPUT_COLUMNS, headerRow: headerIndex + 1 }],
    sheetPreviews: [{
      sheetName,
      columns: PRODUCT_PROJECT_OUTPUT_COLUMNS,
      rowCount: rows.length,
      previewRows: rows.slice(0, 8),
      headerRow: headerIndex + 1
    }],
    summary,
    mapping: { __productProject: summary }
  };
}

export function inspectProductProjectWorkbook(file) {
  const parsed = parseProductProjectWorkbook(file);
  return {
    sheetNames: parsed.sheetNames,
    sheetPreviews: parsed.sheetPreviews,
    columns: parsed.columns,
    previewRows: parsed.previewRows,
    rowCount: parsed.rowCount,
    totalRowCount: parsed.totalRowCount,
    headerRow: parsed.headerRow,
    autoParsed: true,
    parseSummary: parsed.summary
  };
}
