import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationTables, all, one, run, transaction, db } from './db.js';
import { objects } from './storage.js';

/** One-time cutover tool. The old SQLite database is always opened read-only. */
export async function importLocal(sqlitePath: string, uploadPath: string) {
  const source = new DatabaseSync(resolve(sqlitePath), { readOnly: true });
  try {
    const names = new Set(
      source
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row) => row.name),
    );
    if (!names.has('users') || !names.has('orders') || !names.has('locations'))
      throw new Error('This file is not a Dellvit database.');
    const tables = applicationTables.filter((name) => name !== 'rate_limits' && names.has(name));
    const rows = new Map(
      tables.map((name) => [name, source.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]),
    );
    async function assertEmpty() {
      for (const name of applicationTables.filter((name) => name !== 'rate_limits')) {
        const where =
          name === 'platform_records' ? " WHERE NOT (kind='payments' AND id='cod')" : '';
        if ((await one(`SELECT COUNT(*) n FROM ${name}${where}`))!.n)
          throw new Error(
            'Import requires a fresh Supabase schema. It will not merge into or overwrite an existing store.',
          );
      }
    }
    await assertEmpty();
    const files = new Map<string, { path: string; type: string }>();
    const directory = resolve(uploadPath);
    for (const records of rows.values()) {
      for (const record of records) {
        for (const value of Object.values(record)) {
          if (typeof value !== 'string') continue;
          for (const match of value.matchAll(/\/api\/media\/([\da-f-]+\.webp)/g))
            files.set('images/' + match[1], {
              path: resolve(directory, match[1]),
              type: 'image/webp',
            });
        }
      }
    }
    for (const row of rows.get('documents') || []) {
      const filename = String(row.filename);
      if (!/^[\da-f-]+\.pdf$/.test(filename)) throw new Error('Invalid legacy document filename.');
      files.set('documents/' + filename, {
        path: resolve(directory, filename),
        type: 'application/pdf',
      });
    }
    for (const row of rows.get('payment_proofs') || []) {
      const filename = String(row.filename);
      if (!/^[\da-f-]+\.webp$/.test(filename)) throw new Error('Invalid legacy receipt filename.');
      files.set('proofs/' + filename, {
        path: resolve(directory, 'proofs', filename),
        type: 'image/webp',
      });
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && /^[\da-f-]+\.webp$/.test(entry.name))
        files.set('images/' + entry.name, {
          path: resolve(directory, entry.name),
          type: 'image/webp',
        });
    }
    // Check all referenced files before uploading any objects or inserting any rows.
    for (const [key, file] of files) {
      const info = await stat(file.path);
      if (!info.isFile()) throw new Error(`Legacy upload is not a file: ${key}`);
      if (info.size > 4 * 1024 * 1024)
        throw new Error(
          `Legacy upload exceeds the 4 MiB limit: ${key}. Compress it before import.`,
        );
    }
    for (const [key, file] of files) {
      const body = await readFile(file.path);
      const existing = await objects.get(key);
      if (existing && !existing.body.equals(body))
        throw new Error(`R2 already contains different content at ${key}.`);
      if (!existing) await objects.put(key, body, file.type);
    }
    let count = 0;
    await transaction(async () => {
      await assertEmpty();
      for (const name of tables) {
        const columns = new Set(
          (
            await all(
              'SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name=?',
              'dellvit',
              name,
            )
          ).map((row) => row.column_name),
        );
        for (const row of rows.get(name)!) {
          const keys = Object.keys(row);
          if (keys.some((key) => !/^[a-z_][a-z_0-9]*$/.test(key) || !columns.has(key)))
            throw new Error(`Unsupported legacy columns in ${name}.`);
          const conflict =
            name === 'platform_records'
              ? ' ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data'
              : '';
          await run(
            `INSERT INTO ${name}(${keys.map((key) => '"' + key + '"').join(',')}) VALUES(${keys.map(() => '?').join(',')})${conflict}`,
            ...keys.map((key) => row[key]),
          );
          count++;
        }
      }
    });
    return { rows: count, files: files.size };
  } finally {
    source.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.env.SQLITE_IMPORT_PATH || !process.env.LOCAL_UPLOAD_DIR)
      throw new Error(
        'Set SQLITE_IMPORT_PATH and LOCAL_UPLOAD_DIR to the old database and upload directory.',
      );
    const result = await importLocal(process.env.SQLITE_IMPORT_PATH, process.env.LOCAL_UPLOAD_DIR);
    console.log(
      `Imported ${result.rows} rows and ${result.files} files. Existing account passwords are preserved.`,
    );
  } finally {
    await db.close();
  }
}
