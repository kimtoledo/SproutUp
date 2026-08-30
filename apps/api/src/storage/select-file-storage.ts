import type { ApiConfig } from '../config.js';
import { createUnconfiguredFileStorage, type FileStorage } from './file-storage.js';
import { createLocalFileStorage } from './local-file-storage.js';

/** Composition-root selection: production fails closed until a real provider is approved. */
export function selectFileStorage(
  config: Pick<ApiConfig, 'environment' | 'documentStorageDir'>,
): FileStorage {
  if (config.environment === 'production') return createUnconfiguredFileStorage();
  return createLocalFileStorage(config.documentStorageDir);
}
