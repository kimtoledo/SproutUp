# 01 — Architecture & API Proxy Boundary

## Request path

Most authenticated interactions follow this shape:

```text
Browser/hash route
  -> frontend Server*Controller
  -> NewunionServiceLib web client
  -> services endpoint
  -> shared legacy model/database
```

The frontend stores the API key and a serialized user projection in the Yii session. `Profile/View` refreshes the session-backed user model, and UI gating reads booleans such as `hasDashboardAccess`, `isProfileApproved`, `isInvestor`, and `isFundseeker` returned by the API.

## Boundary exceptions

- Some listing and contract/participation paths instantiate local model objects.
- Loan contracts can be fetched with `file_get_contents` while placing a token in the query string.
- Attachment proxying forwards a token to the file service.
- Public route configuration allows broad controller groups, including all loan and credit-rating page routes and all credit-rating proxy routes.
- The dashboard mixes PHP-rendered state with a large client-side hash router and AJAX fragments.

## Revamp implications

- Use one typed API contract and keep all domain mutations behind it.
- Store auth tokens in secure cookies/session infrastructure; never place bearer credentials in URLs.
- Return explicit capabilities and workflow state, but always re-authorize commands server-side.
- Use dedicated authorized document download endpoints with short-lived references.
- Replace the large hash-routed page with testable route modules and stable URLs.
- Maintain a compatibility matrix while old portal and new portal coexist.
