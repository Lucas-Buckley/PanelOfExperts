"use client";

/**
 * Purpose: Renders the Step 8 MVP UI for auth, panel selection, conversation view, and prompt submission.
 * Inputs: None.
 * Outputs: Interactive client page for running end-to-end prompt flows.
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { formatTimestamp, sortConversation } from "./pageHelpers";

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

type ExpertDraft = {
  id: string;
  name: string;
  specialization: string;
  soul: string;
};

const AUTH_STORAGE_KEY = "poe-auth";
let expertDraftCounter = 0;

function createExpertDraft(): ExpertDraft {
  /**
   * Purpose: Creates one expert draft row with a stable client-side id for React keying.
   * Inputs: None.
   * Outputs: Blank expert draft object with deterministic incremental id.
   */
  expertDraftCounter += 1;

  return {
    id: `draft-${expertDraftCounter}`,
    name: "",
    specialization: "",
    soul: ""
  };
}

async function requestJson<T>(args: {
  path: string;
  method?: "GET" | "POST";
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

export default function HomePage() {
  /**
   * Purpose: Hosts end-to-end MVP controls: auth, panel management, conversation load/create, and prompt loop.
   * Inputs: None.
   * Outputs: Home page JSX with form handlers wired to API routes.
   */
  const [auth, setAuth] = useState<AuthSuccess | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [panels, setPanels] = useState<PanelView[]>([]);
  const [activePanel, setActivePanel] = useState<PanelView | null>(null);
  const [newPanelName, setNewPanelName] = useState("");
  const [newPanelDescription, setNewPanelDescription] = useState("");
  const [newPanelInstructions, setNewPanelInstructions] = useState("");
  const [expertDrafts, setExpertDrafts] = useState<ExpertDraft[]>([createExpertDraft()]);

  const [activeConversation, setActiveConversation] = useState<ConversationView | null>(null);
  const [panelConversations, setPanelConversations] = useState<ConversationListItemView[]>([]);
  const [newConversationName, setNewConversationName] = useState("");
  const [conversationIdInput, setConversationIdInput] = useState("");
  const [promptInput, setPromptInput] = useState("");

  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const expertNameById = useMemo(() => {
    /**
     * Purpose: Builds expert lookup map for rendering response rows under expert names.
     * Inputs: Active panel expert list.
     * Outputs: Expert id -> expert name map.
     */
    return new Map((activePanel?.experts ?? []).map((expert) => [expert.id, expert.name]));
  }, [activePanel]);

  async function loadPanels(accessToken: string): Promise<void> {
    /**
     * Purpose: Loads account-owned panel list from API and updates local state.
     * Inputs: Bearer access token.
     * Outputs: No return value; updates panel list state.
     */
    const listedPanels = await requestJson<PanelView[]>({
      path: "/api/panels",
      method: "GET",
      accessToken
    });
    setPanels(listedPanels);
  }

  async function ensureActivePanel(accessToken: string, panelId: number): Promise<PanelView> {
    /**
     * Purpose: Ensures panel details (including expert list) are loaded for a specific panel id.
     * Inputs: Bearer access token and target panel id.
     * Outputs: Loaded panel details from API.
     */
    if (activePanel && activePanel.id === panelId) {
      return activePanel;
    }

    const panel = await requestJson<PanelView>({
      path: `/api/panels/${panelId}`,
      method: "GET",
      accessToken
    });
    setActivePanel(panel);
    return panel;
  }

  function sortPanelConversations(
    conversations: ConversationListItemView[]
  ): ConversationListItemView[] {
    /**
     * Purpose: Applies deterministic recency sorting for panel conversation list rendering.
     * Inputs: Unsorted conversation list payload from API.
     * Outputs: Conversations sorted by `lastPromptedAt DESC, id DESC`.
     */
    return [...conversations].sort((left, right) => {
      const leftTime = left.lastPromptedAt ? Date.parse(left.lastPromptedAt) : 0;
      const rightTime = right.lastPromptedAt ? Date.parse(right.lastPromptedAt) : 0;
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }

      return right.id - left.id;
    });
  }

  async function loadPanelConversations(accessToken: string, panelId: number): Promise<void> {
    /**
     * Purpose: Loads one panel's conversation list so users can see and select ids directly.
     * Inputs: Bearer access token and active panel id.
     * Outputs: No return value; updates conversation-list state for selected panel.
     */
    const listedConversations = await requestJson<ConversationListItemView[]>({
      path: `/api/conversations?panelId=${panelId}`,
      method: "GET",
      accessToken
    });

    setPanelConversations(sortPanelConversations(listedConversations));
  }

  useEffect(() => {
    /**
     * Purpose: Restores persisted auth and panel list once when page mounts.
     * Inputs: None.
     * Outputs: No return value; may hydrate auth/panel state.
     */
    const stored = readStoredAuth();
    if (!stored) {
      return;
    }

    setAuth(stored);
    void loadPanels(stored.accessToken).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to load panels.";
      setErrorMessage(message);
    });
  }, []);

  async function handleAuth(mode: "register" | "login", event: FormEvent<HTMLFormElement>) {
    /**
     * Purpose: Submits register/login requests and persists auth session for subsequent API calls.
     * Inputs: Auth mode and submitted form event.
     * Outputs: No return value; updates auth and panel states on success.
     */
    event.preventDefault();
    setStatusMessage("");
    setErrorMessage("");
    setIsBusy(true);

    try {
      const result = await requestJson<AuthSuccess>({
        path: mode === "register" ? "/api/auth/register" : "/api/auth/login",
        method: "POST",
        body: {
          email,
          password
        }
      });

      setAuth(result);
      writeStoredAuth(result);
      await loadPanels(result.accessToken);
      setStatusMessage(mode === "register" ? "Account created and signed in." : "Signed in.");
      setPassword("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Auth request failed.";
      setErrorMessage(message);
    } finally {
      setIsBusy(false);
    }
  }

  function handleLogout(): void {
    /**
     * Purpose: Clears local auth/session state to return UI to signed-out mode.
     * Inputs: None.
     * Outputs: No return value; clears auth-related state.
     */
    setAuth(null);
    setPanels([]);
    setActivePanel(null);
    setActiveConversation(null);
    setPanelConversations([]);
    setPromptInput("");
    writeStoredAuth(null);
    setStatusMessage("Signed out.");
    setErrorMessage("");
  }

  async function handleSelectPanel(panelId: number): Promise<void> {
    /**
     * Purpose: Loads full panel detail and sets it as active panel for conversation actions.
     * Inputs: Panel id from selection click.
     * Outputs: No return value; updates active panel/conversation state.
     */
    if (!auth) {
      return;
    }

    setStatusMessage("");
    setErrorMessage("");
    setIsBusy(true);
    try {
      const panel = await requestJson<PanelView>({
        path: `/api/panels/${panelId}`,
        method: "GET",
        accessToken: auth.accessToken
      });
      setActivePanel(panel);
      setActiveConversation(null);
      await loadPanelConversations(auth.accessToken, panel.id);
      setStatusMessage(`Selected panel: ${panel.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load panel.";
      setErrorMessage(message);
    } finally {
      setIsBusy(false);
    }
  }

  async function openConversationById(conversationId: number): Promise<void> {
    /**
     * Purpose: Loads one conversation and synchronizes active panel/list context around that id.
     * Inputs: Target conversation id.
     * Outputs: No return value; updates active conversation/panel and id-input state.
     */
    if (!auth) {
      return;
    }

    setStatusMessage("");
    setErrorMessage("");
    setIsBusy(true);
    try {
      const conversation = await requestJson<ConversationView>({
        path: `/api/conversations/${conversationId}`,
        method: "GET",
        accessToken: auth.accessToken
      });
      await ensureActivePanel(auth.accessToken, conversation.panelId);
      await loadPanelConversations(auth.accessToken, conversation.panelId);
      setActiveConversation(sortConversation(conversation));
      setConversationIdInput(String(conversation.id));
      setStatusMessage(`Loaded conversation #${conversation.id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load conversation.";
      setErrorMessage(message);
    } finally {
      setIsBusy(false);
    }
  }

  function handleExpertDraftChange(
    index: number,
    key: keyof ExpertDraft,
    value: string
  ): void {
    /**
     * Purpose: Updates one expert draft row field in create-panel form state.
     * Inputs: Expert row index, field key, and next value.
     * Outputs: No return value; updates expert draft list state.
     */
    setExpertDrafts((current) =>
      current.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, [key]: value } : draft
      )
    );
  }

  function addExpertDraft(): void {
    /**
     * Purpose: Appends a blank expert row to the create-panel form.
     * Inputs: None.
     * Outputs: No return value; updates expert draft list state.
     */
    setExpertDrafts((current) => [...current, createExpertDraft()]);
  }

  function removeExpertDraft(index: number): void {
    /**
     * Purpose: Removes one expert row from create-panel form while enforcing at least one expert row.
     * Inputs: Expert row index to remove.
     * Outputs: No return value; updates expert draft list state.
     */
    setExpertDrafts((current) => {
      if (current.length <= 1) {
        return current;
      }

      return current.filter((_, draftIndex) => draftIndex !== index);
    });
  }

  async function handleCreatePanel(event: FormEvent<HTMLFormElement>): Promise<void> {
    /**
     * Purpose: Creates a panel with nested experts, refreshes panel list, and selects created panel.
     * Inputs: Submitted create-panel form event.
     * Outputs: No return value; updates panel states and status message.
     */
    event.preventDefault();
    if (!auth) {
      return;
    }

    setStatusMessage("");
    setErrorMessage("");
    setIsBusy(true);
    try {
      const created = await requestJson<PanelView>({
        path: "/api/panels",
        method: "POST",
        accessToken: auth.accessToken,
        body: {
          name: newPanelName,
          description: newPanelDescription.length > 0 ? newPanelDescription : null,
          instructions: newPanelInstructions.length > 0 ? newPanelInstructions : null,
          experts: expertDrafts.map((expert) => ({
            name: expert.name,
            specialization: expert.specialization,
            soul: expert.soul
          }))
        }
      });

      await loadPanels(auth.accessToken);
      setActivePanel(created);
      setActiveConversation(null);
      setPanelConversations([]);
      setNewPanelName("");
      setNewPanelDescription("");
      setNewPanelInstructions("");
      setExpertDrafts([createExpertDraft()]);
      setStatusMessage(`Created panel: ${created.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create panel.";
      setErrorMessage(message);
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
    if (!auth || !activePanel) {
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
          panelId: activePanel.id,
          name: newConversationName
        }
      });
      setActiveConversation(sortConversation(created));
      await loadPanelConversations(auth.accessToken, activePanel.id);
      setConversationIdInput(String(created.id));
      setNewConversationName("");
      setStatusMessage(`Opened conversation: ${created.name}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create conversation.";
      setErrorMessage(message);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLoadConversation(event: FormEvent<HTMLFormElement>): Promise<void> {
    /**
     * Purpose: Loads an existing conversation by id and ensures corresponding panel details are active.
     * Inputs: Submitted load-conversation form event.
     * Outputs: No return value; updates active conversation/panel states.
     */
    event.preventDefault();
    if (!auth) {
      return;
    }

    const parsedId = Number(conversationIdInput);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      setErrorMessage("Conversation id must be a positive integer.");
      return;
    }

    await openConversationById(parsedId);
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
      if (activeConversation) {
        await loadPanelConversations(auth.accessToken, activeConversation.panelId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to submit prompt.";
      setErrorMessage(message);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <h1>Panel of Experts</h1>
      </section>

      <section className="card">
        <h2>Authentication</h2>
        {!auth ? (
          <div className="auth-grid">
            <form onSubmit={(event) => void handleAuth("register", event)}>
              <h3>Register</h3>
              <label>
                Email
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  autoComplete="email"
                  required
                />
              </label>
              <label>
                Password
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              <button type="submit" disabled={isBusy}>
                Register
              </button>
            </form>

            <form onSubmit={(event) => void handleAuth("login", event)}>
              <h3>Login</h3>
              <label>
                Email
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  autoComplete="email"
                  required
                />
              </label>
              <label>
                Password
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <button type="submit" disabled={isBusy}>
                Login
              </button>
            </form>
          </div>
        ) : (
          <div>
            <p>
              Signed in as <strong>{auth.account.email}</strong> (account #{auth.account.id})
            </p>
            <button type="button" onClick={handleLogout} disabled={isBusy}>
              Logout
            </button>
          </div>
        )}
      </section>

      {auth ? (
        <>
          <section className="card">
            <h2>Panels</h2>
            <div className="two-col">
              <div>
                <h3>My Panels</h3>
                <button
                  type="button"
                  onClick={() => void loadPanels(auth.accessToken)}
                  disabled={isBusy}
                >
                  Refresh Panels
                </button>
                {panels.length === 0 ? <p>No panels yet.</p> : null}
                <ul>
                  {panels.map((panel) => (
                    <li key={panel.id}>
                      <button
                        type="button"
                        onClick={() => void handleSelectPanel(panel.id)}
                        disabled={isBusy}
                      >
                        {panel.name} (experts: {panel.experts.length})
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <form onSubmit={(event) => void handleCreatePanel(event)}>
                <h3>Create Panel</h3>
                <label>
                  Name
                  <input
                    value={newPanelName}
                    onChange={(event) => setNewPanelName(event.target.value)}
                    maxLength={255}
                    required
                  />
                </label>
                <label>
                  Description
                  <input
                    value={newPanelDescription}
                    onChange={(event) => setNewPanelDescription(event.target.value)}
                    maxLength={255}
                  />
                </label>
                <label>
                  Instructions
                  <textarea
                    value={newPanelInstructions}
                    onChange={(event) => setNewPanelInstructions(event.target.value)}
                    rows={3}
                  />
                </label>

                <h4>Experts</h4>
                {expertDrafts.map((expert, index) => (
                  <fieldset key={expert.id}>
                    <legend>Expert {index + 1}</legend>
                    <label>
                      Name
                      <input
                        value={expert.name}
                        onChange={(event) =>
                          handleExpertDraftChange(index, "name", event.target.value)
                        }
                        maxLength={255}
                        required
                      />
                    </label>
                    <label>
                      Specialization
                      <input
                        value={expert.specialization}
                        onChange={(event) =>
                          handleExpertDraftChange(index, "specialization", event.target.value)
                        }
                        maxLength={255}
                        required
                      />
                    </label>
                    <label>
                      Soul
                      <input
                        value={expert.soul}
                        onChange={(event) =>
                          handleExpertDraftChange(index, "soul", event.target.value)
                        }
                        required
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeExpertDraft(index)}
                      disabled={expertDrafts.length <= 1 || isBusy}
                    >
                      Remove Expert
                    </button>
                  </fieldset>
                ))}
                <button type="button" onClick={addExpertDraft} disabled={isBusy}>
                  Add Expert
                </button>
                <button type="submit" disabled={isBusy}>
                  Create Panel
                </button>
              </form>
            </div>

            {activePanel ? (
              <div className="active-info">
                <h3>Active Panel: {activePanel.name}</h3>
                <p>Description: {activePanel.description ?? "N/A"}</p>
                <p>Instructions: {activePanel.instructions ?? "N/A"}</p>
                <p>Last prompted: {formatTimestamp(activePanel.lastPromptedAt)}</p>
                <ul>
                  {activePanel.experts.map((expert) => (
                    <li key={expert.id}>
                      [{expert.position}] {expert.name} - {expert.specialization}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="card">
            <h2>Conversations</h2>
            <div className="two-col">
              <form onSubmit={(event) => void handleCreateConversation(event)}>
                <h3>Create Conversation</h3>
                <label>
                  Name
                  <input
                    value={newConversationName}
                    onChange={(event) => setNewConversationName(event.target.value)}
                    maxLength={255}
                    required
                  />
                </label>
                <button type="submit" disabled={!activePanel || isBusy}>
                  Create on Active Panel
                </button>
              </form>

              <form onSubmit={(event) => void handleLoadConversation(event)}>
                <h3>Open Existing Conversation</h3>
                <label>
                  Conversation Id
                  <input
                    value={conversationIdInput}
                    onChange={(event) => setConversationIdInput(event.target.value)}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    required
                  />
                </label>
                <button type="submit" disabled={isBusy}>
                  Load by Id
                </button>
              </form>
            </div>

            {activePanel ? (
              <div className="active-info">
                <h3>Conversations In Active Panel ({activePanel.name})</h3>
                <button
                  type="button"
                  onClick={() => void loadPanelConversations(auth.accessToken, activePanel.id)}
                  disabled={isBusy}
                >
                  Refresh Conversation List
                </button>
                {panelConversations.length === 0 ? (
                  <p>No conversations yet for this panel.</p>
                ) : (
                  <ul>
                    {panelConversations.map((conversation) => (
                      <li key={conversation.id}>
                        <button
                          type="button"
                          onClick={() => void openConversationById(conversation.id)}
                          disabled={isBusy}
                        >
                          #{conversation.id} - {conversation.name}
                        </button>
                        <div>Last prompted: {formatTimestamp(conversation.lastPromptedAt)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p>Select a panel to see its conversations and ids.</p>
            )}

            {activeConversation ? (
              <div className="active-info">
                <h3>
                  Active Conversation: {activeConversation.name} (#{activeConversation.id})
                </h3>
                <p>Last prompted: {formatTimestamp(activeConversation.lastPromptedAt)}</p>
              </div>
            ) : (
              <p>No active conversation.</p>
            )}
          </section>

          <section className="card">
            <h2>Prompt + Responses</h2>
            <form onSubmit={(event) => void handleSubmitPrompt(event)}>
              <label>
                Prompt Content
                <textarea
                  value={promptInput}
                  onChange={(event) => setPromptInput(event.target.value)}
                  rows={4}
                  required
                />
              </label>
              <button type="submit" disabled={!activeConversation || isBusy}>
                Submit Prompt to Active Conversation
              </button>
            </form>

            {activeConversation ? (
              <ol>
                {activeConversation.prompts.map((prompt) => (
                  <li key={prompt.id} className="prompt-item">
                    <p>
                      <strong>Prompt #{prompt.sequence}</strong> ({formatTimestamp(prompt.createdAt)})
                    </p>
                    <p>{prompt.content}</p>
                    <ul>
                      {prompt.responses.map((response) => (
                        <li key={response.id}>
                          <strong>
                            {expertNameById.get(response.expertId) ??
                              `Expert #${response.expertId}`}
                          </strong>
                          {" - "}
                          {response.content}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            ) : (
              <p>Create or load a conversation to start prompting.</p>
            )}
          </section>
        </>
      ) : null}

      {statusMessage ? <p className="status">{statusMessage}</p> : null}
      {errorMessage ? <p className="error">{errorMessage}</p> : null}

      <style jsx>{`
        .page {
          min-height: 100vh;
          padding: 24px;
          background: linear-gradient(170deg, #f4f7ff 0%, #edf8f5 45%, #fff6eb 100%);
          color: #1f2633;
          font-family: "Trebuchet MS", "Segoe UI", sans-serif;
          display: grid;
          gap: 16px;
        }

        .hero h1 {
          margin: 0 0 4px;
          font-size: 2rem;
        }

        .hero p {
          margin: 0;
        }

        .card {
          background: rgba(255, 255, 255, 0.9);
          border: 1px solid #ccd4e5;
          border-radius: 12px;
          padding: 16px;
          display: grid;
          gap: 12px;
        }

        .auth-grid,
        .two-col {
          display: grid;
          gap: 12px;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        }

        form {
          display: grid;
          gap: 10px;
          padding: 10px;
          border: 1px solid #dde4f1;
          border-radius: 10px;
          background: #fdfefe;
        }

        label {
          display: grid;
          gap: 4px;
          font-size: 0.92rem;
        }

        input,
        textarea,
        button {
          font: inherit;
        }

        input,
        textarea {
          border: 1px solid #c5cedd;
          border-radius: 8px;
          padding: 8px 10px;
        }

        button {
          border: 1px solid #44577a;
          border-radius: 8px;
          padding: 8px 10px;
          background: #eef4ff;
          cursor: pointer;
        }

        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        ul,
        ol {
          margin: 0;
          padding-left: 20px;
          display: grid;
          gap: 6px;
        }

        fieldset {
          border: 1px solid #d7deea;
          border-radius: 8px;
          padding: 8px;
          display: grid;
          gap: 8px;
        }

        legend {
          padding: 0 6px;
          font-weight: 700;
        }

        .active-info {
          border: 1px solid #ced8eb;
          border-radius: 10px;
          padding: 10px;
          background: #f9fbff;
          display: grid;
          gap: 6px;
        }

        .active-info p,
        .prompt-item p {
          margin: 0;
        }

        .prompt-item {
          border: 1px solid #d4dfef;
          border-radius: 10px;
          padding: 10px;
          background: #fcfdff;
          display: grid;
          gap: 8px;
        }

        .status {
          margin: 0;
          color: #1b5e20;
          font-weight: 700;
        }

        .error {
          margin: 0;
          color: #a11818;
          font-weight: 700;
        }
      `}</style>
    </main>
  );
}
