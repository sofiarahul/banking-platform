# QA Onboarding — Voltio Banking Platform

Everything a new QA needs to go from a fresh clone to a passing test run, plus the
tools we use to look at the data behind the UI.

Read this first, then the framework-specific READMEs:

- [`qa/README.md`](README.md) — the QA workspace index and branch policy
- [`qa/selenium/README.md`](selenium/README.md) — the Selenium/Cucumber suite conventions
- [`qa/data-seeder/README.md`](data-seeder/README.md) — bulk transaction seeding (see the caveat below)
- [`SETUP.md`](../SETUP.md) — the developers' full-stack setup guide

---

## 1. What you are testing

Voltio is a digital banking platform. Locally it is four processes:

| Piece | Port | What it is |
|---|---|---|
| Frontend | 5173 | React + Vite dev server. Proxies `/api` to the backend, so the UI and API share an origin. |
| Backend | 8080 | Spring Boot (Java 21). REST API, JWT auth, Swagger UI at `/swagger-ui.html`. |
| Postgres + pgvector | 5433 | One server, two databases: `banking_core` (accounts, customers, transactions) and `banking_chat` (chatbot knowledge base + interaction log). |
| GIC rates MCP server | 8081 | Optional. The chatbot answers GIC-rate questions through it; chat still works without it. |

Feature areas currently in scope: registration, login, account creation, savings
goals, transfers and daily limits, spending insights, risk scoring, admin
freeze/unfreeze, and the savings-insight chatbot.

---

## 2. Branch policy — read before your first commit

QA works on the `QA` branch **only**. This is enforced, not just convention:
`qa/.githooks/pre-commit` and `pre-push` reject any commit or push from another
branch, and the push hook also rejects any target other than `refs/heads/QA`.

Point git at those hooks once per clone:

```bash
git config core.hooksPath qa/.githooks
```

Pull developer changes in with the helper (fast-forward only, refuses to run off `QA`):

```powershell
./qa/sync-from-feature.ps1
```

It merges `origin/feature/springai` by default. Pass `-SourceBranch` to sync from
somewhere else.

---

## 3. First-time setup

### Prerequisites

- **Java 21** (`java -version`) — the backend will not build on older
- **Node.js** — frontend and the Playwright suite
- **Docker Desktop** — the database and Adminer
- **Python 3** — only if you use the data seeder
- No Maven install needed: `backend/` ships `mvnw` / `mvnw.cmd`

### Environment file

```bash
cp .env.example .env
```

Set `GROQ_API_KEY` (from https://console.groq.com/keys) if you need the chatbot.
Everything else already matches the Docker defaults — leave it alone unless you
are pointing at a different database.

### Start the database

```bash
docker compose up -d pgvector create-banking-core
```

`create-banking-core` is a one-shot container: it creates the `banking_core`
database if it is missing, then exits. Seeing it as **Exited (0)** in
`docker compose ps` is success, not a failure.

This is the stack everyone on the project runs. The QA database viewer is a
second, separate Compose file — see section 5.

### Start the backend

```bash
cd backend
./mvnw spring-boot:run -Dspring-boot.run.arguments=--app.seed.personas.enabled=true
```

The seed flag gives you the shared personas (section 4). Without it you start
with an empty database. `SEED_PERSONAS_ENABLED=true` in the environment does the
same thing and is how QA and CI environments should set it.

### Start the frontend

From the repo root, in its own terminal:

```bash
npm install
npm run dev
```

The app is then at http://localhost:5173.

---

## 4. Test data

There are three ways to get data, in order of preference.

### Seeded personas (preferred)

The backend ships a cast of customers covering every role and several data
shapes. They are off by default and enabled with the flag above.

| Persona | Login | Why it exists |
|---|---|---|
| `salaried` | `seed.salaried@voltio.test` | The ordinary customer. 18 months of history, so risk scoring returns a real score. |
| `goalSaver` | `seed.goalsaver@voltio.test` | Mid-progress savings goal (45%), two accounts. |
| `operations` | `seed.operations@voltio.test` | Administrator. Owns a FROZEN account for restriction workflows. |
| `sparse` | `seed.sparse@voltio.test` | Deliberately data-poor — triggers chatbot fallback and `INSUFFICIENT_DATA` risk status. |
| `riskAnalyst` | `seed.riskanalyst@voltio.test` | Risk Analyst role; proves a non-admin staff role has no freeze powers. |
| `complianceObserver` | `seed.compliance@voltio.test` | Read-only compliance/audit role. |

They share one password, defined on `PersonaSeeder.SEED_PASSWORD`. Their full
definitions live in
[`backend/src/main/resources/personas/voltio-personas.yaml`](../backend/src/main/resources/personas/voltio-personas.yaml),
which is the single source of truth — tests read expected values from it rather
than restating them.

**Seeding never overwrites.** A scenario that moves a persona's money leaves it
changed; re-running the app does not restore it. Reset is per persona on purpose,
so restoring yours does not destroy a colleague's half-finished run.

### Data the tests arrange themselves

The Playwright suite creates and tears down its own users. See section 6 —
prefer this over hand-made accounts for anything you automate.

### The Python transaction seeder

[`qa/data-seeder/`](data-seeder/) can bulk-load realistic transaction history.
⚠️ **It still writes to the old H2 database and has not been migrated to
Postgres** — treat its README as reference until that is fixed.

---

## 5. Adminer — looking at the database

Spec 004 moved the app off H2 onto Postgres, which retired the old H2 console at
`/h2-console`. Adminer replaces it: a browser-based database client, for local
dev only. It is not part of the app's runtime and is never deployed.

It lives in its own file, [`qa/docker-compose.yml`](docker-compose.yml), rather
than the shared stack at the repo root. Everyone needs the database; only QA
needs a viewer for it, so bringing this up adds nothing to a developer's machine
and `docker compose down` at the repo root leaves it running.

### Start it

One command, from the repo root:

```bash
docker compose -f qa/docker-compose.yml up -d
```

That is the whole setup — no build, no config file, nothing to add to `.env`.
You run it **once per machine**: `restart: unless-stopped` brings the container
back after a reboot or a Docker Desktop restart. Re-run it only if you have
explicitly stopped it (`docker compose -f qa/docker-compose.yml down`), and
re-running is harmless in any case.

Order does not matter. Adminer has no `depends_on` on the database — it connects
when you press Login, not at startup — so it is fine to start it before pgvector.

### Log in

Open **http://localhost:8090/?pgsql=host.docker.internal:5433** — bookmark that,
not the bare `localhost:8090`. The query string preselects the database driver;
see the warning below for why that matters.

| Field | Value |
|---|---|
| System | `PostgreSQL` (preselected by the URL above) |
| Server | `host.docker.internal:5433` (already pre-filled) |
| Username | `banking_chat` |
| Password | `banking_chat` |
| Database | `banking_core` — or `banking_chat` for the chatbot's data |

> **If the login just spins, check the System dropdown.** It defaults to
> **MySQL**, and Adminer's MySQL client will sit there waiting for a greeting
> packet that a Postgres server never sends — so a wrong driver hangs the page
> instead of reporting an error. Either use the URL above, or switch System to
> PostgreSQL before pressing Login.

**Server is `host.docker.internal:5433`, not `localhost:5433` and not
`pgvector`.** Adminer is in its own Compose project with no network shared with
the database, so it reaches Postgres the same way anything outside Docker
does — through the port published on your machine. `localhost` inside the
container means the container itself; `host.docker.internal` is your machine as
seen from inside it. A side benefit: this works just as well against a Postgres
installed natively, not only the pgvector container.

Username and password come from `CHATBOT_DB_USERNAME` / `CHATBOT_DB_PASSWORD` in
your `.env`; the values above are the defaults everyone uses locally.

If the login screen reports it cannot connect, the database is not up — start it
with the command in section 3.

### Which database is which

- **`banking_core`** — everything the app reads and writes: `users`, `user_roles`,
  `customers`, `account`, `bank_transaction`, `savings_goals`, `gic_investment`,
  `standing_orders`, `risk_scores`.
- **`banking_chat`** — the chatbot's embedded knowledge base and chat interaction
  log. You rarely need this one.

The schema is defined by Flyway in
[`backend/src/main/resources/db/migration/V001__baseline_schema.sql`](../backend/src/main/resources/db/migration/V001__baseline_schema.sql).
Read that file when you need column names or the foreign keys between tables.

### Things worth knowing

- **An empty `banking_core` is not a broken setup.** The tables are created by
  Flyway when the backend first starts. If you open Adminer before the backend
  has ever run against a fresh database, you will see a database with no tables
  in it — start the backend and look again.
- You are logged in as the **owning role**, so you can edit and delete anything.
  Adminer is a full client, not a read-only viewer — be deliberate with
  `DELETE`/`UPDATE`, especially on a shared environment.
- The backend runs with `spring.jpa.hibernate.ddl-auto=validate`. Hibernate will
  **not** fix the schema for you: if you change a table by hand and it no longer
  matches the entities, the backend fails at startup. Schema changes belong in a
  Flyway migration, which is a developer change, not a QA one.
- Prefer the API or the UI for arranging test data. Use Adminer to *see* state,
  to confirm what a test actually wrote, and for the few things no endpoint
  exposes (see `testDb.ts` in section 6).
- Command line equivalent, if you prefer it:

```bash
docker compose exec pgvector psql -U banking_chat -d banking_core
```

---

## 6. The Playwright suite

Lives in [`qa/playwright/`](playwright/). TypeScript, BDD via `playwright-bdd`,
Page Object Model.

```bash
cd qa/playwright
npm install
npx playwright install
npx bddgen && npx playwright test
```

`bddgen` turns the `.feature` files into Playwright specs under
`generated/bdd-specs/` (git-ignored). Run it after editing a feature file or a
step definition, or the suite runs against the previously generated specs.

Useful variations:

```bash
npx playwright test --project=chromium
npx playwright test --headed
npx playwright show-report
```

### Layout

```text
qa/playwright/
├── tests/bdd/features/     Gherkin — what the scenario does
├── tests/bdd/steps/        Step definitions — how it does it
├── src/pages/              Page objects (BasePage + one per screen)
├── src/api/                API-level setup helpers (register, open account)
├── src/db/testDb.ts        Direct database access for setup/teardown
├── support/fixtures/       Test fixtures: pages, testUsers, bankingCustomer
└── global_data/            Shared credentials for the long-lived test account
```

### Conventions that matter

- **The app runs on 5173, and so does `baseURL`.** Relative API paths in tests go
  through the Vite proxy to 8080, which keeps UI and API on one origin. Override
  with `APP_BASE_URL` if you need to.
- **Never leave a user behind.** The `testUsers` fixture hands out unique
  throwaway addresses and deletes them after the test, pass or fail. In a feature
  file, write `uniqueEmail` for a fresh account or `existingEmail` for the shared
  one — the fixture resolves both. There is no user-delete endpoint, which is why
  teardown goes through the database.
- **Arrange over the API, assert through the UI.** The `bankingCustomer` fixture
  creates a signed-up customer with a funded and an empty account over HTTP
  instead of driving the registration form again.
- **`testDb.ts` is for what the API cannot do** — deleting users, and setting a
  daily transfer limit (no endpoint exposes it). Do not reach for it when an
  endpoint exists.
- **Traceability.** Scenarios come from the feature spec in [`specs/`](../specs/),
  not from clicking around. Tag anything blocked or uncertain `@NotReady`.

---

## 7. The Selenium suite

[`qa/selenium/`](selenium/) — Java, Maven, Cucumber, JUnit 5, Page Object Model.
It targets the **hosted** application, not your local stack.

Before you run it, copy `src/test/resources/config-example.properties` to
`config.properties` and fill in `baseUrl` and `browser`. That file is git-ignored
and the hosted URL must not be committed — ask the team for it.

Its README is the authoritative guide for that suite; read it before adding
coverage there.

---

## 8. Known gotchas

- **`SETUP.md` still describes H2 in places.** Its "Known local-dev gotchas"
  section about `backend/data/digitalbankdb.mv.db` and the H2 console predates the
  Postgres migration. The app now runs on Postgres with Flyway; the H2 console is
  gone.
- **`create-banking-core` shows as Exited (0).** Correct — it is a one-shot task,
  not a crashed service.
- **A backend startup failure mentioning schema validation** usually means your
  database drifted from the entities. Check what Flyway has applied
  (`SELECT * FROM flyway_schema_history` in Adminer) before assuming the code is
  broken.
- **The data seeder targets H2** and will not work against the current database.
- **Personas do not reset themselves.** If a persona behaves oddly, suspect an
  earlier test run moved its money.
