# SproutUp API Compatibility Policy

## Current version

SproutUp's current application API major version is `v1`, addressed under `/v1`. Every response whose path is `/v1` or begins `/v1/`, including errors and the Better Auth adapter, carries:

```http
SproutUp-API-Version: 1
```

The unversioned `/health` liveness endpoint is infrastructure-only and does not carry an application API version. `/openapi.json` describes the currently deployed contract and is also unversioned so tooling can always discover it at a stable location.

## Compatibility rules

Changes within `v1` must remain backward compatible for existing clients. Compatible changes include adding an optional request property, adding a response property, adding an operation, or expanding an enum only when clients are already required to tolerate unknown values. Tightening validation, removing or renaming a field/operation, changing ownership or retry semantics, and changing a response type require a new major path unless the existing behavior is a confirmed security vulnerability.

Security fixes may narrow unsafe behavior within the current major version. Such a change requires a documented risk decision, stable error behavior where disclosure is safe, release notes, and direct notice to controlled-pilot client owners.

Breaking changes use a parallel major path such as `/v2`; they do not silently replace `/v1`. The OpenAPI contract, server implementation, tests, client migration notes, and rollback plan must be reviewed together before the new major version is enabled.

## Deprecation and sunset

`v1` is current and has no deprecation or sunset date. A version becomes deprecated only through a committed policy change that records its replacement, migration guide, deprecation instant, sunset instant, affected client owners, and rollback/extension owner.

Deprecated responses use the standards-based structured date from [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html):

```http
Deprecation: @1798761600
```

When retirement is scheduled, responses also use the HTTP date defined by [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594.html):

```http
Sunset: Thu, 01 Jul 2027 00:00:00 GMT
```

SproutUp requires at least 180 days between deprecation and sunset. The API rejects a policy configuration with no deprecation date, a sunset before deprecation, or less than 180 days' notice. These headers are client guidance; they do not themselves change endpoint behavior.

## Change workflow

For every application API change:

1. Update the Fastify/OpenAPI schema, shared/domain validation, implementation, tests, and relevant Markdown in one commit.
2. Run `npm run check` and `npm audit --omit=dev`.
3. Classify the change as compatible, security-corrective, or breaking in `tasks/LOGS.md`.
4. For a breaking change, add the parallel major version and migration plan before deprecating the old version.
5. Do not publish `Deprecation` or `Sunset` until the dates and client communication plan are approved.
