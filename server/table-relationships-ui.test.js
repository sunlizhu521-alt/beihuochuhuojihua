import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');

test('数据关系图注册到系统操作导航并按权限挂载', () => {
  assert.match(appSource, /import React, \{ Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState \} from 'react'/);
  assert.match(appSource, /'operationLogs',\s*'tableRelationships'/);
  assert.match(appSource, /tableRelationships: '数据关系图'/);
  assert.match(appSource, /title: '采购跟单', pages: \[[^\]]*'operationLogs'/);
  assert.match(appSource, /title: '系统操作', pages: \['permissions', 'tableRelationships'\]/);
  assert.match(appSource, /shouldMount\('tableRelationships'\)[\s\S]*?<DataRelationshipsPage token=\{token\} \/>/);
});

test('数据关系图展示实时表行数、分组筛选和关联明细', () => {
  const pageSource = appSource.slice(
    appSource.indexOf('function DataRelationshipsPage('),
    appSource.indexOf('function App()')
  );

  assert.match(pageSource, /fetch\('\/api\/table-relationships', \{ headers: \{ Authorization: 'Bearer ' \+ token \} \}\)/);
  assert.match(pageSource, /setInterval\(load, 30000\)/);
  assert.match(pageSource, /clearInterval\(refreshRef\.current\)/);
  assert.match(pageSource, /tables\.filter\(t => t\.group === selectedGroup\)/);
  assert.match(pageSource, /React\.createElement\('svg'/);
  assert.match(pageSource, /markerEnd: 'url\(#arrowhead\)'/);
  assert.match(pageSource, /t\.rowCount\.toLocaleString\(\) \+ ' 行'/);
  assert.match(pageSource, /'全部关联关系明细'/);
  ['源表', '源字段', '关系', '目标表', '目标字段'].forEach((label) => {
    assert.match(pageSource, new RegExp(`'${label}'`));
  });
});
