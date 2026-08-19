import { JobTopicRegistry } from './job-worker-runtime.js';

export function createApplicationJobTopicRegistry(): JobTopicRegistry {
  return new JobTopicRegistry();
}
