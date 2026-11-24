import {
  acceptInvitationSchema,
  auditLogQuerySchema,
  changePasswordSchema,
  createStaffUserSchema,
  customerSignUpSchema,
  emailSignInSchema,
  forgotPasswordSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaRegenerateSchema,
  mfaSetupRequestSchema,
  mfaVerifySchema,
  mobileSignInSchema,
  otpResendSchema,
  otpVerifySchema,
  resetPasswordSchema,
  reviewWholesaleSchema,
  sellerSignUpSchema,
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
export class MfaVerifyDto extends createZodDto(mfaVerifySchema) {}
export class MfaSetupDto extends createZodDto(mfaSetupRequestSchema) {}
export class MfaEnableDto extends createZodDto(mfaEnableSchema) {}
export class MfaDisableDto extends createZodDto(mfaDisableSchema) {}
export class MfaRegenerateDto extends createZodDto(mfaRegenerateSchema) {}
export class SellerSignUpDto extends createZodDto(sellerSignUpSchema) {}

export class CreateStaffUserDto extends createZodDto(createStaffUserSchema) {}
export class UpdateUserDto extends createZodDto(updateUserSchema) {}
export class UserListQueryDto extends createZodDto(userListQuerySchema) {}
export class UpdateRolePermissionsDto extends createZodDto(updateRolePermissionsSchema) {}
export class WholesaleBusinessDto extends createZodDto(wholesaleBusinessSchema) {}
export class WholesaleListQueryDto extends createZodDto(wholesaleListQuerySchema) {}
export class ReviewWholesaleDto extends createZodDto(reviewWholesaleSchema) {}
export class AuditLogQueryDto extends createZodDto(auditLogQuerySchema) {}
