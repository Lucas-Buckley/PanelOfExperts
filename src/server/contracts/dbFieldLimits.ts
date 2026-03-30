export const DB_FIELD_LIMITS = {
    account: {
        email: 255,
        passwordHash: 255
    },
    passwordReset: {
        tokenHash: 64
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
    },
    idempotency: {
        endpoint: 128,
        method: 8,
        key: 128,
        requestHash: 64,
        state: 16
    }
} as const;
export const AUTH_LIMITS = {
    passwordMin: 8,
    passwordMax: 128,
    resetTokenLength: 64
} as const;
