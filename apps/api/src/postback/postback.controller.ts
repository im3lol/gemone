import { Controller, Get, Headers, HttpCode, Param, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { PostbackQuery } from '../providers/provider.types';
import { PostbackService } from './postback.service';

// Public server-to-server endpoint. Networks call GET /postback/:provider with
// their params + signature. Security is the per-provider signature, not a JWT.
// Not rate-limited — networks legitimately burst postbacks.
@SkipThrottle()
@Controller('postback')
export class PostbackController {
  constructor(private readonly postback: PostbackService) {}

  // AdGem v3 real integration: POST JSON body + `Signature` header (HMAC of the
  // raw body). Declared before the generic GET so it takes the /adgem/v3 path.
  @Post('adgem/v3')
  @HttpCode(200) // AdGem expects a 200 (Nest would default POST to 201)
  async adgemV3(@Req() req: RawBodyRequest<Request>, @Headers('signature') signature?: string) {
    const { ack } = await this.postback.handleAdgemV3(req.rawBody, signature);
    return ack; // AdGem expects a 200 with body "OK"
  }

  @Get(':provider')
  async receive(@Param('provider') provider: string, @Query() query: PostbackQuery) {
    const { ack } = await this.postback.handle(provider, query);
    return ack; // plain-text acknowledgement the network expects
  }
}
