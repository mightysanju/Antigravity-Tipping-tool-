import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { asRole } from '../db/localPgliteBootstrap.ts';

export interface AuthCaller {
  uid: string;
  email?: string;
  jwt?: string;
}

export interface DbAdapter {
  callRpc<T>(
    caller: AuthCaller,
    rpcName: string,
    namedArgs: Record<string, unknown>,
    orderedArgs: unknown[]
  ): Promise<T>;
  callAnonRpc<T>(
    rpcName: string,
    namedArgs: Record<string, unknown>,
    orderedArgs: unknown[]
  ): Promise<T>;
  callServiceRpc<T>(
    rpcName: string,
    namedArgs: Record<string, unknown>,
    orderedArgs: unknown[]
  ): Promise<T>;
  createAuthUser?(email: string, password: string, name: string): Promise<string>;
  uploadPrivateObject?(
    bucket: string,
    objectPath: string,
    body: Buffer,
    contentType: string
  ): Promise<void>;
  getStoredObject?(bucket: string, objectPath: string): Promise<Buffer | null>;
  createSignedStorageUrl?(
    bucket: string,
    objectPath: string,
    expiresInSeconds?: number
  ): Promise<string | null>;
}

export class PgliteDbAdapter implements DbAdapter {
  private readonly db: PGlite;
  private readonly objectStore = new Map<string, Buffer>();

  constructor(db: PGlite) {
    this.db = db;
  }

  private assertSafeRpcName(rpcName: string) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(rpcName)) {
      throw new Error(`INVALID_RPC_NAME: ${rpcName}`);
    }
  }

  async callRpc<T>(
    caller: AuthCaller,
    rpcName: string,
    _namedArgs: Record<string, unknown>,
    orderedArgs: unknown[]
  ): Promise<T> {
    this.assertSafeRpcName(rpcName);
    const placeholders = orderedArgs.map((_, idx) => `$${idx + 1}`).join(', ');
    const sql = `SELECT public.${rpcName}(${placeholders}) AS result`;

    return asRole(this.db, { role: 'authenticated', uid: caller.uid }, async (tx) => {
      const res = await tx.query<{ result: T }>(sql, orderedArgs);
      return res.rows[0]?.result as T;
    });
  }

  async callAnonRpc<T>(
    rpcName: string,
    _namedArgs: Record<string, unknown>,
    orderedArgs: unknown[]
  ): Promise<T> {
    this.assertSafeRpcName(rpcName);
    const placeholders = orderedArgs.map((_, idx) => `$${idx + 1}`).join(', ');
    const sql = `SELECT public.${rpcName}(${placeholders}) AS result`;

    return asRole(this.db, { role: 'anon' }, async (tx) => {
      const res = await tx.query<{ result: T }>(sql, orderedArgs);
      return res.rows[0]?.result as T;
    });
  }

  async callServiceRpc<T>(
    rpcName: string,
    _namedArgs: Record<string, unknown>,
    orderedArgs: unknown[]
  ): Promise<T> {
    this.assertSafeRpcName(rpcName);
    const placeholders = orderedArgs.map((_, idx) => `$${idx + 1}`).join(', ');
    const sql = `SELECT public.${rpcName}(${placeholders}) AS result`;
    const res = await this.db.query<{ result: T }>(sql, orderedArgs);
    return res.rows[0]?.result as T;
  }

  async createAuthUser(email: string, _password: string): Promise<string> {
    const normalized = email.trim().toLowerCase();
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM auth.users WHERE lower(email) = $1 LIMIT 1`,
      [normalized]
    );
    if (existing.rows[0]) {
      return existing.rows[0].id;
    }
    const id = crypto.randomUUID();
    await this.db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, normalized]);
    return id;
  }

  async uploadPrivateObject(
    bucket: string,
    objectPath: string,
    body: Buffer
  ): Promise<void> {
    this.objectStore.set(`${bucket}:${objectPath}`, body);
  }

  async getStoredObject(bucket: string, objectPath: string): Promise<Buffer | null> {
    return this.objectStore.get(`${bucket}:${objectPath}`) ?? null;
  }

  async createSignedStorageUrl(bucket: string, objectPath: string): Promise<string | null> {
    if (!this.objectStore.has(`${bucket}:${objectPath}`)) {
      return null;
    }
    return `/api/dev/storage-object?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(objectPath)}`;
  }
}

export class SupabaseUserDbAdapter implements DbAdapter {
  private readonly supabaseUrl: string;
  private readonly anonKey: string;
  private readonly serviceRoleKey: string;

  constructor(supabaseUrl: string, anonKey: string, serviceRoleKey: string) {
    this.supabaseUrl = supabaseUrl;
    this.anonKey = anonKey;
    this.serviceRoleKey = serviceRoleKey;
  }

  async callRpc<T>(
    caller: AuthCaller,
    rpcName: string,
    namedArgs: Record<string, unknown>
  ): Promise<T> {
    if (!caller.jwt) {
      throw new Error('AUTH_REQUIRED');
    }
    const userClient = createClient(this.supabaseUrl, this.anonKey, {
      global: { headers: { Authorization: `Bearer ${caller.jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await userClient.rpc(rpcName, namedArgs);
    if (error) {
      throw new Error(`${error.code ?? 'RPC_ERROR'}: ${error.message}`);
    }
    return data as T;
  }

  async callAnonRpc<T>(
    rpcName: string,
    namedArgs: Record<string, unknown>
  ): Promise<T> {
    const anonClient = createClient(this.supabaseUrl, this.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anonClient.rpc(rpcName, namedArgs);
    if (error) {
      throw new Error(`${error.code ?? 'RPC_ERROR'}: ${error.message}`);
    }
    return data as T;
  }

  async callServiceRpc<T>(
    rpcName: string,
    namedArgs: Record<string, unknown>
  ): Promise<T> {
    const admin = createClient(this.supabaseUrl, this.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc(rpcName, namedArgs);
    if (error) {
      throw new Error(`${error.code ?? 'RPC_ERROR'}: ${error.message}`);
    }
    return data as T;
  }

  async createAuthUser(email: string, password: string, name: string): Promise<string> {
    const admin = createClient(this.supabaseUrl, this.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error || !data.user) {
      throw new Error(`AUTH_CREATE_USER_ERROR: ${error?.message || 'Failed'}`);
    }
    return data.user.id;
  }

  async uploadPrivateObject(
    bucket: string,
    objectPath: string,
    body: Buffer,
    contentType: string
  ): Promise<void> {
    const admin = createClient(this.supabaseUrl, this.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin.storage.from(bucket).upload(objectPath, body, {
      contentType,
      upsert: false,
    });
    if (error) {
      throw new Error(`STORAGE_UPLOAD_ERROR: ${error.message}`);
    }
  }

  async getStoredObject(bucket: string, objectPath: string): Promise<Buffer | null> {
    const admin = createClient(this.supabaseUrl, this.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.storage.from(bucket).download(objectPath);
    if (error || !data) return null;
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async createSignedStorageUrl(
    bucket: string,
    objectPath: string,
    expiresInSeconds = 3600
  ): Promise<string | null> {
    const admin = createClient(this.supabaseUrl, this.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUrl(objectPath, expiresInSeconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }
}
