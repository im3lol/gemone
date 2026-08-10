import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { PostbackAcknowledgement } from '@gemone/contracts';
import type { Request } from 'express';

import { Public } from '../../core/security/public.decorator';
import { PostbackIntakeService } from './postback-intake.service';

/**
 * The public postback surface — ARCHITECTURE.md §19.1 (zone 2c), §10.
 *
 * `@Public()`, and that is not a shortcut: providers cannot hold our
 * credentials, so this endpoint is unauthenticated **by necessity** (§19.2).
 * What replaces authentication is defence in depth, applied in the service —
 * IP allowlist, adapter signature, strict parsing, and a database-enforced
 * idempotency constraint, each assuming the previous one failed.
 *
 * Caddy routes `/postback/:provider` straight here, bypassing `web` entirely
 * (§6.1's exception): the caller is a provider's server, not a browser, so
 * there is no session to proxy and no reason to add a hop in front of the one
 * endpoint whose latency causes duplicates.
 *
 * **Both GET and POST**, because networks differ and the difference is not
 * ours to legislate — some send a query string, some a form body, and an
 * endpoint that accepts only one shape is an endpoint half the integrations
 * cannot use. The adapter decides what it reads.
 *
 * **No DTO.** Every other endpoint validates one and rejects unknown
 * properties (§19.3); here, unknown properties are the payload. A provider
 * adds a field and every conversion would start failing validation for a
 * field nobody needed. Validation is the adapter's `parsePostback`, which is
 * strict about what it requires and indifferent to what it does not.
 */
@Public()
@Controller('postback')
export class PostbacksController {
  constructor(private readonly intake: PostbackIntakeService) {}

  @Get(':slug')
  async receiveViaGet(
    @Param('slug') slug: string,
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<PostbackAcknowledgement> {
    return this.receive(slug, query, undefined, request);
  }

  /**
   * 200, not Nest's default 201 for a POST.
   *
   * §10.2 chooses these codes around provider retry behaviour rather than
   * REST purity, and it names 200 for both acceptance and a duplicate. Some
   * networks treat anything other than a literal 200 as a failed delivery and
   * retry it, which manufactures the duplicates the constraint then has to
   * absorb.
   */
  @Post(':slug')
  @HttpCode(HttpStatus.OK)
  async receiveViaPost(
    @Param('slug') slug: string,
    @Query() query: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<PostbackAcknowledgement> {
    return this.receive(slug, query, body, request);
  }

  private async receive(
    slug: string,
    query: Record<string, string | string[] | undefined>,
    body: unknown,
    request: RawBodyRequest<Request>,
  ): Promise<PostbackAcknowledgement> {
    return this.intake.receive({
      providerSlug: slug.trim().toLowerCase(),
      method: request.method,
      query,
      body,

      /*
       * The exact bytes, for schemes that sign the body.
       *
       * Re-serialising the parsed body would change what the signature was
       * computed over — key order, whitespace, number formatting — and turn
       * every postback from such a provider into a rejection. Populated by
       * `rawBody: true` on the application; absent when there was no body.
       */
      ...(request.rawBody === undefined
        ? {}
        : { rawBody: request.rawBody.toString('utf8') }),

      headers: request.headers,

      /*
       * `request.ip` honours `trust proxy` (§19.5). Behind Caddy this is the
       * provider's address; with nothing in front it is the connecting socket
       * and `X-Forwarded-For` is ignored — which is what keeps the allowlist
       * from being a check the caller can pass by sending a header.
       */
      sourceIp: request.ip ?? null,
    });
  }
}
