export interface ApiVersionPolicy {
  major: number;
  pathPrefix: `/${string}`;
  status: 'current' | 'deprecated';
  deprecationAt?: Date;
  sunsetAt?: Date;
}

export const currentApiVersionPolicy: ApiVersionPolicy = {
  major: 1,
  pathPrefix: '/v1',
  status: 'current',
};

export const minimumApiSunsetNoticeDays = 180;

export function apiVersionHeaders(policy: ApiVersionPolicy): Record<string, string> {
  if (!Number.isSafeInteger(policy.major) || policy.major < 1) {
    throw new Error('API major version must be a positive integer');
  }
  if (
    (policy.deprecationAt && !Number.isFinite(policy.deprecationAt.getTime()))
    || (policy.sunsetAt && !Number.isFinite(policy.sunsetAt.getTime()))
  ) {
    throw new Error('API deprecation and sunset dates must be valid');
  }
  if (policy.status === 'current' && (policy.deprecationAt || policy.sunsetAt)) {
    throw new Error('A current API version cannot publish deprecation or sunset dates');
  }
  if (policy.status === 'deprecated' && !policy.deprecationAt) {
    throw new Error('A deprecated API version requires a deprecation date');
  }
  if (policy.sunsetAt && policy.deprecationAt && policy.sunsetAt < policy.deprecationAt) {
    throw new Error('API sunset cannot precede deprecation');
  }
  if (
    policy.sunsetAt
    && policy.deprecationAt
    && policy.sunsetAt.getTime() - policy.deprecationAt.getTime()
      < minimumApiSunsetNoticeDays * 24 * 60 * 60 * 1000
  ) {
    throw new Error(`API sunset requires at least ${minimumApiSunsetNoticeDays} days notice`);
  }

  const headers: Record<string, string> = {
    'SproutUp-API-Version': String(policy.major),
  };
  if (policy.deprecationAt) {
    headers.Deprecation = `@${Math.floor(policy.deprecationAt.getTime() / 1000)}`;
  }
  if (policy.sunsetAt) {
    headers.Sunset = policy.sunsetAt.toUTCString();
  }
  return headers;
}
