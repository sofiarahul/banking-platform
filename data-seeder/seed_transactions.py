"""Seeds rows into the BANK_TRANSACTION table of the banking platform's H2 database.

Run with no arguments for an interactive menu, or pass flags to script it:

    python seed_transactions.py --list
    python seed_transactions.py --count 500
    python seed_transactions.py --count 100 --customer 900042
    python seed_transactions.py --identical --count 20 --customers all
    python seed_transactions.py --fixture baseline --customers 900013,900039
    python seed_transactions.py --clear

Three generation modes:

  random     the default - N transactions scattered over the target accounts
  identical  one batch built once, then given to every target customer, so
             their histories are directly comparable
  fixture    a hand-authored set committed under fixtures/, with totals known
             ahead of time so tests can assert exact figures

Add --seed (and ideally --as-of) to any of them to make a run reproducible.

Accounts belong to CUSTOMERS, not to USERS: most customers in this database
have no login row at all, so anything that walks USERS -> ACCOUNT sees only a
fraction of the accounts. Everything here is keyed on the customer (the same
list the admin screen shows), with the login shown alongside where one exists.

Writes transaction rows only - account balances are left untouched, so the
totals in the app will not add up to the seeded history.
"""

import argparse
import json
import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone

from h2db import H2Database, escape

TABLE = "BANK_TRANSACTION"
FIXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")

# Categories the backend recognises (SpendingInsightService.VALID_CATEGORIES),
# each with descriptions that read like real statement lines.
SPENDING = {
    "Food & Drink": ["Grocery shop - Loblaws", "Coffee - Tim Hortons",
                     "Restaurant - The Keg", "Grocery shop - Metro"],
    "Transport": ["Monthly transit pass", "Fuel - Petro-Canada",
                  "Rideshare - Uber", "Parking - Green P"],
    "Housing": ["Rent payment", "Home insurance premium", "Condo maintenance fee"],
    "Utilities": ["Hydro bill", "Internet - Rogers", "Mobile plan - Bell"],
    "Shopping": ["Online order - Amazon", "Clothing - Winners",
                 "Electronics - Best Buy"],
    "Entertainment": ["Cinema tickets", "Streaming - Netflix", "Concert tickets"],
    "Health": ["Pharmacy - prescription refill", "Dental checkup", "Gym membership"],
}
INCOME = ["Payroll deposit", "Interest payment", "Tax refund", "Client invoice settled"]

# Weighted so most seeded history is usable, with enough failed and pending
# rows to exercise the states the UI has to render.
STATUSES = ["SUCCESS"] * 85 + ["FAILED"] * 10 + ["PENDING"] * 5

COUNTERPARTY = "Seeded counterparty"


# --------------------------------------------------------------------------- reads

def list_customers(db, name_filter=None):
    """Customers that own at least one account, and so can hold transactions.

    LOGIN is the linked user's email where the customer has one; most of the
    bulk-loaded customers do not, which is exactly why this is not a USERS query.
    """
    sql = (
        "SELECT c.CUSTOMER_ID, c.NAME, "
        "MIN(u.USERNAME) AS LOGIN, "
        "COUNT(DISTINCT a.ACCOUNT_ID) AS ACCOUNTS, "
        "COUNT(t.TRANSACTION_ID) AS TRANSACTIONS "
        "FROM CUSTOMERS c "
        "JOIN ACCOUNT a ON a.CUSTOMER_ID = c.CUSTOMER_ID AND a.DELETED_AT IS NULL "
        "LEFT JOIN USERS u ON u.CUSTOMER_ID = c.CUSTOMER_ID "
        "LEFT JOIN BANK_TRANSACTION t ON t.ACCOUNT_ID = a.ACCOUNT_ID "
        "WHERE c.DELETED_AT IS NULL ")

    if name_filter:
        needle = escape(name_filter.lower())
        sql += ("AND (LOWER(c.NAME) LIKE '%%%s%%' "
                "OR LOWER(COALESCE(u.USERNAME, '')) LIKE '%%%s%%' "
                "OR CAST(c.CUSTOMER_ID AS VARCHAR) LIKE '%%%s%%') " % (needle, needle, needle))

    sql += "GROUP BY c.CUSTOMER_ID, c.NAME ORDER BY c.CUSTOMER_ID"
    return db.query(sql)


def resolve_customer(db, value):
    """Resolves a customer id, login email, or name to a single customer row.

    Returns the matching row, or None after printing why it could not pick one.
    """
    needle = escape(str(value).strip().lower())
    matches = db.query(
        "SELECT DISTINCT c.CUSTOMER_ID, c.NAME, MIN(u.USERNAME) AS LOGIN "
        "FROM CUSTOMERS c "
        "LEFT JOIN USERS u ON u.CUSTOMER_ID = c.CUSTOMER_ID "
        "WHERE c.DELETED_AT IS NULL AND ("
        "CAST(c.CUSTOMER_ID AS VARCHAR) = '%s' "
        "OR LOWER(c.NAME) = '%s' "
        "OR LOWER(u.USERNAME) = '%s') "
        "GROUP BY c.CUSTOMER_ID, c.NAME" % (needle, needle, needle))

    if not matches:
        print("No customer matches %r. Use option 1 / --list to see the ids." % value)
        return None

    if len(matches) > 1:
        print("%r matches %d customers - use the customer id instead:"
              % (value, len(matches)))
        for row in matches:
            print("  %s  %s" % (row["CUSTOMER_ID"], row["NAME"]))
        return None

    return matches[0]


def resolve_customers(db, spec, name_filter=None):
    """Resolves the --customers argument to a list of customer rows.

    Accepts "all", or a comma-separated list of ids / logins / names. Returns
    None if any entry could not be resolved, so a typo never silently seeds a
    smaller set than asked for.
    """
    if spec and spec.strip().lower() == "all":
        return list_customers(db, name_filter)

    if not spec:
        return list_customers(db, name_filter)

    resolved = []
    for entry in [part.strip() for part in spec.split(",") if part.strip()]:
        match = resolve_customer(db, entry)
        if not match:
            return None
        resolved.append(match)
    return resolved


def account_ids(db, customer_id=None):
    """Account ids to spread transactions over: one customer's, or all of them."""
    sql = "SELECT a.ACCOUNT_ID FROM ACCOUNT a WHERE a.DELETED_AT IS NULL"
    if customer_id is not None:
        sql += " AND a.CUSTOMER_ID = %d" % int(customer_id)
    return [int(row["ACCOUNT_ID"]) for row in db.query(sql)]


def anchor_accounts(db, customers):
    """Picks the one account per customer that an identical set lands on.

    Their CHECKING account: every customer in this database has exactly one, so
    the sets stay directly comparable. Falls back to the customer's lowest
    account id if one ever has no chequing account.
    """
    ids = ",".join(str(int(row["CUSTOMER_ID"])) for row in customers)
    if not ids:
        return {}

    chequing = db.query(
        "SELECT CUSTOMER_ID, MIN(ACCOUNT_ID) AS ACCOUNT_ID FROM ACCOUNT "
        "WHERE DELETED_AT IS NULL AND ACCOUNT_TYPE = 'CHECKING' "
        "AND CUSTOMER_ID IN (%s) GROUP BY CUSTOMER_ID" % ids)
    anchors = {int(row["CUSTOMER_ID"]): int(row["ACCOUNT_ID"]) for row in chequing}

    missing = [row for row in customers if int(row["CUSTOMER_ID"]) not in anchors]
    if missing:
        fallback = db.query(
            "SELECT CUSTOMER_ID, MIN(ACCOUNT_ID) AS ACCOUNT_ID FROM ACCOUNT "
            "WHERE DELETED_AT IS NULL AND CUSTOMER_ID IN (%s) GROUP BY CUSTOMER_ID"
            % ",".join(str(int(row["CUSTOMER_ID"])) for row in missing))
        for row in fallback:
            anchors[int(row["CUSTOMER_ID"])] = int(row["ACCOUNT_ID"])
        print("  note: %d customer(s) have no CHECKING account - used their "
              "lowest account id instead." % len(missing))

    return anchors


def transaction_count(db):
    return int(db.scalar("SELECT COUNT(*) FROM %s" % TABLE))


def label_count(db, label):
    return int(db.scalar("SELECT COUNT(*) FROM %s WHERE IDEMPOTENCY_KEY LIKE '%s-%%'"
                         % (TABLE, escape(label))))


# -------------------------------------------------------------------------- writes

def clear_transactions(db):
    removed = transaction_count(db)
    db.execute("DELETE FROM %s;" % TABLE)
    return removed


def delete_label(db, label):
    """Removes a previously seeded set so a re-run replaces it instead of duplicating."""
    removed = label_count(db, label)
    if removed:
        db.execute("DELETE FROM %s WHERE IDEMPOTENCY_KEY LIKE '%s-%%';"
                   % (TABLE, escape(label)))
    return removed


def build_template(rng, as_of):
    """Builds one transaction as plain data, with no id and no account yet.

    Keeping the data separate from the row is what makes an identical set
    possible: the same template is rendered once per customer, picking up a
    fresh primary key each time.
    """
    if rng.random() < 0.25:
        category, description, direction = "Income", rng.choice(INCOME), "CREDIT"
        amount = round(rng.uniform(500, 5000), 2)
    else:
        category = rng.choice(sorted(SPENDING))
        description = rng.choice(SPENDING[category])
        direction = "DEBIT"
        amount = round(rng.uniform(5, 900), 2)

    moment = as_of - timedelta(days=rng.randint(0, 89), seconds=rng.randint(0, 86399))

    return {
        "amount": "%.2f" % amount,
        "direction": direction,
        "status": rng.choice(STATUSES),
        "timestamp": moment.strftime("%Y-%m-%d %H:%M:%S+00"),
        "description": description,
        "category": category,
    }


def render_values(template, account_id, key):
    """Renders one template into a tuple of quoted SQL values for an account."""
    credit = template["direction"] == "CREDIT"
    sender = COUNTERPARTY if credit else None
    receiver = None if credit else COUNTERPARTY

    return (
        "'%s'" % uuid.uuid4(),
        str(account_id),
        template["amount"],
        "'%s'" % template["direction"],
        "'%s'" % template["status"],
        "TIMESTAMP WITH TIME ZONE '%s'" % template["timestamp"],
        "'%s'" % escape(template["description"]),
        "'%s'" % escape(template["category"]),
        "NULL" if sender is None else "'%s'" % escape(sender),
        "NULL" if receiver is None else "'%s'" % escape(receiver),
        "'%s'" % escape(key),
        "'%s'" % uuid.uuid4(),
    )


COLUMNS = ("TRANSACTION_ID, ACCOUNT_ID, AMOUNT, DIRECTION, STATUS, TIMESTAMP, "
           "DESCRIPTION, CATEGORY, SENDER_INFO, RECEIVER_INFO, "
           "IDEMPOTENCY_KEY, EXTERNAL_TRANSACTION_ID")


def insert_pairs(db, pairs, label, batch_size=500):
    """Inserts (template, account_id) pairs, keyed as <label>-<n>."""
    inserted = 0
    for start in range(0, len(pairs), batch_size):
        chunk = pairs[start:start + batch_size]
        values = ",\n".join(
            "(%s)" % ", ".join(render_values(template, account_id,
                                             "%s-%d" % (label, start + offset)))
            for offset, (template, account_id) in enumerate(chunk))
        db.execute("INSERT INTO %s (%s) VALUES\n%s;" % (TABLE, COLUMNS, values))
        inserted += len(chunk)
        print("  inserted %d/%d" % (inserted, len(pairs)))
    return inserted


# ------------------------------------------------------------------- fixture (mode C)

def load_fixture(name):
    """Loads a committed fixture set from fixtures/<name>.json."""
    path = os.path.join(FIXTURE_DIR, "%s.json" % name)
    if not os.path.isfile(path):
        available = sorted(f[:-5] for f in os.listdir(FIXTURE_DIR)
                           if f.endswith(".json")) if os.path.isdir(FIXTURE_DIR) else []
        raise FileNotFoundError(
            "No fixture named %r. Available: %s"
            % (name, ", ".join(available) if available else "(none)"))

    with open(path, encoding="utf-8") as handle:
        fixture = json.load(handle)

    # Fixture rows carry absolute dates so the expected totals hold whenever the
    # set is loaded - --as-of deliberately does not shift them.
    templates = []
    for row in fixture["transactions"]:
        templates.append({
            "amount": "%.2f" % float(row["amount"]),
            "direction": row["direction"],
            "status": row["status"],
            "timestamp": "%s %s+00" % (row["date"], row.get("time", "12:00:00")),
            "description": row["description"],
            "category": row["category"],
        })
    return fixture, templates


def fixture_totals(templates):
    """Totals the SUCCESS rows per category, which is what tests assert against."""
    totals = {}
    for template in templates:
        if template["status"] != "SUCCESS":
            continue
        key = (template["direction"], template["category"])
        totals[key] = totals.get(key, 0.0) + float(template["amount"])
    return totals


# ----------------------------------------------------------------------- commands

def show_customers(db, name_filter=None):
    customers = list_customers(db, name_filter)
    if not customers:
        if name_filter:
            print("\nNo account-owning customer matches %r." % name_filter)
        else:
            print("\nNo customers own an account yet - nothing to seed against.")
        return customers

    print("\n%-12s %-32s %-30s %-10s %s"
          % ("CUSTOMER_ID", "NAME", "LOGIN", "ACCOUNTS", "TRANSACTIONS"))
    print("-" * 100)
    for row in customers:
        print("%-12s %-32s %-30s %-10s %s"
              % (row["CUSTOMER_ID"], row["NAME"][:32], (row["LOGIN"] or "-")[:30],
                 row["ACCOUNTS"], row["TRANSACTIONS"]))
    print("\n%d customer(s), %d account(s) in scope."
          % (len(customers), sum(int(row["ACCOUNTS"]) for row in customers)))
    return customers


def do_generate(db, count, customer=None, rng=None, as_of=None, label=None):
    """Mode A's opposite number: random rows scattered over the target accounts."""
    rng = rng or random.Random()
    as_of = as_of or datetime.now(timezone.utc)

    customer_id = customer["CUSTOMER_ID"] if customer else None
    accounts = account_ids(db, customer_id)
    if not accounts:
        target = ("customer %s" % customer_id) if customer else "the database"
        print("No accounts found for %s - nothing to seed." % target)
        return False

    scope = ("customer %s (%s)" % (customer_id, customer["NAME"])
             if customer else "all customers")
    label = label or "seed-%s" % uuid.uuid4().hex[:8]

    print("\nSeeding %d random transactions across %d account(s) for %s..."
          % (count, len(accounts), scope))
    replaced = delete_label(db, label)
    if replaced:
        print("  replaced %d row(s) from a previous %r run" % (replaced, label))

    pairs = [(build_template(rng, as_of), rng.choice(accounts)) for _ in range(count)]
    insert_pairs(db, pairs, label)
    print("Done. Label %s. %s now holds %d rows." % (label, TABLE, transaction_count(db)))
    return True


def do_identical(db, count, customers, rng=None, as_of=None, label=None):
    """Mode A: build one batch, then give that same batch to every customer."""
    rng = rng or random.Random()
    as_of = as_of or datetime.now(timezone.utc)

    if not customers:
        print("No customers selected - nothing to seed.")
        return False

    label = label or "identical-%s" % uuid.uuid4().hex[:8]
    templates = [build_template(rng, as_of) for _ in range(count)]

    print("\nSeeding an identical set of %d transactions for %d customer(s)..."
          % (count, len(customers)))
    anchors = anchor_accounts(db, customers)
    replaced = delete_label(db, label)
    if replaced:
        print("  replaced %d row(s) from a previous %r run" % (replaced, label))

    pairs = []
    for customer in customers:
        account_id = anchors.get(int(customer["CUSTOMER_ID"]))
        if account_id is None:
            print("  skipped customer %s (%s) - no account"
                  % (customer["CUSTOMER_ID"], customer["NAME"]))
            continue
        pairs.extend((template, account_id) for template in templates)

    if not pairs:
        print("None of the selected customers has an account - nothing to seed.")
        return False

    insert_pairs(db, pairs, label)
    print("Done. Label %s, %d rows per customer. %s now holds %d rows."
          % (label, count, TABLE, transaction_count(db)))
    return True


def do_fixture(db, name, customers, label=None):
    """Mode C: load a committed fixture and give it to every selected customer."""
    fixture, templates = load_fixture(name)

    if not customers:
        print("No customers selected - nothing to seed.")
        return False

    label = label or "fixture-%s" % fixture.get("name", name)

    print("\nLoading fixture %r (%d transactions) for %d customer(s)..."
          % (fixture.get("name", name), len(templates), len(customers)))
    if fixture.get("description"):
        print("  %s" % fixture["description"])

    anchors = anchor_accounts(db, customers)
    replaced = delete_label(db, label)
    if replaced:
        print("  replaced %d row(s) from a previous %r load" % (replaced, label))

    pairs = []
    for customer in customers:
        account_id = anchors.get(int(customer["CUSTOMER_ID"]))
        if account_id is None:
            print("  skipped customer %s (%s) - no account"
                  % (customer["CUSTOMER_ID"], customer["NAME"]))
            continue
        pairs.extend((template, account_id) for template in templates)

    if not pairs:
        print("None of the selected customers has an account - nothing to seed.")
        return False

    insert_pairs(db, pairs, label)

    print("\nExpected SUCCESS totals per customer (what tests can assert):")
    for (direction, category), amount in sorted(fixture_totals(templates).items()):
        print("  %-7s %-16s %10.2f" % (direction, category, amount))
    print("\nDone. Label %s. %s now holds %d rows."
          % (label, TABLE, transaction_count(db)))
    return True


def do_clear(db, assume_yes=False):
    total = transaction_count(db)
    if total == 0:
        print("\n%s is already empty." % TABLE)
        return False

    if not assume_yes:
        answer = input("\nDelete ALL %d rows from %s? This cannot be undone [y/N]: "
                       % (total, TABLE)).strip().lower()
        if answer != "y":
            print("Cancelled.")
            return False

    removed = clear_transactions(db)
    print("Deleted %d rows. %s is now empty." % (removed, TABLE))
    return True


# --------------------------------------------------------------------- interactive

def ask_int(prompt, minimum=1):
    while True:
        raw = input(prompt).strip()
        if not raw:
            return None
        try:
            value = int(raw)
        except ValueError:
            print("Please enter a whole number.")
            continue
        if value < minimum:
            print("Please enter a number of at least %d." % minimum)
            continue
        return value


def ask_reproducible(prefix):
    """Offers mode B on any generate: a fixed seed makes the run repeatable.

    The default label has to encode the seed, not be random: re-running the same
    seed must land on the same label so it replaces the earlier copy instead of
    quietly duplicating it.
    """
    raw = input("Seed for a reproducible run (blank for random): ").strip()
    if not raw:
        return None, None, None
    try:
        seed = int(raw)
    except ValueError:
        print("  not a number - using a random run instead.")
        return None, None, None

    default_label = "%s-s%d" % (prefix, seed)
    label = input("Label (blank for %r): " % default_label).strip() or default_label
    return random.Random(seed), default_as_of(seed), label


def pick_customer(db):
    name_filter = input("\nFilter the list (blank for all customers): ").strip()
    if not show_customers(db, name_filter or None):
        return None
    raw = input("\nCustomer id, login or name (blank to cancel): ").strip()
    if not raw:
        return None
    return resolve_customer(db, raw)


def pick_customers(db):
    name_filter = input("\nFilter the list (blank for all customers): ").strip()
    if not show_customers(db, name_filter or None):
        return None
    raw = input("\nCustomer ids (comma separated), or 'all': ").strip()
    if not raw:
        return None
    return resolve_customers(db, raw, name_filter or None)


def menu(db):
    actions = [
        ("1", "List customers"),
        ("2", "Generate random transactions for all customers"),
        ("3", "Generate random transactions for one customer"),
        ("4", "Generate an identical set for several customers"),
        ("5", "Load a fixed fixture set"),
        ("6", "Clear all transactions"),
        ("7", "Show transaction count"),
        ("0", "Exit"),
    ]

    while True:
        print("\n=== Transaction seeder ===")
        print("DB: %s" % db.url)
        for key, label in actions:
            print("  %s) %s" % (key, label))

        choice = input("Choose an option: ").strip()
        if choice == "0":
            return 0
        elif choice == "1":
            name_filter = input("Filter (blank for all): ").strip()
            show_customers(db, name_filter or None)
        elif choice == "2":
            count = ask_int("How many transactions? ")
            if count:
                rng, as_of, label = ask_reproducible("random")
                do_generate(db, count, None, rng, as_of, label)
        elif choice == "3":
            customer = pick_customer(db)
            if customer:
                count = ask_int("How many transactions for %s? " % customer["NAME"])
                if count:
                    rng, as_of, label = ask_reproducible("random")
                    do_generate(db, count, customer, rng, as_of, label)
        elif choice == "4":
            customers = pick_customers(db)
            if customers:
                count = ask_int("How many transactions each? ")
                if count:
                    rng, as_of, label = ask_reproducible("identical")
                    do_identical(db, count, customers, rng, as_of, label)
        elif choice == "5":
            name = input("Fixture name (blank for 'baseline'): ").strip() or "baseline"
            customers = pick_customers(db)
            if customers:
                try:
                    do_fixture(db, name, customers)
                except (FileNotFoundError, KeyError, ValueError) as error:
                    print("Fixture error: %s" % error)
        elif choice == "6":
            do_clear(db)
        elif choice == "7":
            print("\n%s holds %d rows." % (TABLE, transaction_count(db)))
        else:
            print("Unknown option %r." % choice)


# ---------------------------------------------------------------------------- main

def default_as_of(seed):
    """Anchors a seeded run to midnight UTC so same-day runs match exactly.

    Without an anchor the timestamps hang off `now`, which would make the same
    seed produce different dates every run. Pass --as-of to pin it across days.
    """
    if seed is None:
        return datetime.now(timezone.utc)
    return datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


def parse_as_of(value, seed):
    if not value:
        return default_as_of(seed)
    return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Seed or clear rows in the H2 %s table." % TABLE)
    parser.add_argument("-n", "--count", type=int,
                        help="number of transactions to generate")
    parser.add_argument("-u", "--customer", "--user", dest="customer",
                        help="seed only this customer's accounts "
                             "(customer id, login email, or name)")
    parser.add_argument("-i", "--identical", action="store_true",
                        help="give every selected customer the same set of "
                             "transactions, on their CHECKING account")
    parser.add_argument("--fixture", nargs="?", const="baseline",
                        help="load a committed fixture from fixtures/ "
                             "(default: baseline)")
    parser.add_argument("--customers",
                        help="targets for --identical/--fixture: 'all', or a "
                             "comma-separated list of ids, logins or names")
    parser.add_argument("-s", "--seed", type=int,
                        help="fix the RNG so the run is reproducible")
    parser.add_argument("--as-of", dest="as_of",
                        help="anchor generated timestamps to this date "
                             "(YYYY-MM-DD); use with --seed for stable dates")
    parser.add_argument("--label",
                        help="name this set; re-running the same label replaces it")
    parser.add_argument("-l", "--list", "--list-customers", "--list-users",
                        dest="list_customers", action="store_true",
                        help="list customers that own accounts, then exit")
    parser.add_argument("-f", "--filter",
                        help="narrow --list or --customers by id, name, or login")
    parser.add_argument("-c", "--clear", action="store_true",
                        help="delete every row in the table")
    parser.add_argument("-y", "--yes", action="store_true",
                        help="skip the confirmation prompt for --clear")
    parser.add_argument("--url",
                        help="override the JDBC URL (default: the repo's H2 file DB)")
    args = parser.parse_args(argv)

    # Some seeded customers have non-Latin names; without this the listing dies
    # with a UnicodeEncodeError on a legacy Windows console codepage.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    try:
        db = H2Database(url=args.url)
    except FileNotFoundError as error:
        print("Error: %s" % error, file=sys.stderr)
        return 2

    try:
        # No flags at all means the interactive menu. --identical counts as a
        # flag even without --count, so the missing --count is reported rather
        # than silently dropping into the menu.
        if not (args.list_customers or args.clear or args.count
                or args.fixture or args.identical):
            return menu(db)

        if args.list_customers:
            show_customers(db, args.filter)

        # --clear runs before the generators so combining them means "reset,
        # then seed".
        if args.clear:
            do_clear(db, assume_yes=args.yes)

        rng = random.Random(args.seed) if args.seed is not None else random.Random()
        as_of = parse_as_of(args.as_of, args.seed)

        if args.fixture:
            customers = resolve_customers(db, args.customers, args.filter)
            if customers is None:
                return 1
            if not do_fixture(db, args.fixture, customers, args.label):
                return 1

        elif args.identical:
            if not args.count:
                print("--identical needs --count.", file=sys.stderr)
                return 2
            customers = resolve_customers(db, args.customers, args.filter)
            if customers is None:
                return 1
            label = args.label or (
                "identical-s%d" % args.seed if args.seed is not None else None)
            if not do_identical(db, args.count, customers, rng, as_of, label):
                return 1

        elif args.count:
            customer = None
            if args.customer:
                customer = resolve_customer(db, args.customer)
                if not customer:
                    return 1
            label = args.label or (
                "random-s%d" % args.seed if args.seed is not None else None)
            if not do_generate(db, args.count, customer, rng, as_of, label):
                return 1

    except (RuntimeError, FileNotFoundError, KeyError, ValueError) as error:
        print("Error: %s" % error, file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled.")
        return 130

    return 0


if __name__ == "__main__":
    sys.exit(main())
