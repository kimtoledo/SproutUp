import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assertStorageKey, createInMemoryFileStorage } from '../src/storage/file-storage.js';
import { createLocalFileStorage } from '../src/storage/local-file-storage.js';

describe('assertStorageKey', () => {
  it('accepts our generated id shape', () => {
    expect(() => assertStorageKey('a1b2c3d4-0000-4000-8000-000000000000')).not.toThrow();
  });

  it('rejects path traversal and separators', () => {
    for (const bad of ['../etc/passwd', 'a/b', 'a\\b', '..', '', 'x'.repeat(201)]) {
      expect(() => assertStorageKey(bad)).toThrow('Invalid storage key');
    }
  });
});

describe('in-memory file storage', () => {
  it('round-trips bytes and refuses to overwrite a key', async () => {
    const storage = createInMemoryFileStorage();
    await storage.put('k1', Buffer.from('hello'), 'text/plain');
    expect((await storage.get('k1'))?.toString()).toBe('hello');
    await expect(storage.put('k1', Buffer.from('again'), 'text/plain')).rejects.toThrow(
      'already exists',
    );
    await storage.delete('k1');
    expect(await storage.get('k1')).toBeNull();
    await storage.delete('k1'); // idempotent
  });

  it('returns a copy, not the stored buffer', async () => {
    const storage = createInMemoryFileStorage();
    await storage.put('k2', Buffer.from('immutable'), 'text/plain');
    const first = await storage.get('k2');
    first?.fill(0);
    expect((await storage.get('k2'))?.toString()).toBe('immutable');
  });
});

describe('local file storage', () => {
  let dir: string;
  const dirs: string[] = [];

  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it('writes one flat file per key under the root and round-trips', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sproutup-fs-'));
    dirs.push(dir);
    const storage = createLocalFileStorage(dir);
    await storage.put('doc-key-1', Buffer.from('%PDF-1.7 body'), 'application/pdf');
    expect((await storage.get('doc-key-1'))?.toString()).toBe('%PDF-1.7 body');
    await expect(
      storage.put('doc-key-1', Buffer.from('x'), 'application/pdf'),
    ).rejects.toThrow();
    await storage.delete('doc-key-1');
    expect(await storage.get('doc-key-1')).toBeNull();
  });

  it('never resolves a key outside the root', async () => {
    const storage = createLocalFileStorage(await mkdtemp(join(tmpdir(), 'sproutup-fs-')).then((d) => {
      dirs.push(d);
      return d;
    }));
    await expect(storage.put('../escape', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      'Invalid storage key',
    );
  });
});
