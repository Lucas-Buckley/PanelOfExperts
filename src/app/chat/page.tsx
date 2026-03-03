"use client";

/**
 * Purpose: Renders the dedicated chat workspace UI for panel conversations and prompt/response flow.
 * Inputs: Optional `panelId` query param, persisted auth session, and user interactions.
 * Outputs: Interactive chat page for conversation selection, prompt submission, and expert response history.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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

type ApiErrorShape = {
  error?: string;
};

const AUTH_STORAGE_KEY = "poe-auth";
const INVALID_ACCESS_TOKEN_MESSAGE = "Invalid or expired access token.";

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
   * Purpose: Hosts chat workspace controls: panel pick, conversation list, and prompt/response thread.
   * Inputs: None.
   * Outputs: Chat workspace page JSX with form handlers wired to conversation/prompt API routes.
   */
  const router = useRouter();

  const [auth, setAuth] = useState<AuthSuccess | null>(null);
  const [panels, setPanels] = useState<PanelView[]>([]);
  const [activePanelId, setActivePanelId] = useState<number | null>(null);
  const [panelConversations, setPanelConversations] = useState<ConversationListItemView[]>([]);
  const [activeConversation, setActiveConversation] = useState<ConversationView | null>(null);
  const [newConversationName, setNewConversationName] = useState("");
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

  async function handleSelectPanel(panelId: number): Promise<void> {
    /**
     * Purpose: Switches active panel and refreshes its conversation list.
     * Inputs: Panel id selected by the user.
     * Outputs: No return value; updates panel/conversation state.
     */
    if (!auth) {
      return;
    }

    setStatusMessage("");
    setErrorMessage("");
    setIsBusy(true);
    try {
      setActivePanelId(panelId);
      setActiveConversation(null);
      await loadPanelConversations(auth.accessToken, panelId);
      setStatusMessage("Panel chat context updated.");
    } catch (error) {
      handleApiError(error, "Failed to load panel conversations.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRefreshPanels(): Promise<void> {
    /**
     * Purpose: Refreshes panel list and keeps active panel valid when ordering/metadata changes.
     * Inputs: None.
     * Outputs: No return value; updates panel list and active selection state.
     */
    if (!auth) {
      return;
    }

    setStatusMessage("");
    setErrorMessage("");
    setIsBusy(true);
    try {
      const listedPanels = await loadPanels(auth.accessToken);
      if (activePanelId !== null && !listedPanels.some((panel) => panel.id === activePanelId)) {
        setActivePanelId(listedPanels.length > 0 ? listedPanels[0].id : null);
        setActiveConversation(null);
      }
      setStatusMessage("Panels refreshed.");
    } catch (error) {
      handleApiError(error, "Failed to refresh panels.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRefreshPanelConversationList(): Promise<void> {
    /**
     * Purpose: Refreshes the active panel conversation list with standard error/session handling.
     * Inputs: None.
     * Outputs: No return value; updates panel conversation list and status/error state.
     */
    if (!auth || activePanelId === null) {
      return;
    }

    setStatusMessage("");
    setErrorMessage("");
    setIsBusy(true);
    try {
      await loadPanelConversations(auth.accessToken, activePanelId);
      setStatusMessage("Conversation list refreshed.");
    } catch (error) {
      handleApiError(error, "Failed to load conversation list.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCreateConversation(event: FormEvent<HTMLFormElement>): Promise<void> {
    /**
     * Purpose: Creates a conversation under the active panel and opens it in conversation view.
     * Inputs: Submitted create-conversation form event.
     * Outputs: No return value; updates active conversation state.
     */
    event.preventDefault();
    if (!auth || activePanelId === null) {
      return;
    }

    setStatusMessage("");
    setErrorMessage("");
    setIsBusy(true);
    try {
      const created = await requestJson<ConversationView>({
        path: "/api/conversations",
        method: "POST",
        accessToken: auth.accessToken,
        body: {
          panelId: activePanelId,
          name: newConversationName
        }
      });
      setActiveConversation(sortConversation(created));
      await loadPanelConversations(auth.accessToken, activePanelId);
      setNewConversationName("");
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 1040px)").matches) {
        setIsSidebarOpen(false);
      }
      setStatusMessage(`Opened conversation: ${created.name}`);
    } catch (error) {
      handleApiError(error, "Failed to create conversation.");
    } finally {
      setIsBusy(false);
    }
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
     * Purpose: Sends a prompt for the active conversation and appends resulting expert responses to UI history.
     * Inputs: Submitted prompt form event.
     * Outputs: No return value; updates active conversation prompt history.
     */
    event.preventDefault();
    if (!auth || !activeConversation) {
      return;
    }

    setStatusMessage("");
    setErrorMessage("");
    setIsBusy(true);
    try {
      const created = await requestJson<PromptCreateResponse>({
        path: `/api/conversations/${activeConversation.id}/prompts`,
        method: "POST",
        accessToken: auth.accessToken,
        body: {
          content: promptInput
        }
      });

      setActiveConversation((current) => {
        if (!current || current.id !== created.prompt.conversationId) {
          return current;
        }

        const appendedPrompt: ConversationPromptView = {
          ...created.prompt,
          responses: [...created.responses].sort(
            (left, right) => left.sequence - right.sequence || left.id - right.id
          )
        };

        return sortConversation({
          ...current,
          prompts: [...current.prompts, appendedPrompt]
        });
      });

      setPromptInput("");
      setStatusMessage("Prompt submitted.");
      await loadPanels(auth.accessToken);
      await loadPanelConversations(auth.accessToken, activeConversation.panelId);
    } catch (error) {
      handleApiError(error, "Failed to submit prompt.");
    } finally {
      setIsBusy(false);
    }
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
            <div className="sidebar-head">
              <h1>Panel of Experts</h1>
              <p>Chat Workspace</p>
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
              <button type="button" onClick={handleLogout} disabled={isBusy}>
                Logout
              </button>
            </div>

            <p className="signed-in">
              Signed in as <strong>{auth.account.email}</strong>
            </p>

            <label>
              <span className="label-title">Active Panel</span>
              <select
                value={activePanelId ?? ""}
                onChange={(event) => {
                  const panelId = Number(event.target.value);
                  if (Number.isInteger(panelId) && panelId > 0) {
                    void handleSelectPanel(panelId);
                  }
                }}
                disabled={panels.length === 0 || isBusy}
              >
                <option value="" disabled>
                  {panels.length === 0 ? "No panels available" : "Select a panel"}
                </option>
                {panels.map((panel) => (
                  <option key={panel.id} value={panel.id}>
                    {panel.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="action-row">
              <button type="button" onClick={() => void handleRefreshPanels()} disabled={isBusy}>
                Refresh Panels
              </button>
              <button
                type="button"
                onClick={() => void handleRefreshPanelConversationList()}
                disabled={isBusy || activePanelId === null}
              >
                Refresh Conversations
              </button>
            </div>

            {activePanel ? (
              <div className="panel-meta">
                <p>
                  <strong>{activePanel.name}</strong>
                </p>
                <p>Last prompted: {formatTimestamp(activePanel.lastPromptedAt)}</p>
                <p>Experts: {activePanel.experts.length}</p>
              </div>
            ) : (
              <p className="hint">Create/select a panel on the dashboard before chatting.</p>
            )}

            <form className="new-conversation" onSubmit={(event) => void handleCreateConversation(event)}>
              <h3>New Chat</h3>
              <div className="new-conversation-row">
                <input
                  value={newConversationName}
                  onChange={(event) => setNewConversationName(event.target.value)}
                  placeholder="Conversation name"
                  aria-label="Conversation name"
                  maxLength={255}
                  required
                />
                <button type="submit" disabled={activePanelId === null || isBusy}>
                  Create
                </button>
              </div>
            </form>

            {panelConversations.length === 0 ? (
              <p className="hint">No conversations yet for this panel.</p>
            ) : null}
            {panelConversations.length > 0 ? (
              <ul className="conversation-list">
                {panelConversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      className={`conversation-item ${activeConversation?.id === conversation.id ? "selected" : ""}`}
                      onClick={() => void handleSelectConversationFromList(conversation.id)}
                      disabled={isBusy}
                    >
                      <span>{conversation.name}</span>
                    </button>
                    <div className="conversation-row">
                      <small>{formatTimestamp(conversation.lastPromptedAt)}</small>
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
          </aside>

          <section className="chat-shell">
            <div className="chat-topbar">
              <div className="chat-topbar-main">
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
                      : "Create or open a conversation from the left panel."}
                  </p>
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
                  rows={3}
                  placeholder="Ask your panel anything..."
                  required
                />
              </label>
              <div className="composer-actions">
                <button className="send-button" type="submit" disabled={!activeConversation || isBusy}>
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
          --app-bg: #ffffff;
          --sidebar-bg: #f2f2f5;
          --sidebar-border: #e2e2e7;
          --chat-bg: #ffffff;
          --chat-border: #e8e8ec;
          --text-main: #1f2328;
          --text-muted: #6d727c;
          --button-border: #d5d7de;
          --button-bg: #ffffff;
          --button-hover: #f4f4f7;
          --input-bg: #ffffff;
          --input-border: #d8dbe3;
          --panel-bg: #f7f7fa;
          --panel-border: #e1e4eb;
          --user-message-bg: #ececf1;
          --assistant-message-bg: #ffffff;
          --assistant-message-border: #ececf1;
          --composer-bg: #ffffff;
          --composer-border: #d8dbe3;
          --status-color: #1b5e20;
          --error-color: #a11818;
          --danger-border: #9c2a2a;
          --danger-bg: #ffefef;
          --danger-text: #6f1111;
          color-scheme: light;
          min-height: 100vh;
          background: var(--app-bg);
          color: var(--text-main);
          font-family: "Segoe UI", Arial, sans-serif;
          display: grid;
          align-content: start;
          grid-template-rows: 1fr auto auto;
          gap: 6px;
        }

        @media (prefers-color-scheme: dark) {
          .page {
            --app-bg: #212121;
            --sidebar-bg: #171717;
            --sidebar-border: #2a2a2a;
            --chat-bg: #212121;
            --chat-border: #2c2c2c;
            --text-main: #ececec;
            --text-muted: #9ca3af;
            --button-border: #3a3a3a;
            --button-bg: #2a2a2a;
            --button-hover: #343434;
            --input-bg: #2b2b2b;
            --input-border: #3b3b3b;
            --panel-bg: #262626;
            --panel-border: #333333;
            --user-message-bg: #303030;
            --assistant-message-bg: #212121;
            --assistant-message-border: #333333;
            --composer-bg: #2a2a2a;
            --composer-border: #3b3b3b;
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
          min-height: 100vh;
          position: relative;
        }

        @media (max-width: 1040px) {
          .workspace {
            grid-template-columns: 1fr;
            min-height: auto;
          }
        }

        .sidebar-shell {
          background: var(--sidebar-bg);
          border-right: 1px solid var(--sidebar-border);
          min-height: 100vh;
          padding: 14px;
          display: grid;
          align-content: start;
          gap: 12px;
          overflow: auto;
          z-index: 4;
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
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }

        .mobile-only {
          display: none;
        }

        .signed-in {
          margin: 0;
          font-size: 0.84rem;
          color: var(--text-muted);
        }

        .label-title {
          font-size: 0.82rem;
          color: var(--text-muted);
        }

        .hint {
          margin: 0;
          font-size: 0.86rem;
          color: var(--text-muted);
        }

        .new-conversation h3 {
          margin: 0;
          font-size: 0.94rem;
        }

        .new-conversation-row {
          display: grid;
          gap: 8px;
          grid-template-columns: 1fr auto;
        }

        .chat-shell {
          min-height: 100vh;
          background: var(--chat-bg);
          display: grid;
          grid-template-rows: auto 1fr auto;
          border-left: 1px solid var(--chat-border);
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
          gap: 12px;
          align-items: flex-start;
        }

        .sidebar-toggle {
          display: none;
        }

        .chat-topbar h2 {
          margin: 0;
          font-size: 1rem;
          font-weight: 600;
        }

        .chat-topbar p {
          margin: 0;
          color: var(--text-muted);
          font-size: 0.84rem;
        }

        .panel-meta p {
          margin: 0;
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

        .action-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .conversation-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 8px;
        }

        .conversation-list li {
          border: 1px solid var(--panel-border);
          border-radius: 10px;
          padding: 6px;
          display: grid;
          gap: 6px;
          background: var(--panel-bg);
        }

        .conversation-list li:hover .compact {
          opacity: 1;
        }

        .conversation-item {
          width: 100%;
          justify-content: flex-start;
          text-align: left;
          border: 1px solid transparent;
          background: transparent;
          padding: 8px;
          overflow: hidden;
        }

        .conversation-item span {
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
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }

        .conversation-row small {
          color: var(--text-muted);
        }

        .compact {
          padding: 4px 8px;
          font-size: 0.86rem;
          width: auto !important;
          opacity: 0.4;
          transition: opacity 120ms ease;
        }

        .thread {
          overflow: auto;
          padding: 20px 20px 8px;
        }

        .thread-inner {
          max-width: 800px;
          margin: 0 auto;
          display: grid;
          gap: 16px;
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
            min-height: 100vh;
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

          .mobile-only,
          .sidebar-toggle {
            display: inline-flex;
          }

          .sidebar-actions {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
      `}</style>
    </main>
  );
}
