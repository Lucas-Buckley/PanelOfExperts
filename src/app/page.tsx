"use client";

/**
 * Purpose: Renders the dashboard UI for authentication and panel management workflows.
 * Inputs: None.
 * Outputs: Interactive client page for account auth, panel create/select/edit/delete, and chat-page navigation.
 */
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

type ApiErrorShape = {
  error?: string;
};

type ExpertDraft = {
  id: string;
  expertId: number | null;
  name: string;
  specialization: string;
  soul: string;
};

const AUTH_STORAGE_KEY = "poe-auth";
const INVALID_ACCESS_TOKEN_MESSAGE = "Invalid or expired access token.";
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
    expertId: null,
    name: "",
    specialization: "",
    soul: ""
  };
}

function createExpertDraftFromPanelExpert(expert: PanelExpertView): ExpertDraft {
  /**
   * Purpose: Converts a persisted panel expert into editable dashboard draft state.
   * Inputs: Panel expert record loaded from the API.
   * Outputs: Expert draft with stable client key plus persisted expert id.
   */
  return {
    id: `expert-${expert.id}`,
    expertId: expert.id,
    name: expert.name,
    specialization: expert.specialization,
    soul: expert.soul
  };
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

export default function HomePage() {
  /**
   * Purpose: Hosts dashboard controls: auth and panel create/select/edit/delete management.
   * Inputs: None.
   * Outputs: Home page JSX with form handlers wired to account/panel API routes.
   */
  const router = useRouter();
  const [auth, setAuth] = useState<AuthSuccess | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [panels, setPanels] = useState<PanelView[]>([]);
  const [activePanel, setActivePanel] = useState<PanelView | null>(null);
  const [isCreatePanelOpen, setIsCreatePanelOpen] = useState(false);
  const [newPanelName, setNewPanelName] = useState("");
  const [newPanelDescription, setNewPanelDescription] = useState("");
  const [newPanelInstructions, setNewPanelInstructions] = useState("");
  const [editPanelName, setEditPanelName] = useState("");
  const [editPanelDescription, setEditPanelDescription] = useState("");
  const [editPanelInstructions, setEditPanelInstructions] = useState("");
  const [expertDrafts, setExpertDrafts] = useState<ExpertDraft[]>([createExpertDraft()]);
  const [editExpertDrafts, setEditExpertDrafts] = useState<ExpertDraft[]>([]);

  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const clearSessionForExpiredToken = useCallback((message: string): void => {
    /**
     * Purpose: Clears all authenticated client state and returns UI to login mode after token expiry.
     * Inputs: User-facing auth-expiry error message.
     * Outputs: No return value; resets session state and persists signed-out storage state.
     */
    setAuth(null);
    setPanels([]);
    setActivePanel(null);
    setIsCreatePanelOpen(false);
    resetCreatePanelForm();
    writeStoredAuth(null);
    setStatusMessage("");
    setErrorMessage(message);
  }, []);

  const handleApiError = useCallback((error: unknown, fallbackMessage: string): void => {
    /**
     * Purpose: Normalizes request errors and enforces token-expiry logout behavior.
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
      handleApiError(error, "Failed to load panels.");
    });
  }, [handleApiError]);

  useEffect(() => {
    /**
     * Purpose: Keeps edit-panel form fields synchronized with the currently selected panel.
     * Inputs: Active panel value from selection/create/update flows.
     * Outputs: No return value; updates edit-panel field state.
     */
    if (!activePanel) {
      setEditPanelName("");
      setEditPanelDescription("");
      setEditPanelInstructions("");
      setEditExpertDrafts([]);
      return;
    }

    setEditPanelName(activePanel.name);
    setEditPanelDescription(activePanel.description ?? "");
    setEditPanelInstructions(activePanel.instructions ?? "");
    setEditExpertDrafts(
      activePanel.experts.length > 0
        ? activePanel.experts.map((expert) => createExpertDraftFromPanelExpert(expert))
        : [createExpertDraft()]
    );
  }, [activePanel]);

  function resetCreatePanelForm(): void {
    /**
     * Purpose: Clears create-panel draft fields and restores a single blank expert row.
     * Inputs: None.
     * Outputs: No return value; resets create-panel form state.
     */
    setNewPanelName("");
    setNewPanelDescription("");
    setNewPanelInstructions("");
    setExpertDrafts([createExpertDraft()]);
  }

  function handleToggleCreatePanel(): void {
    /**
     * Purpose: Toggles the create-panel section while collapsing any open panel editor.
     * Inputs: None.
     * Outputs: No return value; updates create/edit visibility state.
     */
    setActivePanel(null);
    setIsCreatePanelOpen((current) => !current);
    setStatusMessage("");
    setErrorMessage("");
  }

  async function submitAuth(mode: "register" | "login"): Promise<void> {
    /**
     * Purpose: Submits register/login requests and persists auth session for subsequent API calls.
     * Inputs: Auth mode selected by the user.
     * Outputs: No return value; updates auth and panel states on success.
     */
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
      setActivePanel(null);
      setIsCreatePanelOpen(false);
      resetCreatePanelForm();
      setStatusMessage(mode === "register" ? "Account created and signed in." : "Signed in.");
      setPassword("");
    } catch (error) {
      handleApiError(error, "Auth request failed.");
    } finally {
      setIsBusy(false);
    }
  }

  function handleAuthFormSubmit(event: FormEvent<HTMLFormElement>): void {
    /**
     * Purpose: Handles Enter-key auth submit by using login as the default action.
     * Inputs: Submitted auth form event.
     * Outputs: No return value; triggers login flow.
     */
    event.preventDefault();
    void submitAuth("login");
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
    setIsCreatePanelOpen(false);
    resetCreatePanelForm();
    writeStoredAuth(null);
    setStatusMessage("Signed out.");
    setErrorMessage("");
  }

  async function handleSelectPanel(panelId: number): Promise<void> {
    /**
     * Purpose: Loads full panel detail and toggles it as the active inline editor on the dashboard.
     * Inputs: Panel id from edit-button click.
     * Outputs: No return value; updates active panel state.
     */
    if (!auth) {
      return;
    }

    if (activePanel?.id === panelId) {
      setActivePanel(null);
      setStatusMessage("");
      setErrorMessage("");
      return;
    }

    setStatusMessage("");
    setErrorMessage("");
    setIsCreatePanelOpen(false);
    setIsBusy(true);
    try {
      const panel = await requestJson<PanelView>({
        path: `/api/panels/${panelId}`,
        method: "GET",
        accessToken: auth.accessToken
      });
      setActivePanel(panel);
      setStatusMessage(`Selected panel: ${panel.name}`);
    } catch (error) {
      handleApiError(error, "Failed to load panel.");
    } finally {
      setIsBusy(false);
    }
  }

  function handleExpertDraftChange(
    index: number,
    key: "name" | "specialization" | "soul",
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

  function handleEditExpertDraftChange(
    index: number,
    key: "name" | "specialization" | "soul",
    value: string
  ): void {
    /**
     * Purpose: Updates one expert draft row field in edit-panel form state.
     * Inputs: Expert row index, field key, and next value.
     * Outputs: No return value; updates edit expert draft list state.
     */
    setEditExpertDrafts((current) =>
      current.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, [key]: value } : draft
      )
    );
  }

  function addEditExpertDraft(): void {
    /**
     * Purpose: Appends a blank expert row to the edit-panel form.
     * Inputs: None.
     * Outputs: No return value; updates edit expert draft list state.
     */
    setEditExpertDrafts((current) => [...current, createExpertDraft()]);
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

  function removeEditExpertDraft(index: number): void {
    /**
     * Purpose: Removes one expert row from the edit-panel form while enforcing at least one expert row.
     * Inputs: Expert row index to remove.
     * Outputs: No return value; updates edit expert draft list state.
     */
    setEditExpertDrafts((current) => {
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
      setActivePanel(null);
      setIsCreatePanelOpen(false);
      resetCreatePanelForm();
      setStatusMessage(`Created panel: ${created.name}`);
    } catch (error) {
      handleApiError(error, "Failed to create panel.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleUpdateActivePanel(event: FormEvent<HTMLFormElement>): Promise<void> {
    /**
     * Purpose: Updates active panel metadata, refreshes the panel list, and closes the inline editor.
     * Inputs: Submitted edit-panel form event.
     * Outputs: No return value; updates dashboard state and status text.
     */
    event.preventDefault();
    if (!auth || !activePanel) {
      return;
    }

    setStatusMessage("");
    setErrorMessage("");
    setIsBusy(true);
    try {
      const updatedPanel = await requestJson<PanelView>({
        path: `/api/panels/${activePanel.id}`,
        method: "PATCH",
        accessToken: auth.accessToken,
        body: {
          name: editPanelName,
          description: editPanelDescription.length > 0 ? editPanelDescription : null,
          instructions: editPanelInstructions.length > 0 ? editPanelInstructions : null,
          experts: editExpertDrafts.map((expert) => ({
            ...(expert.expertId !== null ? { id: expert.expertId } : {}),
            name: expert.name,
            specialization: expert.specialization,
            soul: expert.soul
          }))
        }
      });
      await loadPanels(auth.accessToken);
      setActivePanel(null);
      setStatusMessage(`Updated panel: ${updatedPanel.name}.`);
    } catch (error) {
      handleApiError(error, "Failed to update panel.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeleteActivePanel(): Promise<void> {
    /**
     * Purpose: Deletes active panel after confirmation and clears dependent UI state.
     * Inputs: None.
     * Outputs: No return value; updates panel state after delete.
     */
    if (!auth || !activePanel) {
      return;
    }

    if (!window.confirm(`Delete panel "${activePanel.name}" and all its conversations?`)) {
      return;
    }

    const deletedPanelName = activePanel.name;
    setStatusMessage("");
    setErrorMessage("");
    setIsBusy(true);
    try {
      await requestJson<{ id: number }>({
        path: `/api/panels/${activePanel.id}`,
        method: "DELETE",
        accessToken: auth.accessToken
      });
      setActivePanel(null);
      await loadPanels(auth.accessToken);
      setStatusMessage(`Deleted panel: ${deletedPanelName}.`);
    } catch (error) {
      handleApiError(error, "Failed to delete panel.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="hero">
        {auth ? (
          <div className="auth-summary">
            <p>
              Signed in as <strong>{auth.account.email}</strong>
            </p>
            <button type="button" onClick={handleLogout} disabled={isBusy}>
              Logout
            </button>
          </div>
        ) : null}
        <div className="hero-copy">
          <h1>Panel of Experts</h1>
          <p>
            Build focused expert panels, shape how they think, and jump straight into the
            conversation.
          </p>
        </div>
      </header>

      {statusMessage ? <p className="status">{statusMessage}</p> : null}
      {errorMessage ? <p className="error">{errorMessage}</p> : null}

      {!auth ? (
        <section className="card auth-card">
          <div className="section-copy">
            <h2>Authentication</h2>
            <p>Sign in to create, edit, and run your own panels of experts.</p>
          </div>
          <form className="auth-form" onSubmit={handleAuthFormSubmit}>
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
                minLength={8}
                required
              />
            </label>
            <div className="auth-actions">
              <button type="button" onClick={() => void submitAuth("register")} disabled={isBusy}>
                Register
              </button>
              <button type="submit" disabled={isBusy}>
                Login
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {auth ? (
        <section className="dashboard-shell">
          <div className="dashboard-actions">
            <button
              type="button"
              className="create-panel-toggle"
              onClick={handleToggleCreatePanel}
              disabled={isBusy}
            >
              {isCreatePanelOpen ? "Close Panel Creator" : "Create Panel"}
            </button>
          </div>

          {isCreatePanelOpen ? (
            <form className="card panel-form create-panel-form" onSubmit={(event) => void handleCreatePanel(event)}>
              <div className="section-copy">
                <h2>Create Panel</h2>
                <p>Define the panel, then add the experts who will make it useful.</p>
              </div>
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

              <div className="section-copy compact-copy">
                <h3>Experts</h3>
              </div>
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
                    Personality
                    <input
                      value={expert.soul}
                      onChange={(event) =>
                        handleExpertDraftChange(index, "soul", event.target.value)
                      }
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
              <div className="action-row">
                <button type="button" onClick={addExpertDraft} disabled={isBusy}>
                  Add Expert
                </button>
                <button type="submit" disabled={isBusy}>
                  Create Panel
                </button>
              </div>
            </form>
          ) : null}

          <div className="panel-stack">
            {panels.length === 0 ? (
              <article className="card panel-card empty-card">
                <div className="section-copy">
                  <h2>No Panels Yet</h2>
                  <p>Create your first panel to start building conversations.</p>
                </div>
              </article>
            ) : null}

            {panels.map((panel) => {
              const isEditing = activePanel?.id === panel.id;

              return (
                <article
                  key={panel.id}
                  className={`card panel-card panel-card-interactive ${isEditing ? "panel-card-editing" : ""}`}
                >
                  <div className="panel-card-controls">
                    <button
                      type="button"
                      onClick={() => void handleSelectPanel(panel.id)}
                      disabled={isBusy}
                    >
                      {isEditing ? "Close Editor" : "Edit Panel"}
                    </button>
                  </div>

                  <button
                    type="button"
                    className="panel-card-launch"
                    onClick={() => router.push(`/chat?panelId=${panel.id}`)}
                    disabled={isBusy}
                  >
                    <div className="panel-card-center">
                      <h2>{panel.name}</h2>
                    </div>

                    <p className={`panel-description ${panel.description ? "" : "muted"}`}>
                      {panel.description ?? "No description yet."}
                    </p>

                    <div className="expert-block">
                      <p className="expert-heading">Experts:</p>
                      <ul className="expert-summary-list">
                        {panel.experts.map((expert) => (
                          <li key={expert.id}>
                            {expert.name} - {expert.specialization}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </button>

                  {isEditing ? (
                    <form
                      className="panel-form edit-panel-form"
                      onSubmit={(event) => void handleUpdateActivePanel(event)}
                    >
                      <div className="section-copy compact-copy">
                        <h3>Edit Panel</h3>
                      </div>
                      <label>
                        Name
                        <input
                          value={editPanelName}
                          onChange={(event) => setEditPanelName(event.target.value)}
                          maxLength={255}
                          required
                        />
                      </label>
                      <label>
                        Description
                        <input
                          value={editPanelDescription}
                          onChange={(event) => setEditPanelDescription(event.target.value)}
                          maxLength={255}
                        />
                      </label>
                      <label>
                        Instructions
                        <textarea
                          value={editPanelInstructions}
                          onChange={(event) => setEditPanelInstructions(event.target.value)}
                          rows={3}
                        />
                      </label>
                      <div className="section-copy compact-copy">
                        <h3>Experts</h3>
                        <p>
                          Edit the roster in place. Removing an expert with saved responses is
                          blocked to preserve conversation history.
                        </p>
                      </div>
                      {editExpertDrafts.map((expert, index) => (
                        <fieldset key={expert.id}>
                          <legend>Expert {index + 1}</legend>
                          <label>
                            Name
                            <input
                              value={expert.name}
                              onChange={(event) =>
                                handleEditExpertDraftChange(index, "name", event.target.value)
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
                                handleEditExpertDraftChange(
                                  index,
                                  "specialization",
                                  event.target.value
                                )
                              }
                              maxLength={255}
                              required
                            />
                          </label>
                          <label>
                            Personality
                            <input
                              value={expert.soul}
                              onChange={(event) =>
                                handleEditExpertDraftChange(index, "soul", event.target.value)
                              }
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => removeEditExpertDraft(index)}
                            disabled={editExpertDrafts.length <= 1 || isBusy}
                          >
                            Remove Expert
                          </button>
                        </fieldset>
                      ))}
                      <div className="action-row">
                        <button type="button" onClick={addEditExpertDraft} disabled={isBusy}>
                          Add Expert
                        </button>
                        <button type="submit" disabled={isBusy}>
                          Save Panel Changes
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => void handleDeleteActivePanel()}
                          disabled={isBusy}
                        >
                          Delete Panel
                        </button>
                      </div>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <style jsx>{`
        .page {
          --bg-start: #f4f7ff;
          --bg-mid: #edf8f5;
          --bg-end: #fff6eb;
          --text-main: #1f2633;
          --card-bg: rgba(255, 255, 255, 0.9);
          --card-border: #ccd4e5;
          --form-bg: #fdfefe;
          --form-border: #dde4f1;
          --field-border: #c5cedd;
          --button-border: #44577a;
          --button-bg: #eef4ff;
          --button-hover: #e2ebff;
          --panel-bg: #f9fbff;
          --panel-border: #ced8eb;
          --status-color: #1b5e20;
          --error-color: #a11818;
          --danger-border: #9c2a2a;
          --danger-bg: #ffefef;
          --danger-text: #6f1111;
          color-scheme: light;
          min-height: 100vh;
          padding: 24px;
          background: linear-gradient(170deg, var(--bg-start) 0%, var(--bg-mid) 45%, var(--bg-end) 100%);
          color: var(--text-main);
          font-family: "Trebuchet MS", "Segoe UI", sans-serif;
          display: grid;
          align-content: start;
          gap: 18px;
        }

        @media (prefers-color-scheme: dark) {
          .page {
            --bg-start: #0d1117;
            --bg-mid: #111827;
            --bg-end: #161b22;
            --text-main: #e5ebf5;
            --card-bg: rgba(20, 28, 40, 0.92);
            --card-border: #334155;
            --form-bg: #111827;
            --form-border: #334155;
            --field-border: #475569;
            --button-border: #64748b;
            --button-bg: #1e293b;
            --button-hover: #273449;
            --panel-bg: #0f172a;
            --panel-border: #334155;
            --status-color: #86efac;
            --error-color: #fca5a5;
            --danger-border: #f87171;
            --danger-bg: rgba(153, 27, 27, 0.25);
            --danger-text: #fecaca;
            color-scheme: dark;
          }
        }

        .hero {
          position: relative;
          display: grid;
          justify-items: center;
          gap: 14px;
          padding: 28px 12px 6px;
        }

        .hero-copy {
          display: grid;
          gap: 12px;
          justify-items: center;
          text-align: center;
          max-width: 760px;
        }

        .hero h1 {
          margin: 0;
          font-size: clamp(2.5rem, 6vw, 4.25rem);
          line-height: 0.95;
          letter-spacing: -0.04em;
        }

        .hero-copy p {
          margin: 0;
          max-width: 620px;
          font-size: 1.05rem;
          line-height: 1.55;
        }

        .auth-summary {
          position: absolute;
          top: 0;
          right: 0;
          display: grid;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
        }

        .auth-summary p {
          margin: 0;
          text-align: right;
        }

        .card {
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          border-radius: 16px;
          padding: 18px;
          display: grid;
          gap: 14px;
          backdrop-filter: blur(6px);
          box-shadow: 0 22px 40px -34px rgba(15, 23, 42, 0.5);
        }

        .auth-form {
          width: min(100%, 640px);
          justify-self: center;
        }

        .auth-actions {
          display: grid;
          gap: 10px;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        }

        .auth-card,
        .dashboard-shell {
          width: min(100%, 860px);
          margin: 0 auto;
        }

        .dashboard-shell {
          display: grid;
          gap: 14px;
        }

        .dashboard-actions {
          display: grid;
        }

        .create-panel-toggle {
          width: 100%;
          border-radius: 14px;
          padding: 14px 18px;
          font-size: 1.08rem;
          font-weight: 700;
        }

        .panel-stack {
          display: grid;
          gap: 14px;
        }

        .panel-card {
          position: relative;
          gap: 16px;
        }

        .panel-card-interactive {
          padding: 0;
          gap: 0;
          overflow: hidden;
          background: var(--panel-bg);
          transition: border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease;
        }

        .panel-card-interactive:hover,
        .panel-card-interactive:focus-within {
          border-color: color-mix(in srgb, var(--button-border) 75%, var(--card-border));
          background: color-mix(in srgb, var(--panel-bg) 88%, var(--button-bg));
          box-shadow: 0 24px 38px -32px rgba(15, 23, 42, 0.6);
        }

        .panel-card-editing {
          border-color: var(--button-border);
        }

        .panel-card-center {
          text-align: center;
          min-width: 0;
        }

        .panel-card-center h2 {
          margin: 0;
          font-size: clamp(1.45rem, 3vw, 1.95rem);
          line-height: 1.05;
          overflow-wrap: anywhere;
        }

        .panel-card-controls {
          position: absolute;
          top: 18px;
          right: 18px;
          z-index: 1;
        }

        .panel-card-controls button {
          min-width: 128px;
        }

        .panel-card-launch {
          display: grid;
          gap: 16px;
          width: 100%;
          text-align: left;
          text-decoration: none;
          color: inherit;
          border: 1px solid transparent;
          border-radius: 16px;
          padding: 54px 18px 18px;
          background: transparent;
          transition: background-color 120ms ease, border-color 120ms ease;
        }

        .panel-card-launch:hover {
          background: color-mix(in srgb, var(--button-bg) 64%, transparent);
          border-color: color-mix(in srgb, var(--button-border) 65%, transparent);
        }

        .panel-card-launch:focus-visible {
          outline: none;
          border-color: var(--button-border);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--button-border) 22%, transparent);
        }

        .panel-description {
          margin: 0;
          font-size: 1rem;
          line-height: 1.5;
          white-space: pre-wrap;
        }

        .muted {
          opacity: 0.72;
        }

        .expert-block {
          display: grid;
          gap: 8px;
        }

        .expert-heading {
          margin: 0;
          font-weight: 700;
        }

        .expert-summary-list {
          margin: 0;
          padding-left: 18px;
          display: grid;
          gap: 6px;
        }

        .section-copy {
          display: grid;
          gap: 6px;
          justify-items: center;
          text-align: center;
        }

        .section-copy h2,
        .section-copy h3 {
          margin: 0;
        }

        .section-copy p {
          margin: 0;
          line-height: 1.5;
        }

        .compact-copy {
          justify-items: start;
          text-align: left;
        }

        .panel-form,
        form {
          display: grid;
          gap: 10px;
          padding: 12px;
          border: 1px solid var(--form-border);
          border-radius: 14px;
          background: var(--form-bg);
        }

        label {
          display: grid;
          gap: 4px;
          font-size: 0.92rem;
        }

        input,
        textarea,
        button,
        .button-link {
          font: inherit;
        }

        input,
        textarea {
          border: 1px solid var(--field-border);
          border-radius: 8px;
          padding: 8px 10px;
          background: var(--card-bg);
          color: var(--text-main);
        }

        button,
        .button-link {
          border: 1px solid var(--button-border);
          border-radius: 10px;
          padding: 10px 12px;
          background: var(--button-bg);
          color: var(--text-main);
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: transform 120ms ease, background-color 120ms ease;
        }

        button:hover,
        .button-link:hover {
          transform: translateY(-1px);
          background: var(--button-hover);
        }

        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        ul {
          margin: 0;
          padding-left: 20px;
          display: grid;
          gap: 6px;
        }

        fieldset {
          border: 1px solid var(--form-border);
          border-radius: 12px;
          padding: 10px;
          display: grid;
          gap: 8px;
        }

        legend {
          padding: 0 6px;
          font-weight: 700;
        }

        .status {
          margin: 0;
          color: var(--status-color);
          font-weight: 700;
          width: min(100%, 860px);
          margin-left: auto;
          margin-right: auto;
        }

        .error {
          margin: 0;
          color: var(--error-color);
          font-weight: 700;
          width: min(100%, 860px);
          margin-left: auto;
          margin-right: auto;
        }

        .action-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .danger {
          border-color: var(--danger-border);
          background: var(--danger-bg);
          color: var(--danger-text);
        }

        @media (max-width: 720px) {
          .page {
            padding: 18px 14px 28px;
          }

          .hero {
            padding-top: 12px;
          }

          .auth-summary {
            position: static;
            justify-items: center;
          }

          .auth-summary p {
            text-align: center;
          }

          .panel-card-controls button {
            width: 100%;
          }

          .panel-card-controls {
            position: static;
          }

          .panel-card-launch {
            padding-top: 18px;
          }

          .action-row {
            display: grid;
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}
