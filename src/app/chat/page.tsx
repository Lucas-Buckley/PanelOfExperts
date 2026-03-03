"use client";

/**
 * Purpose: Renders the dedicated chat workspace UI for panel conversations and prompt/response flow.
 * Inputs: Optional `panelId` query param, persisted auth session, and user interactions.
 * Outputs: Interactive chat page for conversation selection, prompt submission, and expert response history.
 */
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { formatTimestamp, sortConversation } from "../pageHelpers";

type AccountIdentity = {
  id: number;
  email: string;
};

type AuthSuccess = {
  account: AccountIdentity;
  accessToken: string;
  tokenType: "Bearer";
};

type PanelExpertView = {
  id: number;
  name: string;
  specialization: string;
  soul: string;
  position: number;
};

type PanelView = {
  id: number;
  accountId: number;
  name: string;
  description: string | null;
  instructions: string | null;
  lastPromptedAt: string | null;
  experts: PanelExpertView[];
};

type ConversationResponseView = {
  id: number;
  promptId: number;
  expertId: number;
  sequence: number;
  content: string;
  createdAt: string;
};

type ConversationPromptView = {
  id: number;
  conversationId: number;
  sequence: number;
  content: string;
  createdAt: string;
  responses: ConversationResponseView[];
};

type ConversationView = {
  id: number;
  panelId: number;
  name: string;
  lastPromptedAt: string | null;
  prompts: ConversationPromptView[];
};

type ConversationListItemView = {
  id: number;
  panelId: number;
  name: string;
  lastPromptedAt: string | null;
};

type PromptCreateResponse = {
  prompt: {
    id: number;
    conversationId: number;
    sequence: number;
    content: string;
    createdAt: string;
  };
  responses: Array<{
    id: number;
    promptId: number;
    expertId: number;
    sequence: number;
    content: string;
    createdAt: string;
  }>;
};

type ConversationTitleResponse = {
  title: string;
};

type ApiErrorShape = {
  error?: string;
};

const AUTH_STORAGE_KEY = "poe-auth";
const INVALID_ACCESS_TOKEN_MESSAGE = "Invalid or expired access token.";
const AUTO_CONVERSATION_NAME_MAX_LENGTH = 255;

function parsePositiveInteger(rawValue: string | null): number | null {
  /**
   * Purpose: Parses and validates positive integer query-string values.
   * Inputs: Raw string value from query param.
   * Outputs: Parsed positive integer or null when invalid/missing.
   */
  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function readRequestedPanelIdFromLocation(): number | null {
  /**
   * Purpose: Reads optional `panelId` query value from current browser location.
   * Inputs: Browser `window.location.search` state.
   * Outputs: Parsed positive panel id or null when missing/invalid.
   */
  if (typeof window === "undefined") {
    return null;
  }

  const query = new URLSearchParams(window.location.search);
  return parsePositiveInteger(query.get("panelId"));
}

function buildFallbackConversationName(promptContent: string): string {
  /**
   * Purpose: Derives fallback conversation name from first prompt when title generation is unavailable.
   * Inputs: Raw prompt text submitted by the user.
   * Outputs: Normalized conversation name capped to DB-safe length.
   */
  const normalized = promptContent.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return "New conversation";
  }

  return normalized.slice(0, AUTO_CONVERSATION_NAME_MAX_LENGTH);
}

async function requestJson<T>(args: {
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  accessToken?: string;
  body?: unknown;
}): Promise<T> {
  /**
   * Purpose: Sends JSON requests to internal API routes with optional bearer auth and typed response parsing.
   * Inputs: Route path, HTTP method, optional access token, and optional JSON body.
   * Outputs: Parsed success payload or thrown error message from failed responses.
   */
  const headers: Record<string, string> = {};
  if (args.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (args.accessToken) {
    headers.Authorization = `Bearer ${args.accessToken}`;
  }

  const response = await fetch(args.path, {
    method: args.method ?? "GET",
    headers,
    body: args.body !== undefined ? JSON.stringify(args.body) : undefined
  });
  const payload = (await response.json().catch(() => ({}))) as T | ApiErrorShape;

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload as T;
}

function readStoredAuth(): AuthSuccess | null {
  /**
   * Purpose: Reads persisted auth payload from localStorage for automatic client-side session resume.
   * Inputs: None.
   * Outputs: Parsed auth payload or null when missing/invalid.
   */
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthSuccess;
  } catch {
    return null;
  }
}

function writeStoredAuth(auth: AuthSuccess | null): void {
  /**
   * Purpose: Persists or clears auth payload in localStorage.
   * Inputs: Auth payload or null to clear.
   * Outputs: No return value; localStorage side effect.
   */
  if (typeof window === "undefined") {
    return;
  }

  if (!auth) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export default function ChatPage() {
  /**
   * Purpose: Hosts chat workspace controls: panel-scoped conversation list and prompt/response thread.
   * Inputs: None.
   * Outputs: Chat workspace page JSX with form handlers wired to conversation/prompt API routes.
   */
  const router = useRouter();

  const [auth, setAuth] = useState<AuthSuccess | null>(null);
  const [panels, setPanels] = useState<PanelView[]>([]);
  const [activePanelId, setActivePanelId] = useState<number | null>(null);
  const [panelConversations, setPanelConversations] = useState<ConversationListItemView[]>([]);
  const [activeConversation, setActiveConversation] = useState<ConversationView | null>(null);
  const [promptInput, setPromptInput] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const activePanel = useMemo(() => {
    /**
     * Purpose: Resolves active panel record from loaded panel list and selected id.
     * Inputs: Loaded panels and selected panel id state.
     * Outputs: Active panel object or null.
     */
    if (activePanelId === null) {
      return null;
    }

    return panels.find((panel) => panel.id === activePanelId) ?? null;
  }, [panels, activePanelId]);

  const expertNameById = useMemo(() => {
    /**
     * Purpose: Builds expert lookup map for rendering response rows under expert names.
     * Inputs: Active panel expert list.
     * Outputs: Expert id -> expert name map.
     */
    return new Map((activePanel?.experts ?? []).map((expert) => [expert.id, expert.name]));
  }, [activePanel]);

  const clearSessionForExpiredToken = useCallback((message: string): void => {
    /**
     * Purpose: Clears all authenticated client state and redirects to login dashboard after token expiry.
     * Inputs: User-facing auth-expiry error message.
     * Outputs: No return value; resets session state and navigates to dashboard.
     */
    setAuth(null);
    setPanels([]);
    setActivePanelId(null);
    setPanelConversations([]);
    setActiveConversation(null);
    writeStoredAuth(null);
    setStatusMessage("");
    setErrorMessage(message);
    router.replace("/");
  }, [router]);

  const handleApiError = useCallback((error: unknown, fallbackMessage: string): void => {
    /**
     * Purpose: Normalizes request errors and enforces token-expiry redirect behavior.
     * Inputs: Unknown thrown error and fallback message.
     * Outputs: No return value; updates error/session state.
     */
    const message = error instanceof Error ? error.message : fallbackMessage;
    if (message === INVALID_ACCESS_TOKEN_MESSAGE) {
      clearSessionForExpiredToken(message);
      return;
    }

    setErrorMessage(message);
  }, [clearSessionForExpiredToken]);

  async function loadPanels(accessToken: string): Promise<PanelView[]> {
    /**
     * Purpose: Loads account-owned panel list from API and updates local state.
     * Inputs: Bearer access token.
     * Outputs: Loaded panel list payload.
     */
    const listedPanels = await requestJson<PanelView[]>({
      path: "/api/panels",
      method: "GET",
      accessToken
    });
    setPanels(listedPanels);
    return listedPanels;
  }

  async function loadPanelConversations(accessToken: string, panelId: number): Promise<void> {
    /**
     * Purpose: Loads conversations for one panel so users can browse and open existing threads.
     * Inputs: Bearer access token and panel id.
     * Outputs: No return value; updates conversation list state for the active panel.
     */
    const listedConversations = await requestJson<ConversationListItemView[]>({
      path: `/api/conversations?panelId=${panelId}`,
      method: "GET",
      accessToken
    });
    setPanelConversations(listedConversations);
  }

  async function openConversationById(
    accessToken: string,
    conversationId: number
  ): Promise<ConversationView> {
    /**
     * Purpose: Loads a conversation by id and stores it as the active thread view.
     * Inputs: Bearer access token and target conversation id.
     * Outputs: Loaded and sorted conversation payload.
     */
    const conversation = await requestJson<ConversationView>({
      path: `/api/conversations/${conversationId}`,
      method: "GET",
      accessToken
    });
    const sortedConversation = sortConversation(conversation);
    setActiveConversation(sortedConversation);
    return sortedConversation;
  }

  async function generateConversationTitle(accessToken: string, prompt: string): Promise<string> {
    /**
     * Purpose: Requests backend-generated short title for first prompt using server-side LLM access.
     * Inputs: Bearer access token and first prompt content.
     * Outputs: Generated conversation title text.
     */
    const response = await requestJson<ConversationTitleResponse>({
      path: "/api/conversations/title",
      method: "POST",
      accessToken,
      body: { prompt }
    });

    return response.title;
  }

  useEffect(() => {
    /**
     * Purpose: Restores persisted auth, loads panel list, and initializes selected panel from query/default.
     * Inputs: Stored auth payload and optional `panelId` query param.
     * Outputs: No return value; hydrates chat workspace state.
     */
    const stored = readStoredAuth();
    if (!stored) {
      router.replace("/");
      return;
    }

    setAuth(stored);

    let cancelled = false;
    void (async () => {
      try {
        const listedPanels = await loadPanels(stored.accessToken);
        if (cancelled) {
          return;
        }

        const requestedPanelId = readRequestedPanelIdFromLocation();
        const firstPanelId = listedPanels.length > 0 ? listedPanels[0].id : null;
        const initialPanelId =
          requestedPanelId !== null && listedPanels.some((panel) => panel.id === requestedPanelId)
            ? requestedPanelId
            : firstPanelId;

        setActivePanelId(initialPanelId);
        setActiveConversation(null);

        if (initialPanelId !== null) {
          await loadPanelConversations(stored.accessToken, initialPanelId);
        } else {
          setPanelConversations([]);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        handleApiError(error, "Failed to load chat workspace.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [handleApiError, router]);

  function handleLogout(): void {
    /**
     * Purpose: Clears local auth/session state and returns user to dashboard login screen.
     * Inputs: None.
     * Outputs: No return value; clears auth-related state and navigates to `/`.
     */
    setAuth(null);
    setPanels([]);
    setActivePanelId(null);
    setPanelConversations([]);
    setActiveConversation(null);
    writeStoredAuth(null);
    router.replace("/");
  }

  async function handleSelectConversationFromList(conversationId: number): Promise<void> {
    /**
     * Purpose: Opens one conversation selected from the active-panel conversation list.
     * Inputs: Conversation id from list button click.
     * Outputs: No return value; updates active conversation and status state.
     */
    if (!auth) {
      return;
    }

    setStatusMessage("");
    setErrorMessage("");
    setIsBusy(true);
    try {
      const loadedConversation = await openConversationById(auth.accessToken, conversationId);
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 1040px)").matches) {
        setIsSidebarOpen(false);
      }
      setStatusMessage(`Loaded conversation: ${loadedConversation.name}.`);
    } catch (error) {
      handleApiError(error, "Failed to open conversation.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeleteConversation(conversation: ConversationListItemView): Promise<void> {
    /**
     * Purpose: Deletes one conversation from active-panel list and clears active view when needed.
     * Inputs: Conversation list item selected for deletion.
     * Outputs: No return value; updates list, active conversation, and status text.
     */
    if (!auth) {
      return;
    }

    if (!window.confirm(`Delete conversation "${conversation.name}"?`)) {
      return;
    }

    setStatusMessage("");
    setErrorMessage("");
    setIsBusy(true);
    try {
      await requestJson<{ id: number }>({
        path: `/api/conversations/${conversation.id}`,
        method: "DELETE",
        accessToken: auth.accessToken
      });
      if (activeConversation?.id === conversation.id) {
        setActiveConversation(null);
      }
      await loadPanelConversations(auth.accessToken, conversation.panelId);
      await loadPanels(auth.accessToken);
      setStatusMessage(`Deleted conversation: ${conversation.name}.`);
    } catch (error) {
      handleApiError(error, "Failed to delete conversation.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSubmitPrompt(event: FormEvent<HTMLFormElement>): Promise<void> {
    /**
     * Purpose: Sends a prompt, auto-creating a conversation for the active panel when one is not yet selected.
     * Inputs: Submitted prompt form event.
     * Outputs: No return value; updates active conversation prompt history.
     */
    event.preventDefault();
    if (!auth || activePanelId === null) {
      return;
    }

    const submittedPrompt = promptInput.trim();
    if (submittedPrompt.length === 0) {
      return;
    }

    setStatusMessage("");
    setErrorMessage("");
    setIsBusy(true);
    try {
      let baseConversation = activeConversation;
      if (!baseConversation) {
        let autoConversationName = buildFallbackConversationName(submittedPrompt);
        try {
          autoConversationName = await generateConversationTitle(auth.accessToken, submittedPrompt);
        } catch (titleError) {
          const message = titleError instanceof Error ? titleError.message : "";
          if (message === INVALID_ACCESS_TOKEN_MESSAGE) {
            throw titleError;
          }
        }

        const createdConversation = await requestJson<ConversationView>({
          path: "/api/conversations",
          method: "POST",
          accessToken: auth.accessToken,
          body: {
            panelId: activePanelId,
            name: autoConversationName
          }
        });
        baseConversation = sortConversation(createdConversation);
        setActiveConversation(baseConversation);
        await loadPanelConversations(auth.accessToken, activePanelId);
      }

      const created = await requestJson<PromptCreateResponse>({
        path: `/api/conversations/${baseConversation.id}/prompts`,
        method: "POST",
        accessToken: auth.accessToken,
        body: {
          content: submittedPrompt
        }
      });

      setActiveConversation((current) => {
        const currentConversation =
          current && current.id === created.prompt.conversationId ? current : baseConversation;
        if (!currentConversation) {
          return current;
        }

        const appendedPrompt: ConversationPromptView = {
          ...created.prompt,
          responses: [...created.responses].sort(
            (left, right) => left.sequence - right.sequence || left.id - right.id
          )
        };

        return sortConversation({
          ...currentConversation,
          prompts: [...currentConversation.prompts, appendedPrompt]
        });
      });

      setPromptInput("");
      setStatusMessage("Prompt submitted.");
      await loadPanels(auth.accessToken);
      await loadPanelConversations(auth.accessToken, activePanelId);
    } catch (error) {
      handleApiError(error, "Failed to submit prompt.");
    } finally {
      setIsBusy(false);
    }
  }

  function handlePromptInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    /**
     * Purpose: Submits the prompt form on Enter while preserving Shift+Enter as newline behavior.
     * Inputs: Textarea keyboard event.
     * Outputs: No return value; conditionally triggers form submit.
     */
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <main className="page">
      {auth ? (
        <div className={`workspace ${isSidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label="Close conversation sidebar"
            onClick={() => setIsSidebarOpen(false)}
          />
          <aside className="sidebar-shell">
            <div className="sidebar-top">
              <div className="sidebar-head">
                <div className="sidebar-title">
                  <h1>Panel of Experts</h1>
                  <p>Chat Workspace</p>
                </div>
              </div>

              <div className="sidebar-actions">
                <button
                  type="button"
                  className="mobile-only"
                  onClick={() => setIsSidebarOpen(false)}
                >
                  Close
                </button>
                <Link className="button-link" href="/">
                  Dashboard
                </Link>
              </div>

              {activePanel ? (
                <div className="panel-meta">
                  <p>
                    <strong>{activePanel.name}</strong>
                  </p>
                  <p>Experts:</p>
                  <ul className="panel-experts">
                    {activePanel.experts.length > 0 ? (
                      activePanel.experts.map((expert) => <li key={expert.id}>{expert.name}</li>)
                    ) : (
                      <li>None</li>
                    )}
                  </ul>
                </div>
              ) : (
                <p className="hint">Create/select a panel on the dashboard before chatting.</p>
              )}
            </div>

            <div className="sidebar-conversation-area">
              {panelConversations.length === 0 ? (
                <p className="hint">No conversations yet for this panel.</p>
              ) : null}
              {panelConversations.length > 0 ? (
                <ul className="conversation-list">
                  {panelConversations.map((conversation) => (
                    <li key={conversation.id}>
                      <div className="conversation-row">
                        <button
                          type="button"
                          className={`conversation-item ${activeConversation?.id === conversation.id ? "selected" : ""}`}
                          onClick={() => void handleSelectConversationFromList(conversation.id)}
                          disabled={isBusy}
                        >
                          <span>{conversation.name}</span>
                        </button>
                        <button
                          type="button"
                          className="danger compact"
                          onClick={() => void handleDeleteConversation(conversation)}
                          disabled={isBusy}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </aside>

          <section className="chat-shell">
            <div className="chat-topbar">
              <div className="chat-topbar-main">
                <div className="chat-topbar-left">
                  <button
                    type="button"
                    className="sidebar-toggle"
                    onClick={() => setIsSidebarOpen(true)}
                  >
                    Conversations
                  </button>
                  <div>
                    <h2>{activeConversation ? activeConversation.name : "No active conversation"}</h2>
                    <p>
                      {activeConversation
                        ? `Last prompted: ${formatTimestamp(activeConversation.lastPromptedAt)}`
                        : "Send a prompt to start a new conversation, or pick one from the left panel."}
                    </p>
                  </div>
                </div>
                <div className="chat-account">
                  <p className="signed-in">
                    Signed in as <strong>{auth.account.email}</strong>
                  </p>
                  <button type="button" onClick={handleLogout} disabled={isBusy}>
                    Logout
                  </button>
                </div>
              </div>
            </div>

            <div className="thread">
              <div className="thread-inner">
                {activeConversation ? (
                  activeConversation.prompts.length > 0 ? (
                    activeConversation.prompts.map((prompt) => (
                      <div key={prompt.id} className="turn">
                        <article className="message user-message">
                          <div className="message-meta">
                            <strong>You</strong>
                            <span>{formatTimestamp(prompt.createdAt)}</span>
                          </div>
                          <p>{prompt.content}</p>
                        </article>

                        {prompt.responses.map((response) => (
                          <article key={response.id} className="message assistant-message">
                            <div className="message-meta">
                              <strong>
                                {expertNameById.get(response.expertId) ??
                                  `Expert ${response.sequence}`}
                              </strong>
                              <span>{formatTimestamp(response.createdAt)}</span>
                            </div>
                            <p>{response.content}</p>
                          </article>
                        ))}
                      </div>
                    ))
                  ) : (
                    <p className="empty-state">No prompts yet. Send your first prompt below.</p>
                  )
                ) : (
                  <p className="empty-state">No active conversation selected.</p>
                )}
              </div>
            </div>

            <form className="composer" onSubmit={(event) => void handleSubmitPrompt(event)}>
              <label className="composer-label">
                <span className="visually-hidden">Message</span>
                <textarea
                  value={promptInput}
                  onChange={(event) => setPromptInput(event.target.value)}
                  onKeyDown={handlePromptInputKeyDown}
                  rows={3}
                  placeholder="Ask your panel anything..."
                  required
                />
              </label>
              <div className="composer-actions">
                <button className="send-button" type="submit" disabled={activePanelId === null || isBusy}>
                  Send
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : (
        <section className="redirect-card">
          <p>Redirecting to login...</p>
        </section>
      )}

      {statusMessage ? <p className="status">{statusMessage}</p> : null}
      {errorMessage ? <p className="error">{errorMessage}</p> : null}

      <style jsx>{`
        .page {
          --bg-start: #f4f7ff;
          --bg-mid: #edf8f5;
          --bg-end: #fff6eb;
          --card-bg: rgba(255, 255, 255, 0.9);
          --card-border: #ccd4e5;
          --form-bg: #fdfefe;
          --form-border: #dde4f1;
          --text-main: #1f2633;
          --text-muted: #556176;
          --button-border: #44577a;
          --button-bg: #eef4ff;
          --button-hover: #e2ebff;
          --field-border: #c5cedd;
          --input-bg: var(--card-bg);
          --panel-bg: #f9fbff;
          --panel-border: #ced8eb;
          --sidebar-bg: var(--card-bg);
          --sidebar-border: var(--card-border);
          --chat-bg: var(--card-bg);
          --chat-border: var(--card-border);
          --user-message-bg: var(--button-bg);
          --assistant-message-bg: var(--panel-bg);
          --assistant-message-border: var(--panel-border);
          --composer-bg: var(--form-bg);
          --composer-border: var(--form-border);
          --status-color: #1b5e20;
          --error-color: #a11818;
          --danger-border: #9c2a2a;
          --danger-bg: #ffefef;
          --danger-text: #6f1111;
          color-scheme: light;
          min-height: 100vh;
          height: 100vh;
          background: linear-gradient(170deg, var(--bg-start) 0%, var(--bg-mid) 45%, var(--bg-end) 100%);
          color: var(--text-main);
          font-family: "Trebuchet MS", "Segoe UI", sans-serif;
          display: grid;
          align-content: start;
          grid-template-rows: 1fr auto auto;
          gap: 6px;
          overflow: hidden;
        }

        @media (prefers-color-scheme: dark) {
          .page {
            --bg-start: #0d1117;
            --bg-mid: #111827;
            --bg-end: #161b22;
            --card-bg: rgba(20, 28, 40, 0.92);
            --card-border: #334155;
            --form-bg: #111827;
            --form-border: #334155;
            --text-main: #e5ebf5;
            --text-muted: #a5b4ca;
            --button-border: #64748b;
            --button-bg: #1e293b;
            --button-hover: #273449;
            --field-border: #475569;
            --input-bg: var(--card-bg);
            --panel-bg: #0f172a;
            --panel-border: #334155;
            --sidebar-bg: var(--card-bg);
            --sidebar-border: var(--card-border);
            --chat-bg: var(--card-bg);
            --chat-border: var(--card-border);
            --user-message-bg: var(--button-bg);
            --assistant-message-bg: var(--panel-bg);
            --assistant-message-border: var(--panel-border);
            --composer-bg: var(--form-bg);
            --composer-border: var(--form-border);
            --status-color: #86efac;
            --error-color: #fca5a5;
            --danger-border: #f87171;
            --danger-bg: rgba(153, 27, 27, 0.25);
            --danger-text: #fecaca;
            color-scheme: dark;
          }
        }

        .workspace {
          display: grid;
          grid-template-columns: minmax(280px, 320px) 1fr;
          align-items: start;
          min-height: 0;
          height: 100%;
          position: relative;
          overflow: hidden;
        }

        @media (max-width: 1040px) {
          .workspace {
            grid-template-columns: 1fr;
            min-height: 0;
          }
        }

        .sidebar-shell {
          background: var(--sidebar-bg);
          border-right: 1px solid var(--sidebar-border);
          min-height: 0;
          height: 100vh;
          padding: 14px;
          display: grid;
          grid-template-rows: auto 1fr;
          align-content: stretch;
          gap: 12px;
          overflow: hidden;
          overflow-x: hidden;
          z-index: 4;
          backdrop-filter: blur(6px);
        }

        .sidebar-top {
          position: sticky;
          top: 0;
          z-index: 2;
          display: grid;
          align-content: start;
          gap: 12px;
          background: color-mix(in srgb, var(--sidebar-bg) 94%, transparent);
          backdrop-filter: blur(6px);
          overflow: hidden;
        }

        .sidebar-conversation-area {
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          display: grid;
          align-content: start;
          gap: 8px;
        }

        .sidebar-head {
          display: flex;
          align-items: center;
        }

        .sidebar-title {
          min-width: 0;
        }

        .sidebar-head h1 {
          margin: 0;
          font-size: 1.2rem;
        }

        .sidebar-head p {
          margin: 3px 0 0;
          color: var(--text-muted);
          font-size: 0.84rem;
        }

        .sidebar-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .mobile-only {
          display: none;
        }

        .signed-in {
          margin: 0;
          font-size: 0.84rem;
          color: var(--text-muted);
          text-align: right;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .hint {
          margin: 0;
          font-size: 0.86rem;
          color: var(--text-muted);
          overflow-wrap: anywhere;
        }

        .chat-shell {
          min-height: 0;
          height: 100vh;
          background: var(--chat-bg);
          display: grid;
          grid-template-rows: auto 1fr auto;
          border-left: 1px solid var(--chat-border);
          overflow: hidden;
          overflow-x: hidden;
        }

        .chat-topbar {
          padding: 14px 24px;
          border-bottom: 1px solid var(--chat-border);
          display: grid;
          gap: 4px;
          position: sticky;
          top: 0;
          z-index: 1;
          background: color-mix(in srgb, var(--chat-bg) 92%, transparent);
          backdrop-filter: blur(6px);
        }

        .chat-topbar-main {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
        }

        .chat-topbar-left {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          min-width: 0;
        }

        .chat-topbar-left > div {
          min-width: 0;
        }

        .chat-account {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          min-width: 0;
          margin-left: auto;
        }

        .sidebar-toggle {
          display: none;
        }

        .chat-topbar h2 {
          margin: 0;
          font-size: 1rem;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .chat-topbar p {
          margin: 0;
          color: var(--text-muted);
          font-size: 0.84rem;
        }

        .panel-meta p {
          margin: 0;
        }

        .panel-experts {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 2px;
        }

        .panel-experts li::before {
          content: "- ";
        }

        .panel-meta {
          border: 1px solid var(--panel-border);
          border-radius: 10px;
          padding: 8px;
          background: var(--panel-bg);
          display: grid;
          gap: 4px;
          font-size: 0.84rem;
        }

        form {
          display: grid;
          gap: 8px;
          padding: 10px;
          border: 1px solid var(--panel-border);
          border-radius: 10px;
          background: var(--panel-bg);
        }

        label {
          display: grid;
          gap: 4px;
          font-size: 0.92rem;
        }

        input,
        select,
        textarea,
        button,
        .button-link {
          font: inherit;
        }

        input,
        select,
        textarea {
          border: 1px solid var(--field-border);
          border-radius: 8px;
          padding: 8px 10px;
          background: var(--input-bg);
          color: var(--text-main);
        }

        button,
        .button-link {
          border: 1px solid var(--button-border);
          border-radius: 8px;
          padding: 8px 10px;
          background: var(--button-bg);
          color: var(--text-main);
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: background-color 120ms ease;
        }

        button:hover,
        .button-link:hover {
          background: var(--button-hover);
        }

        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .conversation-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 8px;
          overflow-x: hidden;
        }

        .conversation-list li {
          border: 1px solid var(--panel-border);
          border-radius: 10px;
          padding: 6px;
          display: grid;
          gap: 6px;
          background: var(--panel-bg);
          overflow: hidden;
        }

        .conversation-list li:hover .compact {
          opacity: 1;
        }

        .conversation-item {
          width: auto;
          flex: 1;
          min-width: 0;
          justify-content: flex-start;
          text-align: left;
          border: 1px solid transparent;
          background: transparent;
          padding: 8px;
          overflow: hidden;
        }

        .conversation-item span {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .conversation-item.selected {
          background: var(--button-bg);
          border-color: var(--button-border);
          font-weight: 600;
        }

        .conversation-row {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          overflow: hidden;
        }

        .compact {
          padding: 4px 8px;
          font-size: 0.86rem;
          width: auto !important;
          opacity: 0.4;
          transition: opacity 120ms ease;
        }

        .thread {
          overflow-y: auto;
          overflow-x: hidden;
          padding: 20px 20px 8px;
          min-height: 0;
        }

        .thread-inner {
          max-width: 800px;
          width: min(100%, 800px);
          margin: 0 auto;
          display: grid;
          gap: 16px;
          min-width: 0;
        }

        .turn {
          display: contents;
        }

        .message {
          border-radius: 16px;
          padding: 12px 14px;
          display: grid;
          gap: 6px;
          max-width: min(100%, 900px);
        }

        .user-message {
          background: var(--user-message-bg);
          justify-self: end;
          min-width: min(100%, 280px);
        }

        .assistant-message {
          background: transparent;
          border-left: none;
          justify-self: start;
          min-width: min(100%, 320px);
          padding: 0;
          border-radius: 0;
        }

        .message p {
          margin: 0;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .message-meta {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          font-size: 0.84rem;
          color: var(--text-muted);
        }

        .empty-state {
          margin: 16px 0;
          opacity: 0.85;
          color: var(--text-muted);
        }

        .composer {
          border-radius: 20px;
          background: var(--composer-bg);
          border-color: var(--composer-border);
          margin: 10px auto 16px;
          width: min(860px, calc(100% - 32px));
          padding: 10px;
          gap: 6px;
          box-shadow: 0 12px 30px -24px rgba(0, 0, 0, 0.45);
        }

        .composer-label span {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .composer textarea {
          min-height: 70px;
          resize: vertical;
          border-radius: 12px;
          line-height: 1.4;
        }

        .composer-actions {
          display: flex;
          justify-content: flex-end;
        }

        .send-button {
          border-radius: 999px;
          min-width: 74px;
          font-weight: 600;
        }

        .visually-hidden {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }

        .redirect-card {
          margin: 24px;
          padding: 14px;
          border-radius: 12px;
          background: var(--panel-bg);
          border: 1px solid var(--panel-border);
        }

        .status,
        .error {
          margin: 0;
          padding: 8px 12px;
          border-radius: 10px;
          width: fit-content;
          margin-left: auto;
          margin-right: 12px;
          font-weight: 700;
          font-size: 0.86rem;
          background: var(--panel-bg);
        }

        .status {
          color: var(--status-color);
        }

        .error {
          color: var(--error-color);
        }

        .danger {
          border-color: var(--danger-border);
          background: var(--danger-bg);
          color: var(--danger-text);
        }

        .sidebar-backdrop {
          display: none;
          border: none;
          background: transparent;
        }

        @media (max-width: 1040px) {
          .sidebar-shell {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            width: min(86vw, 320px);
            min-height: 0;
            height: 100vh;
            border-right: 1px solid var(--sidebar-border);
            border-bottom: none;
            transform: translateX(-110%);
            transition: transform 140ms ease;
          }

          .workspace.sidebar-open .sidebar-shell {
            transform: translateX(0);
          }

          .workspace.sidebar-open .sidebar-backdrop {
            display: block;
            position: fixed;
            inset: 0;
            z-index: 3;
            background: rgba(0, 0, 0, 0.35);
          }

          .chat-shell {
            min-height: auto;
            border-left: none;
          }

          .chat-topbar {
            position: static;
          }

          .chat-topbar-main {
            flex-direction: column;
            gap: 10px;
          }

          .chat-account {
            width: 100%;
            justify-content: space-between;
          }

          .mobile-only,
          .sidebar-toggle {
            display: inline-flex;
          }

          .sidebar-actions {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .signed-in {
            text-align: left;
          }
        }
      `}</style>
    </main>
  );
}
