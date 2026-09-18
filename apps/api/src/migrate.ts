import { readFile } from 'node:fs/promises';
import { db } from './db.js';

try {
  const schema = await readFile(
    new URL('../../../supabase/migrations/202609180001_initial.sql', import.meta.url),
    'utf8',
  );
  await db.exec(schema);
  console.log('Supabase schema is ready. Run bootstrap once to create your administrator.');
} finally {
  await db.close();
}
