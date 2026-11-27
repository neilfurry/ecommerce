# Windows 11 development setup

Everything runs on one Windows 11 PC. PostgreSQL, Redis, MinIO and Mailpit run in Docker Desktop
(WSL 2 backend). The Node.js apps run directly on Windows for fast hot reload. Every command is
for **Windows PowerShell** (5.1 or 7) unless marked **WSL/Linux**.

## 1. Install the prerequisites

Open **PowerShell** and run:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e          # Node.js 24 LTS
winget install --id Docker.DockerDesktop -e
winget install --id Microsoft.VisualStudioCode -e # optional but recommended
```

Docker Desktop needs WSL 2. If WSL is not installed yet, open PowerShell **as Administrator**:

```powershell
wsl --install
```

Restart Windows, then start **Docker Desktop**. Under **Settings → General**, keep **Use the WSL 2
based engine** ticked. Under **Settings → Resources**, give Docker at least 4 GB of memory. Wait
until the status bar shows **Engine running**.

Close and reopen PowerShell so the new programs are on `PATH`, then install pnpm (no administrator
rights needed; `setup.ps1` also does this if pnpm is missing):

```powershell
npm install --global pnpm@10.28.0
```

> Avoid `corepack enable` in a normal PowerShell: it writes into `C:\Program Files\nodejs` and fails
> with `EPERM: operation not permitted` unless PowerShell runs as Administrator.

Check the versions:

```powershell
git --version
node --version      # v24.x (v22.22 or newer also works)
pnpm --version      # 10.x
docker --version
docker compose version
```

> **Execution policy.** If Windows says "running scripts is disabled", either use the
> `powershell -ExecutionPolicy Bypass -File .\scripts\<name>.ps1` form, or allow local scripts
> for your user once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## 2. Get the code and run setup

```powershell
cd $HOME
mkdir source -Force | Out-Null
cd source
git clone https://github.com/neilfurry/ecommerce.git
cd ecommerce
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

`setup.ps1` can be re-run safely. It:

1. checks Node.js, pnpm and Docker;
2. creates `.env` from `.env.example` (only when `.env` does not exist);
3. installs dependencies (`pnpm install`);
4. starts PostgreSQL, Redis, MinIO and Mailpit and waits until they are **healthy**;
5. applies database migrations and seeds reference data;
6. builds the shared packages and generates the Prisma client.

It ends with "Setup complete." and the list of URLs.

## 3. Start and stop

```powershell
.\scripts\start.ps1                 # Docker services + API + worker + 3 frontends
.\scripts\start.ps1 -Only api       # or worker, storefront, seller, admin
.\scripts\start.ps1 -InfraOnly      # only the Docker services
.\scripts\stop.ps1                  # stop Docker services, keep data
.\scripts\stop.ps1 -RemoveData      # stop and delete ALL local data (asks first)
```

Apps started by `start.ps1` stop with **Ctrl+C** in that window.

| Service       | URL / address                     | Credentials (from `.env`)                  |
| ------------- | --------------------------------- | ------------------------------------------ |
| Storefront    | http://localhost:5173             |                                            |
| Seller Center | http://localhost:5174             |                                            |
| Admin Console | http://localhost:5175             |                                            |
| API (Swagger) | http://localhost:3000/api/docs    |                                            |
| PostgreSQL    | localhost:5432                    | `marketplace` / `marketplace_dev_password` |
| Redis         | localhost:6379                    |                                            |
| MinIO API     | http://localhost:9000             | `marketplace` / `marketplace_dev_secret`   |
| MinIO console | http://localhost:9001             | same as MinIO API                          |
| Mailpit       | http://localhost:8025 (SMTP 1025) |                                            |

All ports bind to `127.0.0.1`, so other computers on your network cannot reach them.

## 4. Verify the installation

`setup.ps1` seeds demo accounts for development (`SEED_DEMO_USERS=true`). They all use the
password in `SEED_DEMO_PASSWORD` (`Marketplace-dev-2026!` by default):

| Account                           | Role               | Sign in at                                                                               |
| --------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| `superadmin@marketplace.local`    | Super admin        | Admin Console (5175)                                                                     |
| `admin@marketplace.local`         | Admin              | Admin Console (5175)                                                                     |
| `finance@marketplace.local`       | Finance admin      | Admin Console (5175)                                                                     |
| `support@marketplace.local`       | Customer support   | Admin Console (5175)                                                                     |
| `seller.owner@marketplace.local`  | Seller owner       | Seller Center (5174), business "Sam Sari-Sari Trading" (verified, store `sam-sari-sari`) |
| `seller.staff@marketplace.local`  | Seller encoder     | Seller Center (5174), employee of the same seller                                        |
| `seller2.owner@marketplace.local` | Seller owner       | Seller Center (5174), "Isla Tech Gadgets" (Cebu City warehouse; laptops)                 |
| `seller3.owner@marketplace.local` | Seller owner       | Seller Center (5174), "Click & Type Peripherals" (Davao warehouse; mouse, keyboard)      |
| `customer@marketplace.local`      | Customer           | Storefront (5173), or by SMS to `0917 000 0001`; has a default address in Quezon City    |
| `wholesale@marketplace.local`     | Wholesale customer | Storefront (5173); approved wholesale application, address in Pasay                      |

The demo data also has coupons `WELCOME100`, `FREESHIP` (marketplace), `ISLA500` and `CLICK10`
(seller-funded), a running "Payday Flash Sale" (the black mouse at ₱399), featured products and
stores, and two home-page banners. `setup.ps1` adds demo photos and banners with
`pnpm --filter @marketplace/api run seed:media` after building the API.

1. Open http://localhost:5175 and sign in as the super admin. **System health** shows Database,
   Redis, File storage and Background worker as **Up**.
2. **Developer tools → Background jobs**: click **Run job**. The job status turns **Completed**.
3. On the same page, click **Send test email**, then **Open Mailpit inbox**. The email is there.
4. **Developer tools → File storage**: upload a PNG or PDF, download it, then delete it.
5. In the storefront (http://localhost:5173) click **Create account**. The SMS code appears in
   Admin Console → **Developer tools → SMS outbox**; the email confirmation link in Mailpit.
6. Open http://localhost:5174/register and register a test business. Confirm the email from
   Mailpit, complete **Business profile**, upload the three required documents on
   **Verification** and submit. In the Admin Console, **Sellers → Under review** shows it;
   approve it, then create a store in the Seller Center.
7. In the Seller Center (as `seller.owner@marketplace.local`) open **Products**: the demo
   product "Sinandomeng Rice 25 kg" is active with wholesale tiers (₱500 / 450 / 420 / 390) and
   120 units in warehouse QC-1. Add a product, upload a photo and submit it; approve it in the
   Admin Console under **Catalog → Product approval**. Record stock on **Inventory → Stock
   adjustments** and check **Movement history**.
8. **Shopping (Phase 4).** In the storefront, without signing in, search for "keytap
   keyboard" and add it to the cart, then open **Laptops** and add the Isla Tech Aero 14
   (512 GB). The cart shows two stores. Click **Sign in to check out** and sign in as
   `customer@marketplace.local`. Checkout shows two packages (from Cebu and from Davao) with
   their shipping fees. Apply `FREESHIP` and place the order (cash on delivery). The order page
   shows one order split into two packages; Mailpit has the confirmation and one email per
   seller.
9. Sign in to the Seller Center as `seller3.owner@marketplace.local`: **Orders** lists only
   Click & Type's part of the order, with the commission. In the Admin Console, **Orders**
   shows the whole order with both seller orders; **Settings** holds VAT, payment methods,
   shipping rates and commission rates; **Promotions** and **Storefront content** manage
   coupons, flash sales, banners and featured items.
10. Open http://localhost:3000/api/docs and try `GET /api/v1/health`.
11. Run `.\scripts\test.ps1 -Suite unit`. It ends with "All 'unit' tests passed."

## 5. Environment configuration

All apps and Docker Compose read the single **`.env`** in the repository root. `.env.example`
documents every variable, and its defaults work as-is for local development. Invalid or missing
values stop the API or worker at start-up with a list of every problem; secret values are never
printed.

| Group           | Variables                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API             | `API_PORT`, `CORS_ORIGINS`, `TRUST_PROXY`, `LOG_LEVEL`, `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_MAX_REQUESTS`, `SWAGGER_ENABLED`                                                                                                                                                                                                                                                                                                                                                      |
| PostgreSQL      | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `DATABASE_URL`, `SHADOW_DATABASE_URL` (optional)                                                                                                                                                                                                                                                                                                                                                                 |
| Redis           | `REDIS_PORT`, `REDIS_URL`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Object storage  | `MINIO_IMAGE`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_AUTO_CREATE_BUCKET`, `STORAGE_SIGNED_URL_TTL_SECONDS`, `UPLOAD_MAX_BYTES`                                                                                                                                                                       |
| Email           | `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`                                                                                                                                                                                                                                                                                                                                                             |
| Authentication  | `AUTH_JWT_SECRET`, `AUTH_OTP_SECRET`, `AUTH_MFA_ENCRYPTION_KEY` (all different, 32+ characters; the last encrypts two-step verification secrets: changing it breaks existing authenticator setups, and people then need a recovery code or an admin reset), `AUTH_ACCESS_TOKEN_TTL_SECONDS`, `AUTH_CUSTOMER_SESSION_DAYS`, `AUTH_STAFF_SESSION_HOURS`, `AUTH_MAX_FAILED_SIGN_INS`, `AUTH_LOCKOUT_MINUTES`, `COOKIE_SECURE` (required `true` in production), `COOKIE_DOMAIN` (optional) |
| App URLs        | `STOREFRONT_URL`, `SELLER_PORTAL_URL`, `ADMIN_PORTAL_URL` (used in email links)                                                                                                                                                                                                                                                                                                                                                                                                        |
| Shipping        | `SHIPPING_PROVIDER` (`mock` only for now; rejected in production until a courier is connected). The mock's rate table is edited in Admin Console › Settings                                                                                                                                                                                                                                                                                                                            |
| SMS             | `SMS_PROVIDER` (`mock` or `semaphore`; `mock` is rejected in production), `SEMAPHORE_API_KEY`, `SEMAPHORE_SENDER_NAME`                                                                                                                                                                                                                                                                                                                                                                 |
| Demo data       | `SEED_DEMO_USERS`, `SEED_DEMO_PASSWORD` (development only; never seeded when `NODE_ENV=production`)                                                                                                                                                                                                                                                                                                                                                                                    |
| Developer tools | `DEV_TOOLS_ENABLED` (rejected when `NODE_ENV=production`)                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Worker          | `WORKER_CONCURRENCY` (optional override), `WORKER_HEARTBEAT_INTERVAL_SECONDS`, `DATABASE_URL` (shared with the API; required in production for the reservation and unpaid-order sweeps)                                                                                                                                                                                                                                                                                                |
| Frontends       | `VITE_API_BASE_URL`, `VITE_API_PROXY_TARGET`, `VITE_MAILPIT_URL`                                                                                                                                                                                                                                                                                                                                                                                                                       |

`NODE_ENV` is intentionally not set in `.env`: the API and worker default to `development`, and
Vite would otherwise build development bundles.

## 6. Database, tests and backups

- Database workflow (migrations, seed, reset, Studio, backups): [LOCAL_DATABASE.md](LOCAL_DATABASE.md)
- Running and writing tests: [../testing/TESTING_GUIDE.md](../testing/TESTING_GUIDE.md)

## 7. Recommended VS Code extensions

Open the folder in VS Code and accept the **recommended extensions** prompt: ESLint, Prettier,
Prisma, Tailwind CSS IntelliSense, Playwright, Docker, Vitest.

## 8. WSL / Linux shell (optional)

**WSL/Linux:** the same `pnpm` commands work unchanged. Use `cp .env.example .env`, then
`pnpm infra:up`, `pnpm db:deploy`, `pnpm db:seed` and `pnpm dev`. PowerShell 7 (`pwsh`) also runs
the scripts in `scripts/` on Linux. For fast file watching, clone into the Linux file system
(`~/projects`), not under `/mnt/c`.

Having problems? See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
