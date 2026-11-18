/**
 * Cheap checks on what the server sent. They do not validate every field: they catch a response
 * that is not even the right kind of thing, so the extension reports a mismatch instead of
 * failing later with "cannot read properties of undefined".
 */
export type Check = (value: unknown) => boolean;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An object that has all of these keys. */
export const object = (...keys: string[]): Check => (v) => isObject(v) && keys.every((k) => k in v);

/** An array whose elements (if any) pass `item`. Only the first element is looked at. */
export const array = (item?: Check): Check => (v) => Array.isArray(v) && (v.length === 0 || !item || item(v[0]));

/** An object whose `key` is an array (`{ items: [...] }`). */
export const withArray = (key: string, item?: Check): Check => (v) => isObject(v) && array(item)(v[key]);

export const any: Check = () => true;
