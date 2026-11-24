import {
  acceptInvitationSchema,
  auditLogQuerySchema,
  changePasswordSchema,
  createStaffUserSchema,
  customerSignUpSchema,
  emailSignInSchema,
  forgotPasswordSchema,
  mobileSignInSchema,
  otpResendSchema,
  otpVerifySchema,
  resetPasswordSchema,
  reviewWholesaleSchema,
  updateRolePermissionsSchema,
  updateUserSchema,
  userListQuerySchema,
  verifyEmailSchema,
  wholesaleBusinessSchema,
  wholesaleListQuerySchema,
} from '@marketplace/validation';
import { createZodDto } from '../../common/validation/zod-dto';

export class CustomerSignUpDto extends createZodDto(customerSignUpSchema) {}
export class OtpVerifyDto extends createZodDto(otpVerifySchema) {}
export class OtpResendDto extends createZodDto(otpResendSchema) {}
export class MobileSignInDto extends createZodDto(mobileSignInSchema) {}
export class EmailSignInDto extends createZodDto(emailSignInSchema) {}
export class VerifyEmailDto extends createZodDto(verifyEmailSchema) {}
export class ForgotPasswordDto extends createZodDto(forgotPasswordSchema) {}
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}
export class AcceptInvitationDto extends createZodDto(acceptInvitationSchema) {}
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}

export class CreateStaffUserDto extends createZodDto(createStaffUserSchema) {}
export class UpdateUserDto extends createZodDto(updateUserSchema) {}
export class UserListQueryDto extends createZodDto(userListQuerySchema) {}
export class UpdateRolePermissionsDto extends createZodDto(updateRolePermissionsSchema) {}
export class WholesaleBusinessDto extends createZodDto(wholesaleBusinessSchema) {}
export class WholesaleListQueryDto extends createZodDto(wholesaleListQuerySchema) {}
export class ReviewWholesaleDto extends createZodDto(reviewWholesaleSchema) {}
export class AuditLogQueryDto extends createZodDto(auditLogQuerySchema) {}
