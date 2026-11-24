import {
  type CreateStoreRequest,
  type InviteSellerMemberRequest,
  type MyStores,
  myStoresSchema,
  type PermissionList,
  permissionListSchema,
  type PublicStore,
  publicStoreSchema,
  type ReviewSellerRequest,
  type SellerDetail,
  sellerDetailSchema,
  type SellerDocumentDto,
  sellerDocumentSchema,
  type SellerList,
  sellerListSchema,
  type SellerListQuery,
  type SellerMemberDto,
  sellerMemberSchema,
  type SellerTeam,
  sellerTeamSchema,
  type SlugAvailability,
  slugAvailabilitySchema,
  type StoreDto,
  type StoreList,
  storeListSchema,
  type StoreListQuery,
  storeSchema,
  type UpdateSellerMemberRequest,
  type UpdateSellerProfileRequest,
  type UpdateStoreRequest,
  type UpdateStoreSettingsRequest,
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
import type { Permission, SellerDocumentType, UserRole } from '@marketplace/shared-types';
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
        request('/users', { query, schema: adminUserListSchema, signal }),
      get: (userId: string, signal?: AbortSignal): Promise<AdminUserDetail> =>
        request(`/users/${id(userId)}`, { schema: adminUserDetailSchema, signal }),
      create: (body: CreateStaffUserRequest): Promise<AdminUser> =>
        request('/users', { method: 'POST', body, schema: adminUserSchema }),
      update: (userId: string, body: UpdateUserRequest): Promise<AdminUser> =>
        request(`/users/${id(userId)}`, { method: 'PATCH', body, schema: adminUserSchema }),
      suspend: (userId: string): Promise<AdminUser> =>
        request(`/users/${id(userId)}/suspend`, { method: 'POST', schema: adminUserSchema }),
      reactivate: (userId: string): Promise<AdminUser> =>
        request(`/users/${id(userId)}/reactivate`, {
          method: 'POST',
          schema: adminUserSchema,
        }),
      revokeSessions: (userId: string) =>
        request(`/users/${id(userId)}/sessions/revoke`, {
          method: 'POST',
          schema: noContent,
        }).then(() => undefined),
      resendInvitation: (userId: string) =>
        request(`/users/${id(userId)}/invitation/resend`, {
          method: 'POST',
          schema: noContent,
        }).then(() => undefined),
    },
    roles: {
      list: (signal?: AbortSignal): Promise<RoleList> =>
        request('/roles', { schema: roleListSchema, signal }),
      updatePermissions: (code: UserRole, permissions: Permission[]): Promise<RoleDto> =>
        request(`/roles/${id(code)}/permissions`, {
          method: 'PUT',
          body: { permissions },
          schema: roleSchema,
        }),
    },
    wholesale: {
      list: (query: WholesaleListQuery, signal?: AbortSignal): Promise<WholesaleApplicationList> =>
        request('/wholesale-applications', {
          query,
          schema: wholesaleApplicationListSchema,
          signal,
        }),
      review: (
        applicationId: string,
        body: ReviewWholesaleRequest,
      ): Promise<WholesaleApplicationDto> =>
        request(`/wholesale-applications/${id(applicationId)}/review`, {
          method: 'POST',
          body,
          schema: wholesaleApplicationSchema,
        }),
    },
    auditLogs: {
      list: (query: AuditLogQuery, signal?: AbortSignal): Promise<AuditLogList> =>
        request('/audit-logs', { query, schema: auditLogListSchema, signal }),
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

const blob = z.instanceof(Blob);

/** Platform administration of sellers and stores (Admin Console). */
export function createMarketplaceAdminClient(request: Request) {
  return {
    permissions: (signal?: AbortSignal): Promise<PermissionList> =>
      request('/permissions', { schema: permissionListSchema, signal }),
    resetUserMfa: (userId: string) =>
      request(`/users/${id(userId)}/mfa/reset`, { method: 'POST', schema: noContent }).then(
        () => undefined,
      ),
    sellers: {
      list: (query: SellerListQuery, signal?: AbortSignal): Promise<SellerList> =>
        request('/sellers', { query, schema: sellerListSchema, signal }),
      get: (sellerId: string, signal?: AbortSignal): Promise<SellerDetail> =>
        request(`/sellers/${id(sellerId)}`, { schema: sellerDetailSchema, signal }),
      document: (sellerId: string, documentId: string): Promise<Blob> =>
        request(`/sellers/${id(sellerId)}/documents/${id(documentId)}/content`, {
          schema: blob,
          responseType: 'blob',
        }),
      review: (sellerId: string, body: ReviewSellerRequest): Promise<SellerDetail> =>
        request(`/sellers/${id(sellerId)}/review`, {
          method: 'POST',
          body,
          schema: sellerDetailSchema,
        }),
      suspend: (sellerId: string, reason: string): Promise<SellerDetail> =>
        request(`/sellers/${id(sellerId)}/suspend`, {
          method: 'POST',
          body: { reason },
          schema: sellerDetailSchema,
        }),
      reinstate: (sellerId: string, reason: string): Promise<SellerDetail> =>
        request(`/sellers/${id(sellerId)}/reinstate`, {
          method: 'POST',
          body: { reason },
          schema: sellerDetailSchema,
        }),
      close: (sellerId: string, reason: string): Promise<SellerDetail> =>
        request(`/sellers/${id(sellerId)}/close`, {
          method: 'POST',
          body: { reason },
          schema: sellerDetailSchema,
        }),
    },
    stores: {
      list: (query: StoreListQuery, signal?: AbortSignal): Promise<StoreList> =>
        request('/stores', { query, schema: storeListSchema, signal }),
      suspend: (storeId: string, reason: string): Promise<StoreDto> =>
        request(`/stores/${id(storeId)}/suspend`, {
          method: 'POST',
          body: { reason },
          schema: storeSchema,
        }),
      reinstate: (storeId: string, reason: string): Promise<StoreDto> =>
        request(`/stores/${id(storeId)}/reinstate`, {
          method: 'POST',
          body: { reason },
          schema: storeSchema,
        }),
    },
  };
}

/** The signed-in seller's own account, stores and employees (Seller Center). */
export function createSellerClient(request: Request) {
  return {
    profile: (signal?: AbortSignal): Promise<SellerDetail> =>
      request('/sellers/me', { schema: sellerDetailSchema, signal }),
    updateProfile: (body: UpdateSellerProfileRequest): Promise<SellerDetail> =>
      request('/sellers/me', { method: 'PATCH', body, schema: sellerDetailSchema }),
    uploadDocument: (
      file: File,
      type: SellerDocumentType,
      description?: string,
    ): Promise<SellerDocumentDto> => {
      const form = new FormData();
      form.append('type', type);
      if (description) form.append('description', description);
      form.append('file', file);
      return request('/sellers/me/documents', {
        method: 'POST',
        body: form,
        schema: sellerDocumentSchema,
      });
    },
    deleteDocument: (documentId: string) =>
      request(`/sellers/me/documents/${id(documentId)}`, {
        method: 'DELETE',
        schema: noContent,
      }).then(() => undefined),
    document: (documentId: string): Promise<Blob> =>
      request(`/sellers/me/documents/${id(documentId)}/content`, {
        schema: blob,
        responseType: 'blob',
      }),
    submit: (): Promise<SellerDetail> =>
      request('/sellers/me/submit', { method: 'POST', schema: sellerDetailSchema }),

    stores: {
      mine: (signal?: AbortSignal): Promise<MyStores> =>
        request('/stores/mine', { schema: myStoresSchema, signal }),
      get: (storeId: string, signal?: AbortSignal): Promise<StoreDto> =>
        request(`/stores/${id(storeId)}`, { schema: storeSchema, signal }),
      slugAvailability: (slug: string, signal?: AbortSignal): Promise<SlugAvailability> =>
        request('/stores/slug-availability', {
          query: { slug },
          schema: slugAvailabilitySchema,
          signal,
        }),
      create: (body: CreateStoreRequest): Promise<StoreDto> =>
        request('/stores', { method: 'POST', body, schema: storeSchema }),
      update: (storeId: string, body: UpdateStoreRequest): Promise<StoreDto> =>
        request(`/stores/${id(storeId)}`, { method: 'PATCH', body, schema: storeSchema }),
      updateSettings: (storeId: string, body: UpdateStoreSettingsRequest): Promise<StoreDto> =>
        request(`/stores/${id(storeId)}/settings`, { method: 'PUT', body, schema: storeSchema }),
      setImage: (storeId: string, kind: 'logo' | 'banner', file: File): Promise<StoreDto> => {
        const form = new FormData();
        form.append('file', file);
        return request(`/stores/${id(storeId)}/${kind}`, {
          method: 'PUT',
          body: form,
          schema: storeSchema,
        });
      },
      removeImage: (storeId: string, kind: 'logo' | 'banner'): Promise<StoreDto> =>
        request(`/stores/${id(storeId)}/${kind}`, { method: 'DELETE', schema: storeSchema }),
      setOpen: (storeId: string, open: boolean): Promise<StoreDto> =>
        request(`/stores/${id(storeId)}/${open ? 'open' : 'close'}`, {
          method: 'POST',
          schema: storeSchema,
        }),
    },

    members: {
      team: (signal?: AbortSignal): Promise<SellerTeam> =>
        request('/seller/members', { schema: sellerTeamSchema, signal }),
      invite: (body: InviteSellerMemberRequest) =>
        request('/seller/members/invitations', {
          method: 'POST',
          body,
          schema: z.object({ id: z.string() }),
        }),
      resendInvitation: (invitationId: string) =>
        request(`/seller/members/invitations/${id(invitationId)}/resend`, {
          method: 'POST',
          schema: noContent,
        }).then(() => undefined),
      revokeInvitation: (invitationId: string) =>
        request(`/seller/members/invitations/${id(invitationId)}`, {
          method: 'DELETE',
          schema: noContent,
        }).then(() => undefined),
      update: (memberId: string, body: UpdateSellerMemberRequest): Promise<SellerMemberDto> =>
        request(`/seller/members/${id(memberId)}`, {
          method: 'PATCH',
          body,
          schema: sellerMemberSchema,
        }),
      setSuspended: (memberId: string, suspended: boolean): Promise<SellerMemberDto> =>
        request(`/seller/members/${id(memberId)}/${suspended ? 'suspend' : 'reactivate'}`, {
          method: 'POST',
          schema: sellerMemberSchema,
        }),
      remove: (memberId: string) =>
        request(`/seller/members/${id(memberId)}`, { method: 'DELETE', schema: noContent }).then(
          () => undefined,
        ),
    },
  };
}

/** Public store page data (storefront). */
export function createStoresPublicClient(request: Request) {
  return {
    bySlug: (slug: string, signal?: AbortSignal): Promise<PublicStore> =>
      request(`/stores/by-slug/${encodeURIComponent(slug)}`, { schema: publicStoreSchema, signal }),
  };
}
