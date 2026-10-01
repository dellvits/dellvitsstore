import { readFile, readdir } from 'node:fs/promises';
import { db } from './db.js';

const directory = new URL('../../../supabase/migrations/', import.meta.url);
try {
  // Every migration is safe to re-run, so all of them are applied in file-name order.
  for (const file of (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(file, directory), 'utf8'));
    console.log('Applied ' + file);
  }
  console.log('Supabase schema is ready. Run bootstrap once to create your administrator.');
} finally {
  await db.close();
}
