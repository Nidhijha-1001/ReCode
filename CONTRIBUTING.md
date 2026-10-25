# Contributing to ReCode

Thanks for helping improve ReCode. The project is still evolving; please keep contributions focused and preserve the existing frontend/backend contracts and stored revision history.

## Before opening a change

1. Read [Development setup](docs/development.md) and run the app locally.
2. For a bug report, include the page/action, expected behavior, actual behavior, and relevant error text. Remove passwords, session cookies, database URLs, and personal problem notes.
3. For a proposed feature, describe the user workflow and how it fits the existing scheduler and data model before making broad changes.

## Checks

Run the frontend checks from the project root:

```bash
npm --prefix frontend run lint
npm --prefix frontend run build
```

There is not currently a dedicated automated backend or end-to-end test suite. For backend changes, also run the relevant workflow locally and verify `/api/health`, database persistence, and any changed API response. Do not use a personal database for destructive checks.

## Data and scope

Use isolated local data when testing database changes. Do not commit `.env` files, access passwords, session secrets, database exports, or personal study notes. Keep AI output separate from authoritative scheduling and progress data.

## License status

This checkout does not include a `LICENSE` file. The project owner has not selected a license, so contribution and reuse terms are not yet explicitly stated. Please do not add a license or represent the project as permissively licensed without the owner's decision.
