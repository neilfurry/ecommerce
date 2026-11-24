# ADR 0012: SMS one-time codes and the SMS provider port

- Status: Accepted
- Date: 2026-11-25

## Context

Customers sign up with their mobile number and sign in with either the number and an SMS code
or their email and password. Philippine SMS gateways (Semaphore, M360, Globe Labs) differ, and
developers must be able to read codes without a real phone.

## Decision

- **Codes**: 6 digits from a CSPRNG, valid 5 minutes, stored only as an HMAC (keyed with
  `AUTH_OTP_SECRET`, bound to the challenge id) so a database leak cannot be brute-forced
  offline. 5 wrong attempts invalidate a code; a new code can be requested after 60 seconds,
  at most 3 per challenge and 5 per number per hour, on top of per-IP limits.
- **Sign-up** keeps the submitted details (with the password already hashed) on the challenge
  and creates the account only after the code is confirmed, so unverified numbers never
  become accounts. Email addresses are confirmed separately by a link.
- **Sign-in by SMS** answers identically whether or not the number has an account, and sends
  nothing for unknown numbers (no account enumeration).
- **Delivery** is a background job (`notifications.sms-otp`, priority 1, 3 quick attempts,
  removed from Redis as soon as it finishes). Dead letters have the code removed.
- **Provider port** `SmsProvider` in the worker:
  - `mock` (default in development, refused in production): stores messages in a capped Redis
    list shown in Admin Console > Developer tools > SMS outbox.
  - `semaphore`: Semaphore's priority endpoint (`/api/v4/priority`), which skips their normal
    queue. Rejected keys and invalid requests fail permanently; outages and throttling retry.

## Consequences

Adding another gateway is one class implementing `SmsProvider` and a value for
`SMS_PROVIDER`. The Semaphore adapter is covered by unit tests against recorded request and
response shapes; it has not been exercised against the live service from this project.
