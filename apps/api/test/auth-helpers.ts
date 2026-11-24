import { randomInt, randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { QUEUE_NAMES } from '@marketplace/config';
import { hashPassword, syncRolesAndPermissions, type UserStatus } from '@marketplace/database';
import type { ClientApp, UserRole } from '@marketplace/shared-types';
import { csrfResponseSchema } from '@marketplace/validation';
import type { Job, Queue } from 'bullmq';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

export const TEST_PASSWORD = 'Correct-horse-battery-2026';

/**
 * Every test client gets its own address (TRUST_PROXY=1 in setup-env.ts), so per-IP rate
 * limits on sign-in and OTP routes don't leak between tests that run in parallel.
 */
export const randomIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
export const randomMobile = () => `+639${randomInt(0, 1_000_000_000).toString().padStart(9, '0')}`;
export const uniqueEmail = (label: string) => `${label}.${randomUUID().slice(0, 8)}@e2e.test`;

type Server = ReturnType<INestApplication['getHttpServer']>;

/**
 * A browser stand-in for one frontend: keeps cookies, sends X-Client-App and the CSRF
 * token exactly like the real api-client does.
 */
export class TestClient {
  readonly agent: ReturnType<typeof request.agent>;
  csrfToken: string | undefined;

  constructor(
    server: Server,
    readonly app: ClientApp,
    readonly ip = randomIp(),
  ) {
    this.agent = request.agent(server);
  }

  async init(): Promise<this> {
    const res = await this.agent
      .get('/api/v1/auth/csrf')
      .set('X-Client-App', this.app)
      .set('X-Forwarded-For', this.ip);
    this.csrfToken = csrfResponseSchema.parse(res.body).csrfToken;
    return this;
  }

  private headers<T extends request.Test>(test: T, csrf: boolean): T {
    test.set('X-Client-App', this.app).set('X-Forwarded-For', this.ip);
    if (csrf && this.csrfToken) test.set('X-CSRF-Token', this.csrfToken);
    return test;
  }

  get(url: string) {
    return this.headers(this.agent.get(url), false);
  }
  post(url: string) {
    return this.headers(this.agent.post(url), true);
  }
  put(url: string) {
    return this.headers(this.agent.put(url), true);
  }
  patch(url: string) {
    return this.headers(this.agent.patch(url), true);
  }
  delete(url: string) {
    return this.headers(this.agent.delete(url), true);
  }

  async signIn(email: string, password = TEST_PASSWORD): Promise<this> {
    if (!this.csrfToken) await this.init();
    await this.post('/api/v1/auth/sign-in').send({ email, password }).expect(200);
    return this;
  }
}

export interface TestUser {
  id: string;
  email: string;
  mobile: string | null;
  roles: UserRole[];
}

let rolesSynced: Promise<void> | undefined;

/** Creates a user directly in the database (roles and permissions are synced once per file). */
export async function createUser(
  app: INestApplication,
  options: {
    roles: UserRole[];
    label?: string;
    status?: UserStatus;
    password?: string | null;
    mobile?: string | null;
    emailVerified?: boolean;
  },
): Promise<TestUser> {
  const prisma = app.get(PrismaService);
  rolesSynced ??= syncRolesAndPermissions(prisma).then(() => undefined);
  await rolesSynced;
  const status = options.status ?? 'ACTIVE';
  const password = options.password === undefined ? TEST_PASSWORD : options.password;
  const isCustomer = options.roles.some(
    (role) => role === 'CUSTOMER' || role === 'WHOLESALE_CUSTOMER',
  );
  const mobile =
    options.mobile === undefined ? (isCustomer ? randomMobile() : null) : options.mobile;
  const user = await prisma.user.create({
    data: {
      email: uniqueEmail(options.label ?? options.roles[0]!.toLowerCase()),
      firstName: 'Test',
      lastName: options.label ?? 'User',
      mobile,
      mobileVerifiedAt: mobile ? new Date() : null,
      emailVerifiedAt: options.emailVerified === false ? null : new Date(),
      passwordHash: password ? await hashPassword(password) : null,
      status,
      roles: { create: options.roles.map((roleCode) => ({ roleCode })) },
    },
  });
  return { id: user.id, email: user.email, mobile: user.mobile, roles: options.roles };
}

/** Creates a user and returns a client signed in to the given app. */
export async function signedInClient(
  app: INestApplication,
  clientApp: ClientApp,
  roles: UserRole[],
  label?: string,
): Promise<{ client: TestClient; user: TestUser }> {
  const user = await createUser(app, { roles, label });
  const client = await new TestClient(app.getHttpServer(), clientApp).init();
  await client.signIn(user.email);
  return { client, user };
}

const PENDING_STATES = [
  'waiting',
  'prioritized',
  'delayed',
  'active',
  'completed',
  'failed',
] as const;

/**
 * Finds the newest notification job matching `match`, the way a user would find the SMS or
 * email. The worker is not running during API e2e tests, so jobs stay in the queue.
 */
export async function findJob<T>(
  app: INestApplication,
  queue: 'email' | 'notifications',
  match: (data: T, job: Job<T>) => boolean,
): Promise<Job<T>> {
  const q = app.get<Queue<T>>(
    getQueueToken(queue === 'email' ? QUEUE_NAMES.EMAIL : QUEUE_NAMES.NOTIFICATIONS),
  );
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const jobs = await q.getJobs([...PENDING_STATES], 0, 500);
    const found = jobs
      .filter((job): job is Job<T> => !!job && match(job.data, job))
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`No ${queue} job matched`);
}

/** The latest SMS code sent to a mobile number. */
export async function latestOtp(app: INestApplication, mobile: string): Promise<string> {
  const job = await findJob<{ to: string; code: string }>(
    app,
    'notifications',
    (data) => data.to === mobile,
  );
  return job.data.code;
}

/** The token in the latest email link of the given job name sent to an address. */
export async function latestEmailToken(
  app: INestApplication,
  name: string,
  to: string,
): Promise<string> {
  const job = await findJob<{ to: string; link: string }>(
    app,
    'email',
    (data, j) => j.name === name && data.to === to,
  );
  const token = new URL(job.data.link).searchParams.get('token');
  if (!token) throw new Error('Email link has no token');
  return token;
}
