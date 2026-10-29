/**
 * Drops blank values from an environment map. `.env` files document optional settings as empty
 * assignments (`SMTP_HOST=`), which dotenv loads as empty strings; schemas treat those as unset.
 */
export function withoutBlankValues(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
}
