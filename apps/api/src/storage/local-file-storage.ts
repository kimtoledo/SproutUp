import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertStorageKey, type FileStorage } from './file-storage.js';

/**
 * Development file store: one flat file per key under `rootDir`. Keys are our
 * generated ids (validated by `assertStorageKey`), so there is no path the
 * caller controls. Not for production — a deployed environment uses an
 * object-storage adapter selected during infrastructure approval.
 */
export function createLocalFileStorage(rootDir: string): FileStorage {
  const root = resolve(rootDir);
  const pathFor = (key: string): string => {
    assertStorageKey(key);
    return join(root, key);
  };
  return {
    async put(key, bytes) {
      await mkdir(root, { recursive: true });
      // `wx` fails if the file already exists, matching the "keys are unique" contract.
      await writeFile(pathFor(key), bytes, { flag: 'wx' });
    },
    async get(key) {
      try {
        return await readFile(pathFor(key));
      } catch {
        return null;
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}
