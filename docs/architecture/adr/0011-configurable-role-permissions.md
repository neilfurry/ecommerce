# ADR 0011: Roles with configurable permissions

- Status: Accepted
- Date: 2026-11-25

## Context

The master instructions define 14 roles and require configurable permissions. Some rules
must never be configurable: seller data isolation, a platform that always has a super admin,
and customers who can only ever see their own data.

## Decision

- Roles are fixed in code (`USER_ROLES`); a user can hold several. The permission catalog is
  also defined in code (`PERMISSIONS` in `@marketplace/shared-types`) because each permission
  is enforced by code. Which role holds which permission is data (`role_permissions`) and is
  edited by a super admin in the Admin Console.
- `SUPER_ADMIN` is locked: it always holds every permission and cannot be edited. The last
  active super admin cannot be suspended or demoted.
- Endpoints declare what they need with `@RequirePermissions(...)` (platform operations) or
  `@Roles(...)` (audience checks such as "customers only"). Seller isolation (Phase 3) is
  enforced by scoping queries to the caller's seller, never by a permission.
- Granting is hierarchical: a super admin may grant any platform staff role; an admin may grant
  the staff roles below admin. Admins cannot manage accounts holding a role they could not
  grant. Customer roles are never granted by hand: `CUSTOMER` comes from sign-up and
  `WHOLESALE_CUSTOMER` from an approved wholesale application.
- Staff accounts are created by invitation: the admin enters name, email and roles; the person
  sets their own password from an emailed link (7 days). No one ever sees another person's
  password.
- `pnpm db:seed` synchronises roles and permissions: new roles and permissions get their
  defaults, existing assignments are left as configured, and permissions removed from the code
  are removed from the database.
- Every sign-in (successful or not), account change, permission change and approval is
  written to `audit_logs`, which a database trigger makes append-only (UPDATE, DELETE and
  TRUNCATE are rejected). Metadata never contains passwords, tokens or codes.

## Consequences

New phases add permissions to the catalog with defaults; a super admin can then adjust them
without a deployment.
