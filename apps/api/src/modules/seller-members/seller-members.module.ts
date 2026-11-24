import { Module } from '@nestjs/common';
import { SellerInvitationsController, SellerMembersController } from './seller-members.controller';
import { SellerMembersService } from './seller-members.service';

@Module({
  controllers: [SellerMembersController, SellerInvitationsController],
  providers: [SellerMembersService],
})
export class SellerMembersModule {}
