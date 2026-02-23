/**
 * Purpose: Provides reusable helper utilities for the Step 8 client page rendering logic.
 * Inputs: Conversation-shaped objects and timestamp strings.
 * Outputs: Sorted conversation payloads and formatted timestamps for UI display.
 */
export type SortableResponse = {
  id: number;
  sequence: number;
};

export type SortablePrompt = {
  id: number;
  sequence: number;
  responses: SortableResponse[];
};

export type SortableConversation = {
  prompts: SortablePrompt[];
};

export function sortConversation<TConversation extends SortableConversation>(
  conversation: TConversation
): TConversation {
  /**
   * Purpose: Applies stable ordering to prompt/response lists before rendering.
   * Inputs: Conversation payload with unordered prompt/response sequences.
   * Outputs: Conversation payload with prompts/responses sorted by sequence, then id.
   */
  const prompts = [...conversation.prompts]
    .sort((left, right) => left.sequence - right.sequence || left.id - right.id)
    .map((prompt) => ({
      ...prompt,
      responses: [...prompt.responses].sort(
        (left, right) => left.sequence - right.sequence || left.id - right.id
      )
    }));

  return {
    ...conversation,
    prompts
  } as TConversation;
}

export function formatTimestamp(value: string | null): string {
  /**
   * Purpose: Formats ISO timestamp values into concise local display text.
   * Inputs: ISO datetime string or null.
   * Outputs: Human-readable local timestamp or fallback placeholder.
   */
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}
