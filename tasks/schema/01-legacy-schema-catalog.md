# 01 — Legacy Schema Catalog

**Status:** WIP  
**Source reviewed:** `seedin-live-api-v1-1/newunion/applications/common/models`, backend auth models, and migrations.

The code contains 146 common model files plus backend `Admin`, `Permissions`, and `RolePermission` models. The following catalog groups observed tables by business area. Table names are explicit where a model declares `tableName()`.

## Identity, access, and user profile

| Table | Model | Observed key |
| --- | --- | --- |
| `users` | `User` | `user_id` |
| `admin` | `Admin` | `admin_id` |
| `api_key` | `UserApiKey` | `user_id` |
| `devices` | `Device` | `id` |
| `user_security` | `UserSecurity` | `id` |
| `social_auths` | `SocialAuth` | `id` |
| `otp` | `Otp` | `otp_id` |
| `otp_attempts` | `OtpAttempts` | `id` |
| `permissions` | `Permissions` | `permission_id` |
| `role_permission` | `RolePermission` | `role_permission_id` |
| `activities` | `Activity` | `activity_id` |
| `access_logs` | `ServiceAccessLogs` | `id` |

Profile/KYC tables include `companies`, `user_kyc`, `user_escrow`, `user_escrow_directors`, `user_documents`, `user_references`, `user_assessment`, `cka_answers`, `user_loan_risk`, `user_banks`, `user_banks_pending_summary`, `user_groups`, `user_group_members`, `user_comments`, `user_credit_line`, `user_additional_credit`, and `priority_investors`.

## Credit and underwriting

| Table | Model | Observed key |
| --- | --- | --- |
| `credit_ratings` | `CreditRating` | `credit_rating_id` |
| `credit_rating_history` | `CreditRatingHistory` | `history_id` |
| `credit_rating_reviews_history` | `CreditRatingReview` | `review_id` |
| `credit_rating_message_history` | `CreditRatingMessageHistory` | `id` |
| `credit_rating_attachments` | `CreditRatingAttachment` | `cr_attachment_id` |
| `credit_rating_directors` | `CreditRatingDirectors` | `id` |
| `credit_rating_shareholders` | `CreditRatingShareholders` | `id` |
| `collateral` | `Collateral` | `id` |
| `financial_statement` | `FinancialStatement` | `statement_id` |
| `financial_statement_master` | `FinancialStatementMaster` | `statement_master_id` |
| `financial_types` | `FinancialTypes` | `statement_name` |
| `financial_analysis` | `FinancialAnalysis` | `id` |

The separate credit-dashboard/product line uses `credit_dashboard_clients`, `credit_dashboard_listing`, `credit_dashboard_attachments`, `credit_dashboard_repayments`, `loan_borrow_crc_info`, and a database view exposed as `get_crc_investments`.

## Campaigns, loans, and investments

| Table | Model | Observed key |
| --- | --- | --- |
| `loan_borrow_listings` | `LoanBorrowListing` | `borrow_id` |
| `loan_borrow_repayment_schedule` | `LoanBorrowRepaymentSchedule` | `id` |
| `loan_borrower_repayment_txns` | `LoanBorrowRepaymentTxns` | `repayment_txn_id` |
| `loan_borrower_penalties` | `LoanBorrowPenalty` | `penalty_id` |
| `loan_payment` | `LoanPayment` | `payment_id` |
| `loan_lend_listings` | `LoanLendListing` | `lend_id` |
| `loan_lend_plan_requests` | `LoanLendPlanRequest` | `request_id` |
| `loan_lend_repayment_plans` | `LoanLendRepaymentPlan` | `repayment_plan_id` |
| `loan_lend_repayment_schedule` | `LoanLendRepaymentSchedule` | `id` |
| `loan_lend_repayment_txns` | `LoanLendRepaymentTxn` | `repayment_txn_id` |
| `loan_lend_repayment_summary` | `LoanLendRepaymentSummary` | `repayment_txn_id` |

Supporting tables include `loan_borrow_group_links`, `loan_notify_user`, `user_interested_investments`, `insurance`, `lendorfend`, `productb_comments`, and several legacy loan-request/schedule models whose table declarations are inherited or implicit.

## Wallet, holds, requests, and gateways

| Table | Model | Observed key |
| --- | --- | --- |
| `user_funds` | `UserFund` | `fund_id` |
| `fund_transactions` | `FundTransaction` | `fund_transaction_id` |
| `user_funds_hold` | `UserFundHold` | `id` |
| `user_funds_hold_history` | `UserFundHoldHistory` | `id` |
| `fund_requests` | `FundRequest` | `request_id` |
| `requests` | `Request` | `request_id` |
| `payout_transactions` | `PayoutTransaction` | `payout_txn_id` |
| `paynamics_txn` | `PaynamicsTxn` | `paynamics_id` |
| `paynamics_api_response` | `PaynamicsApiResponse` | `response_id` |
| `paynamics_check_queue` | `PaynamicsCheckQueue` | `queue_id` |
| `coins_ph` | `CoinsPH` | `coin_id` |
| `nuwallet_txn` | `NUWalletTxn` | `nuwallet_id` |
| `pitakamo_request` | `PitakamoRequest` | `request_id` |

Other observed payment tables are `paypal_payments`, `paypal_history`, `user_force_withdrawal`, and `user_deduct_fund`.

## Referral, commission, promotions, and rewards

Observed tables include `introducers`, `introducer_bonus`, `commisson_payments` (legacy spelling), `commission_txn_master`, `commission_rate`, `commission_details`, `user_referrals`, `referral_summary`, `promotions`, `promotions_redeem`, `promotion_redeem_summary`, `promotions_log`, `promotion_investment_log`, `user_voucher`, `points`, and `point_transactions`.

`introducer_members` is **not a base table** — it is a database VIEW, created (along with its intermediate `introducer_members_all` VIEW) by migration `m180323_024943_referral_v2.php`. The migration first creates `introducer_members_all` as a `UNION ALL` of `user_referrals` (email-invite referrals, `type=1`) and `users` rows that have a non-null `parent_id` (affiliate-link sign-ups, `type=2`), then creates `introducer_members` as a `SELECT` over `introducer_members_all` grouped by `(user_id, email_address)` to de-duplicate members. The `IntroducerMember` AR model reads this view; it has no independent storage or primary key of its own. See `tasks/reference/legacy/domain-introducers-commission.md` §9 for the application-level implications of this view-backed union.

## Secondary market

| Table | Model | Observed key |
| --- | --- | --- |
| `investment_trade_listings` | `InvestmentTradeList` | `trade_list_id` |
| `investment_trade_bids` | `InvestmentTradeBid` | `bid_id` |
| `investment_trade_bid_history` | `InvestmentTradeBidHistory` | `id` |

## Communications, content, and operations

Observed tables include `notifications`, `push_notifications`, `email_logs`, `email_template`, `email_blast`, `email_blast_groups`, `email_blast_recipient`, `email_blast_rules`, `email_blast_template`, `announcements`, `announcement_categories`, `announcement_entrepreneurs`, `banners`, `media_library`, `app_manager`, `settings`, `cronjobs`, `report_columns`, `log_reasons`, `bucket_files`, `rsvp`, and `categories`.

## External accounting and signing

Observed tables include `xero_oauths`, `xero_data`, `xero_invoice`, `xero_bank`, `xero_contacts`, `xero_organization`, `xero_api_general`, `xero_pnl`, `xero_loan_form`, `quickbooks_oauth`, `quickbooks_data`, `docusign`, and `docusign_recipients`.

## Known anomalies

- `AdminLog` maps to `otp`, which appears incorrect or abandoned.
- Both `Announcement` and `NewsflashListing`/`VideosListing` share `announcements` with type/category conventions.
- `BankPendingSummary` uses `user_id` as its primary key, suggesting a summary/view-like structure.
- Several relations reference missing model classes, including Jarvis-related models and restructure/history models.
- No foreign-key DDL was found in the available migration subset; most referential integrity appears application-enforced.
