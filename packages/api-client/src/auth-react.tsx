import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission, UserRole } from '@marketplace/shared-types';
import type {
  AuditLogQuery,
  CreateStaffUserRequest,
  CustomerSignUpRequest,
  ReviewWholesaleRequest,
  SessionResponse,
  UpdateUserRequest,
  UserListQuery,
  WholesaleBusiness,
  WholesaleListQuery,
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

/** Mutations that end in a new session store it, so the UI updates without a refetch. */
function useSessionMutation<TInput>(mutationFn: (input: TInput) => Promise<SessionResponse>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (session) => {
      // A different person may have signed in on this device: drop the previous user's data.
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== queryKeys.session[0],
      });
      queryClient.setQueryData(queryKeys.session, session);
    },
  });
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
