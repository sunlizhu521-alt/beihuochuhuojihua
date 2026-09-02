import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { all, get, initDatabase, run, saveDatabase } from '../server/database.js';

const ADMIN_NAME = process.env.ADMIN_NAME || '孙立柱';
const ROLE_ADMIN = '管理员';
const password = process.env.ADMIN_RESET_PASSWORD;

if (!password) {
  throw new Error('ADMIN_RESET_PASSWORD is required.');
}

await initDatabase();

const nowText = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const now = nowText();
const hash = await bcrypt.hash(password, 10);
const user = get('SELECT * FROM users WHERE name = ?', [ADMIN_NAME]);
const pageAccess = JSON.stringify(['dashboard', 'progressRefresh', 'trace', 'differenceAllocation', 'inventory', 'kingdeeImport', 'dimensionLibrary', 'permissions']);

if (user) {
  run(
    'UPDATE users SET password_hash = ?, role = ?, page_access = ?, updated_at = ? WHERE name = ?',
    [hash, ROLE_ADMIN, pageAccess, now, ADMIN_NAME]
  );
} else {
  run(
    'INSERT INTO users (id, name, password_hash, role, page_access, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), ADMIN_NAME, hash, ROLE_ADMIN, pageAccess, now, now]
  );
}

run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE name = ?)', [ADMIN_NAME]);
saveDatabase();

const count = all('SELECT id FROM users WHERE name = ?', [ADMIN_NAME]).length;
console.log(`Admin password reset complete for ${ADMIN_NAME}. users=${count}`);
