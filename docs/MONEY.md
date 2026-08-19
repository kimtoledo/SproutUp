# SproutUp Exact PHP Money Boundary

## Currency and scale

MVP 1 money is Philippine peso only, ISO code `PHP`. Section 48 of the New Central Bank Act states that the peso is divided into 100 equal centavo parts ([Bangko Sentral ng Pilipinas source](https://www.bsp.gov.ph/Regulations/FX/New_Central_Bank_Act.pdf)), so settled amounts use exactly two decimal places.

External/shared contracts represent money as a decimal string, never a JSON number:

```json
{
  "currency": "PHP",
  "amount": "1000000.00"
}
```

Canonical values have no grouping separator, exponent, currency symbol, leading plus, unnecessary leading zero, or negative zero. Two decimal places are mandatory. Negative values are allowed only at boundaries that explicitly support signed ledger/correction amounts; collection/payment inputs should use `nonNegativePhpAmountSchema` plus their stricter domain rule.

## Runtime representation

`packages/shared/src/money.ts` parses canonical strings into an immutable branded `PhpMoney` value backed by `bigint` centavos. Addition, subtraction, negation, comparison, formatting, and transport-contract conversion never use JavaScript floating point.

The shared storage precision is `numeric(30,2)`: 28 whole-peso digits plus two centavo digits. This is a technical overflow boundary, not a product transaction limit. Parsing and arithmetic reject results outside the same range so runtime values cannot exceed their future PostgreSQL representation.

Do not accept `number` and convert it after the fact; a binary floating-point value may already have lost the original decimal intent. Parse the original string instead.

## Deliberately unavailable operations

The foundation does not provide multiply, divide, percentage, allocation, tax, interest, amortization, or rounding operations. Each of those requires an approved rule defining:

- rate representation and version;
- calculation precision for intermediate values;
- rounding mode and the exact stage where rounding occurs;
- residual allocation/tie-breaking;
- gross, deduction, and net preservation; and
- reproducibility/effective date.

Implement those only in the owning financial task with golden examples and reconciliation invariants. Never round implicitly inside a generic money constructor.

## Database and API rules

- PostgreSQL money columns use `numeric(30,2)`, never floating types. The implemented `ledger_entries.amount` is the first enforced use of this shared precision.
- Database drivers return/accept canonical decimal strings at the boundary; convert through `parsePhpMoney` before arithmetic.
- API/OpenAPI amounts use strings with currency alongside the amount unless the enclosing resource fixes `PHP` unambiguously.
- Ledger entries preserve signed amounts, while command inputs state whether zero/negative values are permitted.
- Currency, gross amount, each deduction, net amount, rule version, and source/idempotency reference remain separate fields.
