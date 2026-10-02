# Transaction data seeder

Writes rows straight into the `BANK_TRANSACTION` table of the platform's H2
database, so QA can get a realistic volume of transaction history without
clicking through the app or firing thousands of API calls.

## Requirements

- Python 3 (standard library only — nothing to `pip install`)
- Java on the `PATH`
- The H2 jar, picked up automatically from the Maven cache
  (`~/.m2/repository/com/h2database/h2/*/h2-*.jar`)

The backend opens the database with `AUTO_SERVER=TRUE`, so the script connects
fine **while the Spring Boot app is running** — no need to stop it.

## Customers, not users

Accounts hang off `CUSTOMERS`, and only a handful of customers have a login row
in `USERS` — in the current database, 6 users against **105 customers and 244
accounts**. Anything that walks `USERS -> ACCOUNT` therefore sees about 11
accounts and silently misses the rest.

So the script lists and targets **customers**, matching the admin screen, and
shows the linked login next to each one where it exists (`-` when there is
none). A customer can be selected by **customer id, login email, or name**;
if a name matches more than one customer the script says so and asks for the id.

## Usage

Interactive menu (list customers, seed, clear, show count):

```bash
python seed_transactions.py
```

Or drive it with flags:

```bash
python seed_transactions.py --list
```

```bash
python seed_transactions.py --list --filter nguyen
```

```bash
python seed_transactions.py --count 500
```

```bash
python seed_transactions.py --count 100 --customer 900042
```

```bash
python seed_transactions.py --clear
```

`--clear` prompts for confirmation; add `--yes` to skip it in a script.
Combining `--clear --count N` wipes the table first, then seeds.

| Flag | Meaning |
| --- | --- |
| `-n`, `--count N` | generate N transactions |
| `-u`, `--customer VALUE` | seed only that customer's accounts (id, login email, or name) |
| `-i`, `--identical` | give every selected customer the *same* set (mode A) |
| `--fixture [NAME]` | load a committed fixture, default `baseline` (mode C) |
| `--customers VALUE` | targets for `--identical`/`--fixture`: `all`, or a comma-separated list |
| `-s`, `--seed N` | fix the RNG so the run reproduces (mode B) |
| `--as-of DATE` | anchor generated timestamps to `YYYY-MM-DD` |
| `--label NAME` | name the set; re-running the same label replaces it |
| `-l`, `--list` | list customers that own accounts |
| `-f`, `--filter TEXT` | narrow `--list` by id, name, or login |
| `-c`, `--clear` | delete every row in the table |
| `-y`, `--yes` | skip the `--clear` confirmation |
| `--url` | point at a different H2 database |

Soft-deleted customers and accounts (`DELETED_AT IS NOT NULL`) are excluded
everywhere. `CLOSED` and `FROZEN` accounts are kept, since real ones carry
historical transactions.

## Generation modes

### Random (the default)

N transactions scattered over the target accounts.

### Identical — the same set for several customers

```bash
python seed_transactions.py --identical --count 20 --customers all
```

Builds one batch of 20 transactions, then gives that exact batch to every
selected customer, landing on **each customer's CHECKING account** — all 104
have exactly one, so the histories stay directly comparable. Only
`TRANSACTION_ID` and `EXTERNAL_TRANSACTION_ID` differ between copies, since the
schema requires those to be unique; amount, direction, status, timestamp,
description and category are identical.

Good for data-isolation tests (A must not see B's identical-looking rows) and
for diffing the same screen across accounts. If a customer ever has no chequing
account the script says so and falls back to their lowest account id.

### Reproducible — the same set across runs

```bash
python seed_transactions.py --identical --count 20 --customers all --seed 42 --as-of 2026-09-01
```

`--seed` fixes the RNG so the run reproduces exactly. Pass `--as-of` alongside
it: timestamps otherwise hang off *now*, so the same seed on a different day
gives the same shape with different dates. Without `--as-of` a seeded run
anchors to midnight UTC today — stable within a day, not across days.

Seeded runs get a stable label (`identical-s42`), so **re-running replaces the
previous copy** instead of duplicating it. Different seeds coexist as separate
labels. `--seed` works with the random and identical modes alike.

### Fixture — a canonical set with known totals

```bash
python seed_transactions.py --fixture baseline --customers 900013,900039
```

Loads `fixtures/baseline.json`: 17 transactions dated **August 2026** with round
totals, so tests can assert exact figures. Fixture rows carry absolute dates, so
`--as-of` deliberately does not shift them.

Per customer, the SUCCESS totals are:

| Direction | Category | Total |
| --- | --- | ---: |
| CREDIT | Income | 5500.00 |
| DEBIT | Housing | 2000.00 |
| DEBIT | Food & Drink | 450.00 |
| DEBIT | Shopping | 300.00 |
| DEBIT | Transport | 200.00 |
| DEBIT | Utilities | 200.00 |
| DEBIT | Entertainment | 100.00 |
| DEBIT | Health | 50.00 |

Plus three non-SUCCESS rows (two FAILED, one PENDING) excluded from those
totals. Verified end to end: with this fixture loaded,
`/accounts/{id}/insights?year=2026&month=8` returns exactly these figures.

Add your own by dropping another JSON file into `fixtures/` with the same shape;
`--fixture <name>` picks it up by filename.

## Labels and re-runs

Every set is tagged in `IDEMPOTENCY_KEY` as `<label>-<n>`. Re-running a label
deletes the old rows first, so repeated runs converge on one clean copy rather
than piling up. Random runs get a throwaway label unless you pass `--label` or
`--seed`, so they keep appending as before.

Remove one set by hand with:

```sql
DELETE FROM BANK_TRANSACTION WHERE IDEMPOTENCY_KEY LIKE 'identical-s42-%';
```

## What gets generated

Each row is spread randomly across the target accounts, with:

- a timestamp inside the last 90 days
- roughly 25% `CREDIT` income, the rest `DEBIT` spending
- a category from the eight the backend recognises
  (`SpendingInsightService.VALID_CATEGORIES`), matched to a realistic
  description, so the spending-insights endpoint has something to break down
- statuses weighted ~85% `SUCCESS`, 10% `FAILED`, 5% `PENDING`
- an `IDEMPOTENCY_KEY` of `<label>-<n>` (see Labels and re-runs above)

## Known limitation

Only the transaction table is written — **account balances are not adjusted**.
Seeded history therefore will not reconcile against `ACCOUNT.BALANCE`. That is
fine for exercising history, filtering, paging, statements and insights; it is
not suitable for testing balance arithmetic. Go through the
deposit/withdraw/transfer endpoints for that.

## Configuration

Defaults resolve to this repo's own database; override with environment
variables if you need to:

| Variable | Default |
| --- | --- |
| `DB_URL` | `jdbc:h2:file:<repo>/backend/data/digitalbankdb;AUTO_SERVER=TRUE` |
| `H2_JAR` | newest `h2-*.jar` in the Maven cache |

## Files

- `seed_transactions.py` — CLI, data generation, commands
- `fixtures/baseline.json` — the canonical fixture set
- `h2db.py` — H2 access layer (runs SQL through the H2 jar's `RunScript`, reads
  results back via H2's `CSVWRITE`; there is no pure-Python H2 driver, and
  JPype/JayDeBeApi have no wheels for Python 3.14)
