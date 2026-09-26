---
paths:
  - "fhf-backend-automation/**"
---
# Security Rules

## Never expose credentials

- **Never print, log, or echo passwords, tokens, API keys, or secrets** — not in terminal output,
  not in test output, not in Allure attachments, not in commit messages. If a value comes from
  `tests/.env`, `config/config.ini`, or AWS Secrets Manager, treat it as a secret.
- When running shell commands that require credentials (e.g. `curl`, `sqlplus`), pass secrets via
  environment variables or files — never inline in the command string where they appear in shell
  history or terminal output.
- Never include real credentials in code comments, docstrings, or example values.

## Never commit sensitive files

- **Never `git add` or commit `tests/.env`, `config/config.ini`, or any file containing real
  credentials or secrets.** Both files are gitignored — if git ever surfaces them as untracked
  or modified, stop and investigate before staging anything.
- Use the example templates for any config that belongs in the repo: `tests/example_env` and
  `config/example_config.ini`. These must contain only placeholder values, never real ones.
- Before any `git add .` or `git add -A`, run `git status` and inspect the file list. If a
  `.env`, `*.ini`, `*.pem`, `*.key`, or credentials file appears, do not stage it.
- If a secret is accidentally committed, **do not try to fix it with another commit** — tell the
  user immediately so they can rotate the credential and purge git history.

## Sensitive files in this project

| File | Contains | Action |
|------|----------|--------|
| `tests/.env` | API credentials, Okta vars, endpoint paths, TestRail tokens | gitignored — never commit |
| `config/config.ini` | Oracle DB credentials, NLS/MSSQL credentials, email, S3 keys | gitignored — never commit |
| `tests/example_env` | Placeholder template | safe to commit — must contain no real values |
| `config/example_config.ini` | Placeholder template | safe to commit — must contain no real values |
