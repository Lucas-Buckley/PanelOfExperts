/**
 * Purpose: Implements panel domain logic for create/list/read/update/delete operations with ownership checks.
 * Inputs: Authenticated account id plus panel payload/identifier values.
 * Outputs: Panel DTOs for API responses or mapped panel-domain errors.
 */
import { z } from "zod";

import { prisma } from "../../lib/db";
import { appConfig } from "../../config/appConfig";
import { DB_FIELD_LIMITS } from "../contracts/dbFieldLimits";

const createExpertSchema = z.object({
  name: z.string().trim().min(1).max(DB_FIELD_LIMITS.expert.name),
  specialization: z.string().trim().min(1).max(DB_FIELD_LIMITS.expert.specialization),
  soul: z.string().trim().optional().default("")
});

const createPanelSchema = z.object({
  name: z.string().trim().min(1).max(DB_FIELD_LIMITS.panel.name),
  description: z.string().trim().max(DB_FIELD_LIMITS.panel.description).nullable().optional(),
  instructions: z.string().trim().nullable().optional(),
  experts: z.array(createExpertSchema).min(1).max(appConfig.llmMaxExpertsPerPanel)
});

type CreatePanelInput = z.infer<typeof createPanelSchema>;

const updatePanelSchema = z
  .object({
    name: z.string().trim().min(1).max(DB_FIELD_LIMITS.panel.name).optional(),
    description: z.string().trim().max(DB_FIELD_LIMITS.panel.description).nullable().optional(),
    instructions: z.string().trim().nullable().optional()
  })
  .refine(
    (value) =>
      value.name !== undefined || value.description !== undefined || value.instructions !== undefined,
    {
      message: "At least one panel field must be provided."
    }
  );

type UpdatePanelInput = z.infer<typeof updatePanelSchema>;

export type PanelExpertView = {
  id: number;
  name: string;
  specialization: string;
  soul: string;
  position: number;
};

export type PanelView = {
  id: number;
  accountId: number;
  name: string;
  description: string | null;
  instructions: string | null;
  lastPromptedAt: Date | null;
  experts: PanelExpertView[];
};

class PanelServiceError extends Error {
  code: "VALIDATION" | "NOT_FOUND";
  status: 400 | 404;

  constructor(code: "VALIDATION" | "NOT_FOUND", status: 400 | 404, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function parseCreatePanelInput(input: unknown): CreatePanelInput {
  /**
   * Purpose: Validates and parses panel creation payload.
   * Inputs: Unknown request body for panel creation.
   * Outputs: Typed panel payload or throws validation error.
   */
  const parsed = createPanelSchema.safeParse(input);
  if (!parsed.success) {
    throw new PanelServiceError("VALIDATION", 400, "Invalid panel payload.");
  }

  return parsed.data;
}

function parseUpdatePanelInput(input: unknown): UpdatePanelInput {
  /**
   * Purpose: Validates and parses panel update payload.
   * Inputs: Unknown request body for panel update.
   * Outputs: Typed panel update payload or throws validation error.
   */
  const parsed = updatePanelSchema.safeParse(input);
  if (!parsed.success) {
    throw new PanelServiceError("VALIDATION", 400, "Invalid panel payload.");
  }

  return parsed.data;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  /**
   * Purpose: Normalizes optional text fields for nullable DB persistence.
   * Inputs: Optional/nullable string value.
   * Outputs: `null` when empty, otherwise trimmed content.
   */
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function createPanelForAccount(
  accountId: number,
  input: unknown
): Promise<PanelView> {
  /**
   * Purpose: Creates a panel with nested experts scoped to authenticated account ownership.
   * Inputs: Authenticated account id and panel creation payload.
   * Outputs: Created panel DTO including persisted experts with deterministic positions.
   */
  const parsed = parseCreatePanelInput(input);

  const created = await prisma.panel.create({
    data: {
      accountId,
      name: parsed.name,
      description: normalizeNullableText(parsed.description),
      instructions: normalizeNullableText(parsed.instructions),
      experts: {
        create: parsed.experts.map((expert, index) => ({
          name: expert.name,
          specialization: expert.specialization,
          soul: expert.soul,
          position: index + 1
        }))
      }
    },
    select: {
      id: true,
      accountId: true,
      name: true,
      description: true,
      instructions: true,
      lastPromptedAt: true,
      experts: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          specialization: true,
          soul: true,
          position: true
        }
      }
    }
  });

  return created;
}

export async function listPanelsForAccount(accountId: number): Promise<PanelView[]> {
  /**
   * Purpose: Lists panels belonging to a single account ordered by recency fallback order.
   * Inputs: Authenticated account id.
   * Outputs: Array of account-owned panel DTOs with ordered expert lists.
   */
  return prisma.panel.findMany({
    where: { accountId },
    orderBy: [{ lastPromptedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      accountId: true,
      name: true,
      description: true,
      instructions: true,
      lastPromptedAt: true,
      experts: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          specialization: true,
          soul: true,
          position: true
        }
      }
    }
  });
}

export async function getPanelForAccount(accountId: number, panelId: number): Promise<PanelView> {
  /**
   * Purpose: Loads one panel only when it belongs to the authenticated account.
   * Inputs: Authenticated account id and requested panel id.
   * Outputs: Panel DTO including ordered experts, or not-found error.
   */
  const panel = await prisma.panel.findFirst({
    where: {
      id: panelId,
      accountId
    },
    select: {
      id: true,
      accountId: true,
      name: true,
      description: true,
      instructions: true,
      lastPromptedAt: true,
      experts: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          specialization: true,
          soul: true,
          position: true
        }
      }
    }
  });

  if (!panel) {
    throw new PanelServiceError("NOT_FOUND", 404, "Panel not found.");
  }

  return panel;
}

export async function updatePanelForAccount(
  accountId: number,
  panelId: number,
  input: unknown
): Promise<PanelView> {
  /**
   * Purpose: Updates one account-owned panel metadata (name/description/instructions).
   * Inputs: Authenticated account id, panel id, and update payload.
   * Outputs: Updated panel DTO including expert list.
   */
  const parsed = parseUpdatePanelInput(input);

  const ownedPanel = await prisma.panel.findFirst({
    where: {
      id: panelId,
      accountId
    },
    select: { id: true }
  });

  if (!ownedPanel) {
    throw new PanelServiceError("NOT_FOUND", 404, "Panel not found.");
  }

  const updated = await prisma.panel.update({
    where: { id: panelId },
    data: {
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.description !== undefined
        ? { description: normalizeNullableText(parsed.description) }
        : {}),
      ...(parsed.instructions !== undefined
        ? { instructions: normalizeNullableText(parsed.instructions) }
        : {})
    },
    select: {
      id: true,
      accountId: true,
      name: true,
      description: true,
      instructions: true,
      lastPromptedAt: true,
      experts: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          specialization: true,
          soul: true,
          position: true
        }
      }
    }
  });

  return updated;
}

export async function deletePanelForAccount(accountId: number, panelId: number): Promise<{ id: number }> {
  /**
   * Purpose: Deletes one account-owned panel and cascaded child records.
   * Inputs: Authenticated account id and target panel id.
   * Outputs: Deleted panel id confirmation payload.
   */
  const ownedPanel = await prisma.panel.findFirst({
    where: {
      id: panelId,
      accountId
    },
    select: { id: true }
  });

  if (!ownedPanel) {
    throw new PanelServiceError("NOT_FOUND", 404, "Panel not found.");
  }

  await prisma.panel.delete({
    where: {
      id: panelId
    }
  });

  return { id: panelId };
}

export function mapPanelErrorToHttp(error: unknown): { status: number; message: string } {
  /**
   * Purpose: Maps panel-domain errors into stable HTTP error responses.
   * Inputs: Unknown thrown error.
   * Outputs: HTTP status + safe message for API response body.
   */
  if (error instanceof PanelServiceError) {
    return {
      status: error.status,
      message: error.message
    };
  }

  return {
    status: 500,
    message: "Internal server error."
  };
}
