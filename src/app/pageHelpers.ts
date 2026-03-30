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
export function sortConversation<TConversation extends SortableConversation>(conversation: TConversation): TConversation {
    const prompts = [...conversation.prompts]
        .sort((left, right) => left.sequence - right.sequence || left.id - right.id)
        .map((prompt) => ({
        ...prompt,
        responses: [...prompt.responses].sort((left, right) => left.sequence - right.sequence || left.id - right.id)
    }));
    return {
        ...conversation,
        prompts
    } as TConversation;
}
export function formatTimestamp(value: string | null): string {
    if (!value) {
        return "N/A";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString();
}
