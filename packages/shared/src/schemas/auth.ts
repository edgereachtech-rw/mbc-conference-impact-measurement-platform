import { z } from 'zod';

/**
 * Roles as stored in user_account.role (backlog section 2). `analyst` and `support` are retired
 * (decisions of 2026-10-29, D8 item 7): they remain in the enum only until no account carries
 * them, cannot authenticate and cannot be assigned.
 */
export const userRoles = ['delegate', 'admin', 'analyst', 'support', 'speaker'] as const;
export type UserRole = (typeof userRoles)[number];

export const participationModes = ['physical', 'virtual'] as const;

/** Trimmed, lower-cased email; matches the database's lower(email) uniqueness rule. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address' }))
  .pipe(z.string().max(254));

/**
 * A relative path inside the app, used to return to a deep link after sign-in. Exactly one leading
 * slash: `//host` and `/\host` are protocol-relative URLs in browsers, so a second slash or any
 * backslash is rejected, as are whitespace and control characters.
 */
export const relativePathSchema = z
  .string()
  .max(512)
  .regex(/^\/(?![/\\])[^\s\\]*$/, { error: 'Must be a relative path' })
  .refine((value) => [...value].every((ch) => ch.charCodeAt(0) > 0x1f && ch !== '\u007f'), {
    error: 'Must be a relative path',
  });

/** The path when it is a safe in-app destination, otherwise undefined. */
export function safeReturnPath(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const parsed = relativePathSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export const magicLinkRequestSchema = z.object({
  email: emailSchema,
  next: relativePathSchema.optional(),
});
export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

/** Always the same body, whatever the email, so accounts cannot be enumerated. */
export const magicLinkRequestedSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
});

export const verifyTokenSchema = z.object({
  token: z.string().min(20).max(256),
});

export const verifyCodeSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .transform((c) => c.replace(/\s+/g, ''))
    .pipe(z.string().regex(/^\d{6}$/, { error: 'The code has 6 digits' })),
});

export const verifyRequestSchema = z.union([verifyTokenSchema, verifyCodeSchema]);
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

export const sessionUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(userRoles),
  displayName: z.string(),
  delegate: z
    .object({
      id: z.uuid(),
      eventId: z.uuid(),
      name: z.string(),
      attendanceFormat: z.enum(participationModes),
    })
    .nullable(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const verifiedSchema = z.object({
  ok: z.literal(true),
  user: sessionUserSchema,
  next: z.string(),
});

/** Fields an admin or support user may correct on a delegate record (E2-4 subset). */
export const delegatePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    organisation: z.string().trim().max(200).nullable(),
    jobTitle: z.string().trim().max(200).nullable(),
    country: z.string().trim().max(100).nullable(),
    attendanceFormat: z.enum(participationModes),
    capacity: z.enum(['individual', 'nominee', 'other']),
    /** E2-5: active, pending or cancelled by an admin; duplicate and test are never set this way. */
    registrationStatus: z.enum(['active', 'pending', 'cancelled']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' });
export type DelegatePatch = z.infer<typeof delegatePatchSchema>;

/** Staff roles an admin may create or assign (E3-9: no analyst or support role). */
export const staffRoles = ['admin', 'speaker'] as const;

export const staffCreateSchema = z.object({
  email: emailSchema,
  role: z.enum(staffRoles),
});
export type StaffCreate = z.infer<typeof staffCreateSchema>;

export const staffPatchSchema = z
  .object({
    status: z.enum(['active', 'inactive']),
    role: z.enum(staffRoles),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'Nothing to update' });
export type StaffPatch = z.infer<typeof staffPatchSchema>;
