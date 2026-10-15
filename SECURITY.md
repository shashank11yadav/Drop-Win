# Security policy

Drop-Win is a play-money portfolio project. It holds no real money, no
personal data and no accounts; a player is an anonymous random id in a signed
cookie. Reports are still welcome, especially anything that breaks the
fairness guarantee (predicting or influencing an outcome, seeing a server seed
before rotation, or settling a bet differently from what the verifier
computes).

## Reporting

Please use GitHub's private vulnerability reporting on this repository
(Security tab, "Report a vulnerability") rather than a public issue. Include
steps to reproduce and the commit you tested. I aim to reply within a week.

## Supported versions

Only the latest commit on `master` is supported.

## What is in place

- Server seeds come from the platform CSPRNG and are only sent to the client
  after rotation; the active seed is committed by its SHA-256 hash.
- Every request body, header, query and cookie is validated with zod.
- Sessions are HMAC-signed, HttpOnly, SameSite=Strict cookies (`__Host-` and
  Secure in production).
- State-changing requests must be JSON from an allowed origin; CORS is limited
  to configured origins.
- Per-IP and per-player rate limits, a 2 KB body limit, and idempotency keys
  on bets.
- Balances are integer cents with a database CHECK that they never go
  negative; each bet settles in a single transaction.
- Strict Content-Security-Policy and related headers on the web app and API.
- CI runs CodeQL, `npm audit --omit=dev`, and Dependabot keeps dependencies
  and pinned GitHub Actions current.
