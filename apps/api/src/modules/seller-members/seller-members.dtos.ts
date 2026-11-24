import {
  acceptSellerInvitationSchema,
  inviteSellerMemberSchema,
  tokenSchema,
  updateSellerMemberSchema,
} from '@marketplace/validation';
import { z } from 'zod';
import { createZodDto } from '../../common/validation/zod-dto';

export class InviteSellerMemberDto extends createZodDto(inviteSellerMemberSchema) {}
export class UpdateSellerMemberDto extends createZodDto(updateSellerMemberSchema) {}
export class AcceptSellerInvitationDto extends createZodDto(acceptSellerInvitationSchema) {}
export class InvitationTokenDto extends createZodDto(z.object({ token: tokenSchema })) {}
