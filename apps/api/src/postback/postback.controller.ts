import { Controller, Get, Param, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostbackQuery } from '../providers/provider.types';
import { PostbackService } from './postback.service';

// Public server-to-server endpoint. Networks call GET /postback/:provider with
// their params + signature. Security is the per-provider signature, not a JWT.
// Not rate-limited — networks legitimately burst postbacks.
@SkipThrottle()
@Controller('postback')
export class PostbackController {
  constructor(private readonly postback: PostbackService) {}

  @Get(':provider')
  async receive(@Param('provider') provider: string, @Query() query: PostbackQuery) {
    const { ack } = await this.postback.handle(provider, query);
    return ack; // plain-text acknowledgement the network expects
  }
}
