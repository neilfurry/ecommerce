import {
  type AdminUser,
  type AdminUserDetail,
  adminUserDetailSchema,
  type AdminUserList,
  adminUserListSchema,
  adminUserSchema,
  type AuditLogList,
  auditLogListSchema,
  type AuditLogQuery,
  type CreateStaffUserRequest,
  type MyWholesaleApplication,
  myWholesaleApplicationSchema,
  type ReviewWholesaleRequest,
  type RoleDto,
  type RoleList,
  roleListSchema,
  roleSchema,
  type UpdateUserRequest,
  type UserListQuery,
  type WholesaleApplicationDto,
  type WholesaleApplicationList,
  wholesaleApplicationListSchema,
  wholesaleApplicationSchema,
  type WholesaleBusiness,
  type WholesaleListQuery,
} from '@marketplace/validation';
import type { Permission, UserRole } from '@marketplace/shared-types';
import { z } from 'zod';
import type { RequestOptions } from './client';

type Request = <TSchema extends z.ZodType>(
  path: string,
  options: RequestOptions<TSchema>,
) => Promise<z.output<TSchema>>;

const noContent = z.unknown();
const id = (value: string) => encodeURIComponent(value);

/** /api/v1/admin: staff accounts, roles, wholesale approval and the audit log. */
export function createAdminClient(request: Request) {
  return {
    users: {
      list: (query: UserListQuery, signal?: AbortSignal): Promise<AdminUserList> =>
        request('/admin/users', { query, schema: adminUserListSchema, signal }),
      get: (userId: string, signal?: AbortSignal): Promise<AdminUserDetail> =>
        request(`/admin/users/${id(userId)}`, { schema: adminUserDetailSchema, signal }),
      create: (body: CreateStaffUserRequest): Promise<AdminUser> =>
        request('/admin/users', { method: 'POST', body, schema: adminUserSchema }),
      update: (userId: string, body: UpdateUserRequest): Promise<AdminUser> =>
        request(`/admin/users/${id(userId)}`, { method: 'PATCH', body, schema: adminUserSchema }),
      suspend: (userId: string): Promise<AdminUser> =>
        request(`/admin/users/${id(userId)}/suspend`, { method: 'POST', schema: adminUserSchema }),
      reactivate: (userId: string): Promise<AdminUser> =>
        request(`/admin/users/${id(userId)}/reactivate`, {
          method: 'POST',
          schema: adminUserSchema,
        }),
      revokeSessions: (userId: string) =>
        request(`/admin/users/${id(userId)}/sessions/revoke`, {
          method: 'POST',
          schema: noContent,
        }).then(() => undefined),
      resendInvitation: (userId: string) =>
        request(`/admin/users/${id(userId)}/invitation/resend`, {
          method: 'POST',
          schema: noContent,
        }).then(() => undefined),
    },
    roles: {
      list: (signal?: AbortSignal): Promise<RoleList> =>
        request('/admin/roles', { schema: roleListSchema, signal }),
      updatePermissions: (code: UserRole, permissions: Permission[]): Promise<RoleDto> =>
        request(`/admin/roles/${id(code)}/permissions`, {
          method: 'PUT',
          body: { permissions },
          schema: roleSchema,
        }),
    },
    wholesale: {
      list: (query: WholesaleListQuery, signal?: AbortSignal): Promise<WholesaleApplicationList> =>
        request('/admin/wholesale-applications', {
          query,
          schema: wholesaleApplicationListSchema,
          signal,
        }),
      review: (
        applicationId: string,
        body: ReviewWholesaleRequest,
      ): Promise<WholesaleApplicationDto> =>
        request(`/admin/wholesale-applications/${id(applicationId)}/review`, {
          method: 'POST',
          body,
          schema: wholesaleApplicationSchema,
        }),
    },
    auditLogs: {
      list: (query: AuditLogQuery, signal?: AbortSignal): Promise<AuditLogList> =>
        request('/admin/audit-logs', { query, schema: auditLogListSchema, signal }),
    },
  };
}

/** /api/v1/account: the signed-in customer's own records. */
export function createAccountClient(request: Request) {
  return {
    wholesaleApplication: (signal?: AbortSignal): Promise<MyWholesaleApplication> =>
      request('/account/wholesale-application', { schema: myWholesaleApplicationSchema, signal }),
    applyForWholesale: (body: WholesaleBusiness): Promise<WholesaleApplicationDto> =>
      request('/account/wholesale-application', {
        method: 'POST',
        body,
        schema: wholesaleApplicationSchema,
      }),
  };
}
