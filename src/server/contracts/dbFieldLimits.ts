/**
 * Purpose: Defines schema-backed size limits used by request validation.
 * Inputs: None.
 * Outputs: Immutable DB field-size constants aligned to Prisma schema.
 */
export const DB_FIELD_LIMITS = {
  account: {
    email: 255,
    passwordHash: 255
  },
  panel: {
    name: 255,
    description: 255
  },
  expert: {
    name: 255,
    specialization: 255
  },
  conversation: {
    name: 255
  }
} as const;

export const AUTH_LIMITS = {
  passwordMin: 8,
  passwordMax: 128
} as const;
