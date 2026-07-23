/**
 * The CLI version. Duplicated from package.json because the compiled dist/ and
 * the tsx dev entry resolve package.json at different relative depths, and a
 * runtime read would be fragile across both. test/version.test.ts fails if this
 * ever drifts from package.json, so the duplication cannot go stale silently.
 */
export const VERSION = "0.1.0";
