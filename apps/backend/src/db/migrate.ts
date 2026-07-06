import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

async function migrate(): Promise<void> {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    process.stdout.write(`→ applying ${file} ... `);
    await pool.query(sql);
    process.stdout.write('ok\n');
  }
  process.stdout.write('migrations complete\n');
  await pool.end();
}

migrate().catch((err) => {
  console.error('migration failed:', err);
  process.exit(1);
});
