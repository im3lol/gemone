/*
 * Relative specifiers carry a `.js` extension throughout this package, here and
 * in the two modules that import a sibling.
 *
 * TypeScript never rewrites a module specifier, so an extensionless `'./auth'`
 * is emitted verbatim into the ESM build — and Node's ESM resolver, unlike
 * CommonJS's, does not guess extensions. Writing `.js` in the *source* is what
 * makes one set of files emit correctly as both. TypeScript resolves it back to
 * `auth.ts` for typechecking, so nothing about editing changes.
 */
export * from './admin.js';
export * from './auth.js';
export * from './clicks.js';
export * from './configuration.js';
export * from './conversions.js';
export * from './errors.js';
export * from './fraud.js';
export * from './health.js';
export * from './offers.js';
export * from './payouts.js';
export * from './postbacks.js';
export * from './providers.js';
export * from './rewards.js';
