# Security policy

Drop-Win is a play-money portfolio project. It holds no real money, no
personal data and no accounts; in server mode a player is an anonymous random
id in a signed cookie. Reports are still welcome, especially anything that
breaks the fairness guarantee in server mode (predicting or influencing an
outcome, seeing a server seed before rotation, or settling a bet differently
from what the verifier computes).

## Reporting

Please use GitHub's private vulnerability reporting on this repository
(Security tab, "Report a vulnerability") rather than a public issue. Include
steps to reproduce and the commit you tested. I aim to reply within a week.

## Browser mode (the GitHub Pages demo)

In browser mode the house runs in a Web Worker in the player's own tab and
saves to IndexedDB. The player can read the active server seed there, and the
page cannot send security headers. Both are known and documented in the
README, so reading your own seed or editing your own save is not a
vulnerability. Still worth reporting: anything that makes the demo load code
or send data to another origin, gets around the meta-tag CSP, makes a
tampered save load without being rejected, or makes the browser house settle
a bet differently from the server.

## Supported versions

Only the latest commit on `master` is supported.

## What is in place

- Server seeds come from the platform CSPRNG and are only sent to the client
  after rotation; the active seed is committed by its SHA-256 hash.
- Server mode and browser mode run the same ledger code, and a parity test
  checks they produce identical results for the same seeds.
- Every request body, header, query and cookie is validated with zod.
- Sessions are HMAC-signed, HttpOnly, SameSite=Strict cookies (`__Host-` and
  Secure in production).
- State-changing requests must be JSON from an allowed origin; CORS is limited
  to configured origins.
- Per-IP and per-player rate limits, a 2 KB body limit, and idempotency keys
  on bets.
- Balances are integer cents that storage refuses to make negative (a
  database CHECK on SQLite, the same check in the browser store); each bet
  settles in a single transaction.
- Strict Content-Security-Policy and related headers on the web app and API.
  The GitHub Pages build carries its CSP in a meta tag, since Pages cannot
  send headers, and makes no network requests after loading.
- Browser-mode saves are validated on load (shape, ranges, cross-record
  rules and every seed against its hash) and discarded if any check fails.
- CI runs CodeQL, `npm audit --omit=dev`, and Dependabot keeps dependencies
  and pinned GitHub Actions current.
