import fs from 'node:fs/promises';
import path from 'node:path';
import { PGlite, type Transaction } from '@electric-sql/pglite';

const ROOT_DIR = import.meta.dirname
  ? path.resolve(import.meta.dirname, '..', '..', '..')
  : '.';

export const SEED_IDS = {
  users: {
    superAdmin: '00000000-0000-0000-0000-000000000001',
    adminA: '00000000-0000-0000-0000-000000000010',
    deptManagerA: '00000000-0000-0000-0000-000000000011',
    maria: '00000000-0000-0000-0000-000000000012',
    elena: '00000000-0000-0000-0000-000000000013',
    carlos: '00000000-0000-0000-0000-000000000014',
    adminB: '00000000-0000-0000-0000-000000000020',
  },
  properties: {
    palomaA: '10000000-0000-0000-0000-000000000001',
    harborB: '10000000-0000-0000-0000-000000000002',
    timberC: '10000000-0000-0000-0000-000000000003',
  },
  departments: {
    housekeepingA: '20000000-0000-0000-0000-000000000001',
    frontDeskA: '20000000-0000-0000-0000-000000000002',
    valetA: '20000000-0000-0000-0000-000000000003',
    housekeepingB: '20000000-0000-0000-0000-000000000004',
  },
  people: {
    adminA: '30000000-0000-0000-0000-000000000001',
    deptManagerA: '30000000-0000-0000-0000-000000000002',
    maria: '30000000-0000-0000-0000-000000000003',
    elena: '30000000-0000-0000-0000-000000000004',
    carlos: '30000000-0000-0000-0000-000000000005',
    liamUnclaimed: '30000000-0000-0000-0000-000000000006',
    adminB: '30000000-0000-0000-0000-000000000007',
    hannahB: '30000000-0000-0000-0000-000000000008',
  },
  rooms: {
    r101: '40000000-0000-0000-0000-000000000101',
    r102: '40000000-0000-0000-0000-000000000102',
    r412: '40000000-0000-0000-0000-000000000412',
    r201B: '40000000-0000-0000-0000-000000000201',
  },
} as const;

const SUPABASE_TEST_SHIM = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '');
$$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::JSONB;
$$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT NOT NULL REFERENCES storage.buckets(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated;
GRANT ALL ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets TO authenticated;
`;

export async function createSeededLocalDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_TEST_SHIM);

  const migrationsDir = path.join(ROOT_DIR, 'supabase', 'migrations');
  const files = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    await db.exec(sql);
  }

  const seedSql = await fs.readFile(path.join(ROOT_DIR, 'supabase', 'seed.sql'), 'utf8');
  await db.exec(seedSql);

  return db;
}

export async function queryWithSavepoint<T = Record<string, unknown>>(
  tx: Transaction,
  sql: string,
  params: unknown[] = []
) {
  await tx.exec('SAVEPOINT sp_test;');
  try {
    const res = await tx.query<T>(sql, params);
    await tx.exec('RELEASE SAVEPOINT sp_test;');
    return res;
  } catch (err) {
    await tx.exec('ROLLBACK TO SAVEPOINT sp_test;');
    await tx.exec('RELEASE SAVEPOINT sp_test;');
    throw err;
  }
}

export async function asRole<T>(
  db: PGlite,
  session: { role: 'anon' | 'authenticated'; uid?: string; claims?: Record<string, unknown> },
  fn: (tx: Transaction) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${session.role};`);
    await tx.query(`SELECT set_config('request.jwt.claim.role', $1, true)`, [session.role]);
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [session.uid ?? '']);
    await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(session.claims ?? {}),
    ]);
    return fn(tx);
  });
}
