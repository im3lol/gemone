import { HttpStatus, ParseUUIDPipe, ValidationPipe } from '@nestjs/common';
import type { ValidationError as ClassValidatorError } from 'class-validator';
import type { FieldError } from '@gemone/contracts';

import { ValidationError } from './app-error';

/**
 * The global validation pipe — ARCHITECTURE.md §6.2, step 9.
 *
 * Built by a factory rather than constructed inline in main.ts so that the
 * integration tests use the identical pipe. A test that configures its own
 * approximation of the production pipeline verifies an application that does
 * not ship.
 *
 * Two things it fixes over the stock configuration:
 *
 *  1. It raises our own `ValidationError`, which carries the taxonomy's 422
 *     rather than the pipe's default 400. A client seeing 422 from a service
 *     rule and 400 from a DTO rule for the same class of problem has to learn
 *     two things instead of one (§15.1).
 *
 *  2. It emits per-field detail in the shape `ApiErrorResponse.fields`
 *     documents. Without this the contract promises field errors that nothing
 *     ever produces.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    // Strip properties with no decorator, and reject payloads that carry
    // them (§19.3). Silently ignoring unknown properties is how a client
    // keeps sending a field it believes is doing something — `role: "ADMIN"`
    // on a registration request being the obvious example.
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) =>
      new ValidationError('Validation failed', flatten(errors as ClassValidatorError[])),
  });
}

/**
 * Flattens class-validator's nested error tree into flat `field: message`
 * pairs, joining nested paths with dots.
 *
 * The nested shape mirrors the DTO's structure, which is an implementation
 * detail of how validation happens. Clients want to know which field to fix.
 */
function flatten(errors: ClassValidatorError[], parentPath = ''): FieldError[] {
  const flattened: FieldError[] = [];

  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;

    for (const message of Object.values(error.constraints ?? {})) {
      flattened.push({ field: path, message });
    }

    if (error.children && error.children.length > 0) {
      flattened.push(...flatten(error.children, path));
    }
  }

  return flattened;
}

export const __testing = { flatten };

/**
 * Parses a UUID path parameter, reporting failures the same way body
 * validation does.
 *
 * Nest's ParseUUIDPipe defaults to 400 while the taxonomy (§15.1) and the
 * global validation pipe use 422. A client seeing 422 for a malformed body
 * field and 400 for a malformed path id has to learn two things about one
 * class of problem.
 */
export function createUuidPipe(): ParseUUIDPipe {
  return new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });
}
