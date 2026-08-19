# 02 — Registration, Authentication & Onboarding

## Journey observed

1. Visitor chooses investor or issuer direction and registers, optionally with referral context.
2. CAPTCHA and SMS verification paths validate registration.
3. Login returns an API key and detailed user projection stored in the web session.
4. The user selects/affirms dashboard type and completes profile data.
5. Onboarding captures identity/company data, addresses, source of wealth/income, KYC data, documents, references, directors, tax/TIN information, and bank accounts.
6. Investor paths include CKA/suitability, assessment, accredited/experienced-investor confirmation, acknowledgement, and risk acceptance.
7. The profile enters pending review; admin approval and sometimes DocuSign unlock further access.
8. Rejected or reset profiles can return to corrective onboarding paths.

## Legacy states

The local user projection recognizes New, Registration Rejected, Verified, Profile Pending, Profile Approved, Profile Rejected, and Deleted. Dashboard type is Investor or Fundseeker; account type is Individual or Corporate.

## Target decisions still needed

- Philippine individual versus juridical-person KYC requirements and beneficial-owner rules.
- Investor classification, suitability, risk acknowledgement, and cooling-off requirements.
- Borrower/SME authorized signatory and board-resolution requirements.
- Which data can be edited after submission and which changes require re-review.
- Consent/document versions, retention, e-signature provider, and manual fallback.
- Whether one identity may hold both borrower and investor capacities in the target model.

## Security notes

Public-route breadth, session/token handling, password recovery, OTP throttling, CAPTCHA trust, upload validation, and authorization on file endpoints all require explicit redesign and testing.
