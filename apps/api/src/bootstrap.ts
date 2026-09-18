import './platform.js';
import { randomUUID } from 'node:crypto';
import { one, run, transaction, db } from './db.js';
import { hashPassword } from './security.js';
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !password || password.length < 12) {
  throw new Error(
    'Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) before running bootstrap.',
  );
}
if (one('SELECT user_id FROM admin_access WHERE super=1'))
  throw new Error('A super administrator already exists. Bootstrap does not overwrite accounts.');
transaction(() => {
  const id = randomUUID();
  run(
    "INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,'admin',?)",
    id,
    process.env.ADMIN_NAME || 'Store owner',
    email,
    hashPassword(password),
    new Date().toISOString(),
  );
  run("INSERT INTO admin_access VALUES(?,1,'[]')", id);
});
db.close();
console.log('Super administrator created. Sign in at /admin/login.');
