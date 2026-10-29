/**
 * Canonical form for storing and comparing email addresses, the single address normalisation used
 * by sign-in, identity ownership and the migration gate (backlog D5, D5.1):
 * Unicode NFC, then trimmed, then lower-cased.
 *
 * `toLowerCase()` is not full Unicode case folding; for the ASCII addresses the platform handles it
 * is equivalent, and the same function is used everywhere so two paths can never disagree. This is
 * an implementation assumption recorded in the Increment 1b phase 1 report, not a product decision.
 */
export function normaliseEmail(email: string): string {
  return email.normalize('NFC').trim().toLowerCase();
}
