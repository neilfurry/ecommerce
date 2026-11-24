import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission, UserRole } from '@marketplace/shared-types';
import {
  isMfaChallenge,
  type AcceptSellerInvitationRequest,
  type CreateStoreRequest,
  type InviteSellerMemberRequest,
  type ReviewSellerRequest,
  type SellerListQuery,
  type SellerSignUpRequest,
  type SignInResult,
  type StoreListQuery,
  type UpdateSellerMemberRequest,
  type UpdateSellerProfileRequest,
  type UpdateStoreRequest,
  type UpdateStoreSettingsRequest,
  type AuditLogQuery,
  type CreateStaffUserRequest,
  type CustomerSignUpRequest,
  type ReviewWholesaleRequest,
  type SessionResponse,
  type UpdateUserRequest,
  type UserListQuery,
  type WholesaleBusiness,
  type WholesaleListQuery,
} from '@marketplace/validation';
import { useEffect } from 'react';
import { queryKeys, useApiClient } from './react';

// ---- Session ----------------------------------------------------------------------------

/** The signed-in user of this app, or null. Never throws for "signed out". */
export function useSession() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: ({ signal }) => client.auth.session(signal),
    staleTime: 60_000,
  });
}

/** True when the session holds the permission (SUPER_ADMIN holds every permission). */
export function hasPermission(
  session: SessionResponse | null | undefined,
  permission: Permission,
): boolean {
  return !!session?.user.permissions.includes(permission);
}

export function hasRole(session: SessionResponse | null | undefined, role: UserRole): boolean {
  return !!session?.user.roles.includes(role);
}

/**
 * Keeps the cached session in step with the API: when a request finds the session ended
 * (signed out elsewhere, suspended, expired), every cached query is dropped and the
 * session becomes null, which sends protected routes to sign-in.
 */
export function SessionSync() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  useEffect(
    () =>
      client.onSessionEnded(() => {
        queryClient.removeQueries({
          predicate: (query) => query.queryKey[0] !== queryKeys.session[0],
        });
        queryClient.setQueryData(queryKeys.session, null);
      }),
    [client, queryClient],
  );
  return null;
}

/**
 * Mutations that end in a new session store it, so the UI updates without a refetch. A
 * sign-in may instead return an MFA challenge; then nothing changes until the code is sent.
 */
function useSessionMutation<TInput, TResult extends SignInResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (result) => {
      if (isMfaChallenge(result)) return;
      // A different person may have signed in on this device: drop the previous user's data.
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== queryKeys.session[0],
      });
      queryClient.setQueryData(queryKeys.session, result);
    },
  });
}

export function useVerifyMfa() {
  const client = useApiClient();
  return useSessionMutation(({ mfaToken, code }: { mfaToken: string; code: string }) =>
    client.auth.verifyMfa(mfaToken, code),
  );
}

export function useSignUpSeller() {
  const client = useApiClient();
  return useSessionMutation((body: SellerSignUpRequest) => client.auth.signUpSeller(body));
}

export function useSignIn() {
  const client = useApiClient();
  return useSessionMutation(({ email, password }: { email: string; password: string }) =>
    client.auth.signIn(email, password),
  );
}

export function useStartSignUp() {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body: CustomerSignUpRequest) => client.auth.startSignUp(body),
  });
}

export function useCompleteSignUp() {
  const client = useApiClient();
  return useSessionMutation(({ challengeId, code }: { challengeId: string; code: string }) =>
    client.auth.completeSignUp(challengeId, code),
  );
}

export function useResendCode() {
  const client = useApiClient();
  return useMutation({ mutationFn: (challengeId: string) => client.auth.resendCode(challengeId) });
}

export function useRequestSignInCode() {
  const client = useApiClient();
  return useMutation({ mutationFn: (mobile: string) => client.auth.requestSignInCode({ mobile }) });
}

export function useCompleteSignInWithCode() {
  const client = useApiClient();
  return useSessionMutation(({ challengeId, code }: { challengeId: string; code: string }) =>
    client.auth.completeSignInWithCode(challengeId, code),
  );
}

function useSignOutMutation(signOut: () => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    // Signed out locally even if the request failed (the server session expires anyway).
    onSettled: () => {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== queryKeys.session[0],
      });
      queryClient.setQueryData(queryKeys.session, null);
    },
  });
}

export function useSignOut() {
  const client = useApiClient();
  return useSignOutMutation(() => client.auth.signOut());
}

export function useSignOutEverywhere() {
  const client = useApiClient();
  return useSignOutMutation(() => client.auth.signOutEverywhere());
}

function useInvalidatingMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  keys: readonly (readonly unknown[])[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  });
}

export function useVerifyEmail() {
  const client = useApiClient();
  return useInvalidatingMutation(
    (token: string) => client.auth.verifyEmail(token),
    [queryKeys.session],
  );
}

export function useResendVerificationEmail() {
  const client = useApiClient();
  return useMutation({ mutationFn: () => client.auth.resendVerificationEmail() });
}

export function useForgotPassword() {
  const client = useApiClient();
  return useMutation({ mutationFn: (email: string) => client.auth.forgotPassword(email) });
}

export function useResetPassword() {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) =>
      client.auth.resetPassword(token, password),
  });
}

export function useAcceptInvitation() {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) =>
      client.auth.acceptInvitation(token, password),
  });
}

export function useChangePassword() {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({
      currentPassword,
      newPassword,
    }: {
      currentPassword: string;
      newPassword: string;
    }) => client.auth.changePassword(currentPassword, newPassword),
  });
}

// ---- Customer account -------------------------------------------------------------------

export function useMyWholesaleApplication(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.account.wholesale,
    queryFn: ({ signal }) => client.account.wholesaleApplication(signal),
    enabled,
  });
}

export function useApplyForWholesale() {
  const client = useApiClient();
  return useInvalidatingMutation(
    (body: WholesaleBusiness) => client.account.applyForWholesale(body),
    [queryKeys.account.wholesale, queryKeys.session],
  );
}

// ---- Administration ---------------------------------------------------------------------

export function useAdminUsers(query: UserListQuery) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.admin.users(query),
    queryFn: ({ signal }) => client.admin.users.list(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAdminUser(userId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.admin.user(userId ?? ''),
    queryFn: ({ signal }) => client.admin.users.get(userId!, signal),
    enabled: !!userId,
  });
}

function useAdminMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  return useInvalidatingMutation(mutationFn, [queryKeys.admin.all]);
}

export function useCreateStaffUser() {
  const client = useApiClient();
  return useAdminMutation((body: CreateStaffUserRequest) => client.admin.users.create(body));
}

export function useUpdateUser() {
  const client = useApiClient();
  return useAdminMutation(({ userId, body }: { userId: string; body: UpdateUserRequest }) =>
    client.admin.users.update(userId, body),
  );
}

export function useSuspendUser() {
  const client = useApiClient();
  return useAdminMutation((userId: string) => client.admin.users.suspend(userId));
}

export function useReactivateUser() {
  const client = useApiClient();
  return useAdminMutation((userId: string) => client.admin.users.reactivate(userId));
}

export function useRevokeUserSessions() {
  const client = useApiClient();
  return useAdminMutation((userId: string) => client.admin.users.revokeSessions(userId));
}

export function useResendInvitation() {
  const client = useApiClient();
  return useAdminMutation((userId: string) => client.admin.users.resendInvitation(userId));
}

export function useRoles() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.admin.roles,
    queryFn: ({ signal }) => client.admin.roles.list(signal),
  });
}

export function useUpdateRolePermissions() {
  const client = useApiClient();
  // The signed-in admin's own permissions may have changed too.
  return useInvalidatingMutation(
    ({ code, permissions }: { code: UserRole; permissions: Permission[] }) =>
      client.admin.roles.updatePermissions(code, permissions),
    [queryKeys.admin.all, queryKeys.session],
  );
}

export function useWholesaleApplications(query: WholesaleListQuery) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.admin.wholesale(query),
    queryFn: ({ signal }) => client.admin.wholesale.list(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useReviewWholesale() {
  const client = useApiClient();
  return useAdminMutation(({ id, body }: { id: string; body: ReviewWholesaleRequest }) =>
    client.admin.wholesale.review(id, body),
  );
}

export function useAuditLogs(query: AuditLogQuery) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.admin.auditLogs(query),
    queryFn: ({ signal }) => client.admin.auditLogs.list(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useSmsOutbox() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.dev.smsOutbox,
    queryFn: ({ signal }) => client.devTools.smsOutbox(signal),
    refetchInterval: 3_000,
  });
}

// ---- Two-step verification settings --------------------------------------------------------

export function useMfaStatus() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.mfa,
    queryFn: ({ signal }) => client.auth.mfa.status(signal),
  });
}

export function useMfaSetup() {
  const client = useApiClient();
  return useMutation({ mutationFn: (password: string) => client.auth.mfa.setup(password) });
}

export function useMfaEnable() {
  const client = useApiClient();
  return useInvalidatingMutation(
    (code: string) => client.auth.mfa.enable(code),
    [queryKeys.mfa, queryKeys.session],
  );
}

export function useMfaRegenerate() {
  const client = useApiClient();
  return useInvalidatingMutation(
    (code: string) => client.auth.mfa.regenerate(code),
    [queryKeys.mfa],
  );
}

export function useMfaDisable() {
  const client = useApiClient();
  return useInvalidatingMutation(
    ({ password, code }: { password: string; code: string }) =>
      client.auth.mfa.disable(password, code),
    [queryKeys.mfa, queryKeys.session],
  );
}

export function useResetUserMfa() {
  const client = useApiClient();
  return useAdminMutation((userId: string) => client.admin.resetUserMfa(userId));
}

// ---- Admin: permissions, sellers and stores --------------------------------------------------

export function usePermissionCatalog() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.admin.permissions,
    queryFn: ({ signal }) => client.admin.permissions(signal),
  });
}

export function useAdminSellers(query: SellerListQuery) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.admin.sellers(query),
    queryFn: ({ signal }) => client.admin.sellers.list(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAdminSeller(sellerId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.admin.seller(sellerId ?? ''),
    queryFn: ({ signal }) => client.admin.sellers.get(sellerId!, signal),
    enabled: !!sellerId,
  });
}

export function useReviewSeller() {
  const client = useApiClient();
  return useAdminMutation(({ sellerId, body }: { sellerId: string; body: ReviewSellerRequest }) =>
    client.admin.sellers.review(sellerId, body),
  );
}

export function useSellerStatusAction() {
  const client = useApiClient();
  return useAdminMutation(
    ({
      sellerId,
      action,
      reason,
    }: {
      sellerId: string;
      action: 'suspend' | 'reinstate' | 'close';
      reason: string;
    }) => client.admin.sellers[action](sellerId, reason),
  );
}

export function useAdminStores(query: StoreListQuery) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.admin.stores(query),
    queryFn: ({ signal }) => client.admin.stores.list(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useStoreStatusAction() {
  const client = useApiClient();
  return useAdminMutation(
    ({
      storeId,
      action,
      reason,
    }: {
      storeId: string;
      action: 'suspend' | 'reinstate';
      reason: string;
    }) => client.admin.stores[action](storeId, reason),
  );
}

// ---- Seller Center ----------------------------------------------------------------------------

export function useSellerProfile() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.seller.profile,
    queryFn: ({ signal }) => client.seller.profile(signal),
  });
}

function useSellerMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  // Seller changes can change the session (seller status, permissions) too.
  return useInvalidatingMutation(mutationFn, [queryKeys.seller.all, queryKeys.session]);
}

export function useUpdateSellerProfile() {
  const client = useApiClient();
  return useSellerMutation((body: UpdateSellerProfileRequest) => client.seller.updateProfile(body));
}

export function useUploadSellerDocument() {
  const client = useApiClient();
  return useSellerMutation(
    ({
      file,
      type,
      description,
    }: {
      file: File;
      type: Parameters<typeof client.seller.uploadDocument>[1];
      description?: string;
    }) => client.seller.uploadDocument(file, type, description),
  );
}

export function useDeleteSellerDocument() {
  const client = useApiClient();
  return useSellerMutation((documentId: string) => client.seller.deleteDocument(documentId));
}

export function useSubmitSellerApplication() {
  const client = useApiClient();
  return useSellerMutation(() => client.seller.submit());
}

export function useMyStores() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.seller.stores,
    queryFn: ({ signal }) => client.seller.stores.mine(signal),
  });
}

export function useCreateStore() {
  const client = useApiClient();
  return useSellerMutation((body: CreateStoreRequest) => client.seller.stores.create(body));
}

export function useUpdateStore() {
  const client = useApiClient();
  return useSellerMutation(({ storeId, body }: { storeId: string; body: UpdateStoreRequest }) =>
    client.seller.stores.update(storeId, body),
  );
}

export function useUpdateStoreSettings() {
  const client = useApiClient();
  return useSellerMutation(
    ({ storeId, body }: { storeId: string; body: UpdateStoreSettingsRequest }) =>
      client.seller.stores.updateSettings(storeId, body),
  );
}

export function useStoreImage() {
  const client = useApiClient();
  return useSellerMutation(
    ({ storeId, kind, file }: { storeId: string; kind: 'logo' | 'banner'; file: File | null }) =>
      file
        ? client.seller.stores.setImage(storeId, kind, file)
        : client.seller.stores.removeImage(storeId, kind),
  );
}

export function useSetStoreOpen() {
  const client = useApiClient();
  return useSellerMutation(({ storeId, open }: { storeId: string; open: boolean }) =>
    client.seller.stores.setOpen(storeId, open),
  );
}

export function useSellerTeam(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.seller.team,
    queryFn: ({ signal }) => client.seller.members.team(signal),
    enabled,
  });
}

export function useInviteSellerMember() {
  const client = useApiClient();
  return useSellerMutation((body: InviteSellerMemberRequest) => client.seller.members.invite(body));
}

export function useSellerInvitationAction() {
  const client = useApiClient();
  return useSellerMutation(
    ({ invitationId, action }: { invitationId: string; action: 'resend' | 'revoke' }) =>
      action === 'resend'
        ? client.seller.members.resendInvitation(invitationId)
        : client.seller.members.revokeInvitation(invitationId),
  );
}

export function useUpdateSellerMember() {
  const client = useApiClient();
  return useSellerMutation(
    ({ memberId, body }: { memberId: string; body: UpdateSellerMemberRequest }) =>
      client.seller.members.update(memberId, body),
  );
}

export function useSellerMemberAction() {
  const client = useApiClient();
  return useSellerMutation(
    ({ memberId, action }: { memberId: string; action: 'suspend' | 'reactivate' | 'remove' }) =>
      action === 'remove'
        ? client.seller.members.remove(memberId)
        : client.seller.members.setSuspended(memberId, action === 'suspend'),
  );
}

export function useSellerInvitationPreview(token: string | null) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-invitation', token],
    queryFn: () => client.auth.previewSellerInvitation(token!),
    enabled: !!token,
    retry: false,
  });
}

export function useAcceptSellerInvitation() {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body: AcceptSellerInvitationRequest) => client.auth.acceptSellerInvitation(body),
  });
}
