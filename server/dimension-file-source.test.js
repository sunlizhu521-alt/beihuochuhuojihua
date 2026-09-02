import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';

test('维度文件原始二进制可保存、读取并持久化，空文件保持未保存状态', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gendanjindu-dimension-source-'));
  process.env.DATA_DIR = dataDir;
  try {
    const database = await import(`./database.js?dimension-source-test=${Date.now()}`);
    await database.initDatabase();
    const columns = database.all('PRAGMA table_info(dimension_files)').map((row) => row.name);
    assert.ok(columns.includes('source_file'));
    assert.ok(columns.includes('source_file_mime'));
    assert.ok(columns.includes('source_file_size'));

    const bytes = new Uint8Array([80, 75, 3, 4]);
    database.run(
      `INSERT INTO dimension_files (
         slot_id, title, file_name, mapping_json, rows_json,
         source_file, source_file_mime, source_file_size,
         applied, uploaded_by, updated_at
       ) VALUES (?, ?, ?, '{}', '[]', ?, ?, ?, 1, ?, ?)`,
      ['firstMileData1', '张婷婷头程数据', '头程数据.xlsx', bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes.length, '测试用户', '2026-09-01 10:00:00']
    );
    database.run(
      `INSERT INTO dimension_files (
         slot_id, title, file_name, mapping_json, rows_json,
         source_file_size, applied, uploaded_by, updated_at
       ) VALUES (?, ?, ?, '{}', '[]', 0, 1, ?, ?)`,
      ['firstMileData2', '扈翠芸头程数据', '旧文件.xlsx', '测试用户', '2026-09-01 10:00:00']
    );
    database.saveDatabase();

    const saved = database.get('SELECT source_file, source_file_size FROM dimension_files WHERE slot_id = ?', ['firstMileData1']);
    assert.deepEqual([...saved.source_file], [...bytes]);
    assert.equal(saved.source_file_size, bytes.length);
    const legacy = database.get('SELECT source_file, source_file_size FROM dimension_files WHERE slot_id = ?', ['firstMileData2']);
    assert.equal(legacy.source_file, null);
    assert.equal(legacy.source_file_size, 0);

    const SQL = await initSqlJs();
    const persisted = new SQL.Database(fs.readFileSync(path.join(dataDir, 'gendanjindu.sqlite')));
    const result = persisted.exec("SELECT source_file_size, length(source_file) FROM dimension_files WHERE slot_id = 'firstMileData1'");
    assert.deepEqual(result[0].values[0], [bytes.length, bytes.length]);
    persisted.close();
  } finally {
    delete process.env.DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
