# QA Automation Workspace

This folder contains QA-only assets and test automation framework.

**New here? Start with [ONBOARDING.md](ONBOARDING.md)** - setup, test data, Adminer, and the conventions each suite follows.

## Branch policy
- QAs work on branch `QA` only.
- All automation scripts created should be logged here.
- Never push to any branch other than `QA`.
- Pull dev updates from `origin/feature/springai` into `QA`.

## Layout
- `playwright/` - Playwright suite (in progress).
- `docker-compose.yml` - QA-only containers (Adminer DB viewer), separate from the root stack.

## Common commands

Start app:
```
sh .local/run_app.sh
```

Run Playwright Tests suite:

```powershell
npm test
```

## Folder Contents
This list is to be updated as tests are created. 

### Automated Tests
- Registration
- Login
- Account Creation
- Set Goals
- 

### API Utilities

### Other Created Tools
- **data-seeder**: Utility to create seeded transaction data. Currrently outdated as of postgreSQL migration. 


