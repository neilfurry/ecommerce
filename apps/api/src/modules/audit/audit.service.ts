import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@marketplace/database';
import type { PaginatedResponse } from '@marketplace/shared-types';
import type { AuditLogEntry } from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Transaction client or the root client: audit entries join the caller's transaction. */
type Db = Prisma.TransactionClient | PrismaService;

export interface AuditEntry {
  action: string;
  outcome?: 'SUCCESS' | 'FAILURE';
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  /** Must never contain passwords, codes, tokens or hashes. */
  metadata?: Record<string, unknown>;
}

/** Keys that must never be written to the audit log, whatever a caller passes. */
const FORBIDDEN_KEYS = /pass|secret|token|code|hash|otp/i;

export function sanitizeAuditMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_KEYS.test(key)) continue;
    clean[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? sanitizeAuditMetadata(value as Record<string, unknown>)
        : value;
  }
  return clean;
}

export interface AuditQuery {
  page: number;
  pageSize: number;
  action?: string;
  actorId?: string;
  entityId?: string;
}

/**
 * Append-only audit trail (a database trigger rejects UPDATE/DELETE on audit_logs).
 * Record inside the business transaction when the entry must exist if and only if the
 * change happened; record outside (fire-and-forget safe) for failures such as bad sign-ins.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, context: RequestContext, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        action: entry.action,
        outcome: entry.outcome ?? 'SUCCESS',
        actorId: entry.actorId ?? null,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: context.requestId,
        metadata: sanitizeAuditMetadata({
          ...(context.app ? { app: context.app } : {}),
          ...entry.metadata,
        }) as Prisma.InputJsonValue,
      },
    });
  }

  /** For failure events outside a transaction: never lets an audit error break the request. */
  async recordSafely(entry: AuditEntry, context: RequestContext): Promise<void> {
    try {
      await this.record(entry, context);
    } catch (error) {
      this.logger.error(`Could not write audit entry ${entry.action}: ${(error as Error).message}`);
    }
  }

  async list(query: AuditQuery): Promise<PaginatedResponse<AuditLogEntry>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        outcome: row.outcome,
        actor: row.actor
          ? {
              id: row.actor.id,
              name: `${row.actor.firstName} ${row.actor.lastName}`,
              email: row.actor.email,
            }
          : null,
        entityType: row.entityType,
        entityId: row.entityId,
        ipAddress: row.ipAddress,
        requestId: row.requestId,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
        createdAt: row.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }
}
