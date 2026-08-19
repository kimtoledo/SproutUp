# 03 — One-Level Referral Program

**Status:** WIP  
**Outcome:** A direct referrer earns an auditable share of platform commission from qualifying investments.

## Scope

- Unique referral code/link, attribution at registration, one direct referrer, and lifetime relationship while active/compliant.
- Configurable qualifying event, commission base, share rate, effective dates, caps, status, and reversal rules.
- Pending, approved, payable, paid, withheld, cancelled, and reversed referral ledger states.
- Referrer dashboard, Finance approval, tax deduction, statement, and report.

## Acceptance criteria

- Referral reward is calculated only from platform commission actually recognized for the qualifying investment.
- Investor principal and gross/net investor returns are unchanged by referral calculation.
- Self-referral, referral loops, reassignment abuse, duplicate payout, and inactive/noncompliant referrers are blocked.
- Example: PHP 1,000 platform commission × 10% share = PHP 100 gross referral reward before applicable referral withholding.
- Historical rewards retain the applied rule version and source commission transaction.

## Legacy reference

- [Introducers, Referrals & Commission](../reference/legacy/domain-introducers-commission.md)

## Open decisions

- Eligible referrer types, attribution lock, activation criteria, commission recognition point, payout threshold, and withholding treatment.
