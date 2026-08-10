/**
 * Injection token for the sub_id signer.
 *
 * Declared in its own file so `clicks.service.ts` can inject it without
 * importing the module that provides it — a file cycle, which §5 rule 9
 * forbids inside a module as firmly as between them.
 */
export const SUB_ID_SIGNER = Symbol('SUB_ID_SIGNER');
