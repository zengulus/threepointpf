// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CampaignManagement } from "../apps/web/src/components/campaign-management";
import { CampaignDiscordSettings } from "../apps/web/src/components/campaign-discord-settings";

vi.mock("../apps/web/src/components/character-assignments", () => ({
  CharacterAssignments: ({ campaignId, players }: { campaignId: string; players: { name: string }[] }) => <output data-testid="assignment-players">{campaignId}: {players.map((player) => player.name).join(", ")}</output>,
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const campaigns = [{ id: "alpha", name: "Alpha campaign" }, { id: "beta", name: "Beta campaign" }];
const member = (id: string) => ({ accountId: id, username: id, name: `${id} player`, role: "player" });
const connection = (id: string) => ({ channelId: id, guildId: null, enabled: true, version: 1, updatedAt: "2026-10-10T00:00:00Z" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((yes) => { resolve = yes; });
  return { promise, resolve };
}
async function settle(pending: ReturnType<typeof pendingResponse>, body: unknown, status = 200) {
  await act(async () => { pending.resolve(json(body, status)); await pending.promise; });
}
function mockRequests(handler: (path: string, init: RequestInit) => Response | Promise<Response> | undefined = () => undefined) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    const intercepted = handler(path, init);
    if (intercepted) return Promise.resolve(intercepted);
    if (path === "/api/campaigns") return Promise.resolve(json({ campaigns }));
    if (path.endsWith("/members")) return Promise.resolve(json({ members: [member(path.includes("/alpha/") ? "alpha" : "beta")] }));
    if (path.endsWith("/discord")) return Promise.resolve(json({ connection: null }));
    throw new Error(`Unexpected request: ${init.method || "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
function membersPanel() {
  return within(screen.getByRole("heading", { name: "Members" }).closest("section")!);
}
async function openManagement() {
  const view = render(<CampaignManagement siteAdmin accountId="owner" />);
  await waitFor(() => expect(membersPanel().getByLabelText("Campaign")).toBeTruthy());
  return view;
}
function selectMembersCampaign(id: string) {
  fireEvent.change(membersPanel().getByLabelText("Campaign"), { target: { value: id } });
}
function submitMember(username = "new-player") {
  const input = membersPanel().getByLabelText("Existing username");
  fireEvent.change(input, { target: { value: username } });
  fireEvent.submit(input.closest("form")!);
}
async function openDiscord() {
  const view = render(<CampaignDiscordSettings />);
  await screen.findByLabelText("Campaign");
  return view;
}
function selectDiscordCampaign(id: string) {
  fireEvent.change(screen.getByLabelText("Campaign"), { target: { value: id } });
}
function enterWebhook(value = "https://discord.com/api/webhooks/123/token-alpha") {
  fireEvent.change(screen.getByLabelText("Discord webhook URL"), { target: { value } });
}
function submitWebhook() {
  fireEvent.submit(screen.getByLabelText("Discord webhook URL").closest("form")!);
}

it("keeps only the latest campaign's members and assignment choices when reads finish out of order", async () => {
  const alpha = pendingResponse();
  mockRequests((path) => path === "/api/campaigns/alpha/members" ? alpha.promise : undefined);
  await openManagement();
  selectMembersCampaign("beta");
  await membersPanel().findByText("beta player");
  await settle(alpha, { members: [member("alpha")] });
  expect(membersPanel().queryByText("alpha player")).toBeNull();
  expect(screen.getByTestId("assignment-players").textContent).toBe("beta: beta player");
});

it("clears previous members and the member draft immediately while the next campaign loads", async () => {
  const beta = pendingResponse();
  mockRequests((path) => path === "/api/campaigns/beta/members" ? beta.promise : undefined);
  await openManagement();
  await membersPanel().findByText("alpha player");
  fireEvent.change(membersPanel().getByLabelText("Existing username"), { target: { value: "alpha-draft" } });
  selectMembersCampaign("beta");
  expect(membersPanel().queryByText("alpha player")).toBeNull();
  expect((membersPanel().getByLabelText("Existing username") as HTMLInputElement).value).toBe("");
  expect(screen.getByTestId("assignment-players").textContent).toBe("beta: ");
  await settle(beta, { members: [member("beta")] });
});

it("deduplicates member submissions and ignores an old save without unlocking the new campaign's save", async () => {
  const alpha = pendingResponse(); const beta = pendingResponse();
  const fetchMock = mockRequests((path, init) => init.method === "PUT" && path.endsWith("/members") ? (path.includes("/alpha/") ? alpha.promise : beta.promise) : undefined);
  await openManagement();
  await membersPanel().findByText("alpha player");
  const oldForm = membersPanel().getByLabelText("Existing username").closest("form")!;
  act(() => { submitMember(); fireEvent.submit(oldForm); });
  expect(fetchMock.mock.calls.filter(([path, init]) => path === "/api/campaigns/alpha/members" && init?.method === "PUT")).toHaveLength(1);
  selectMembersCampaign("beta");
  await membersPanel().findByText("beta player");
  submitMember("beta-draft");
  await settle(alpha, {});
  expect((membersPanel().getByRole("button", { name: "Add member" }) as HTMLButtonElement).disabled).toBe(true);
  expect((membersPanel().getByLabelText("Existing username") as HTMLInputElement).value).toBe("beta-draft");
  expect(membersPanel().queryByRole("status")).toBeNull();
  expect(fetchMock.mock.calls.filter(([path, init]) => path === "/api/campaigns/alpha/members" && !init?.method)).toHaveLength(1);
  await settle(beta, {});
  expect(membersPanel().getByRole("status").textContent).toBe("Campaign member added.");
  expect((membersPanel().getByRole("button", { name: "Add member" }) as HTMLButtonElement).disabled).toBe(false);
});

it.each([200, 500])("ignores a previous campaign's member refresh after navigation (HTTP %s)", async (status) => {
  const refresh = pendingResponse(); let alphaReads = 0;
  mockRequests((path, init) => {
    if (path === "/api/campaigns/alpha/members" && !init.method && ++alphaReads > 1) return refresh.promise;
  });
  await openManagement();
  await membersPanel().findByText("alpha player");
  submitMember();
  await waitFor(() => expect(alphaReads).toBe(2));
  selectMembersCampaign("beta");
  await membersPanel().findByText("beta player");
  await settle(refresh, status === 200 ? { members: [member("stale")] } : { error: { message: "Stale refresh failed" } }, status);
  expect(membersPanel().queryByText("stale player")).toBeNull();
  expect(membersPanel().queryByRole("status")).toBeNull();
});

it("ignores a failed removal after switching away and back to the same campaign", async () => {
  const removal = pendingResponse();
  mockRequests((path, init) => path.endsWith("/members") && init.method === "DELETE" ? removal.promise : undefined);
  await openManagement(); await membersPanel().findByText("alpha player");
  fireEvent.click(membersPanel().getByRole("button", { name: "Remove" }));
  selectMembersCampaign("beta"); await membersPanel().findByText("beta player");
  selectMembersCampaign("alpha"); await membersPanel().findByText("alpha player");
  await settle(removal, { error: { message: "Old removal failed" } }, 500);
  expect(membersPanel().queryByRole("status")).toBeNull();
  expect((membersPanel().getByRole("button", { name: "Remove" }) as HTMLButtonElement).disabled).toBe(false);
});

it("refreshes newly created campaigns without overriding a newer campaign selection", async () => {
  const creation = pendingResponse(); let created = false;
  mockRequests((path, init) => {
    if (path !== "/api/campaigns") return undefined;
    if (init.method === "POST") return creation.promise;
    if (created) return json({ campaigns: [...campaigns, { id: "gamma", name: "Gamma campaign" }] });
  });
  await openManagement();
  fireEvent.change(screen.getByLabelText("Campaign ID"), { target: { value: "gamma" } });
  fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Gamma campaign" } });
  const form = screen.getByLabelText("Campaign ID").closest("form")!;
  fireEvent.submit(form);
  selectMembersCampaign("beta");
  created = true;
  await settle(creation, { campaign: { id: "gamma", name: "Gamma campaign" } });
  await membersPanel().findByRole("option", { name: "Gamma campaign" });
  expect((membersPanel().getByLabelText("Campaign") as unknown as HTMLSelectElement).value).toBe("beta");
  expect(membersPanel().queryByRole("status")).toBeNull();
});

it("does not refresh a member action after its screen has unmounted", async () => {
  const save = pendingResponse();
  const fetchMock = mockRequests((path, init) => path.endsWith("/members") && init.method === "PUT" ? save.promise : undefined);
  const view = await openManagement();
  await membersPanel().findByText("alpha player");
  submitMember(); view.unmount();
  const count = fetchMock.mock.calls.length;
  await settle(save, {});
  expect(fetchMock.mock.calls).toHaveLength(count);
});

it("clears a Discord webhook draft and connection immediately when changing campaigns", async () => {
  const beta = pendingResponse();
  mockRequests((path) => path === "/api/campaigns/alpha/discord" ? json({ connection: connection("alpha-channel") }) : path === "/api/campaigns/beta/discord" ? beta.promise : undefined);
  await openDiscord();
  await screen.findByText("Connected to Discord channel alpha-channel.");
  enterWebhook(); selectDiscordCampaign("beta");
  expect((screen.getByLabelText("Discord webhook URL") as HTMLInputElement).value).toBe("");
  expect(screen.queryByText("Connected to Discord channel alpha-channel.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Disconnect channel" })).toBeNull();
  await settle(beta, { connection: connection("beta-channel") });
});

it.each([200, 500])("ignores an old Discord connection result and keeps the new operation busy (HTTP %s)", async (status) => {
  const alpha = pendingResponse(); const beta = pendingResponse();
  const fetchMock = mockRequests((path, init) => init.method === "PUT" ? (path.includes("/alpha/") ? alpha.promise : beta.promise) : undefined);
  await openDiscord(); enterWebhook();
  act(() => { submitWebhook(); submitWebhook(); });
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  selectDiscordCampaign("beta"); enterWebhook("https://discord.com/api/webhooks/456/token-beta"); submitWebhook();
  await settle(alpha, status === 200 ? { connection: connection("alpha-channel") } : { error: { message: "Old connection failed" } }, status);
  expect(screen.queryByText("Connected to Discord channel alpha-channel.")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect((screen.getByRole("button", { name: "Connect channel" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("Discord webhook URL") as HTMLInputElement).value).toContain("token-beta");
  await settle(beta, { connection: connection("beta-channel") });
  expect(screen.getByText("Connected to Discord channel beta-channel.")).toBeTruthy();
});

it.each(["Disconnect channel", "Send test message"])("ignores the old campaign's %s completion", async (action) => {
  const operation = pendingResponse();
  mockRequests((path, init) => {
    if (init.method) return operation.promise;
    if (path.endsWith("/discord")) return json({ connection: connection(path.includes("/alpha/") ? "alpha-channel" : "beta-channel") });
  });
  await openDiscord(); await screen.findByText("Connected to Discord channel alpha-channel.");
  fireEvent.click(screen.getByRole("button", { name: action }));
  selectDiscordCampaign("beta"); await screen.findByText("Connected to Discord channel beta-channel.");
  await settle(operation, {});
  expect(screen.getByText("Connected to Discord channel beta-channel.")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});

it("keeps a successful connection when its older initial read finishes later", async () => {
  const initial = pendingResponse();
  mockRequests((path, init) => path.endsWith("/discord") ? (init.method === "PUT" ? json({ connection: connection("new-channel") }) : initial.promise) : undefined);
  await openDiscord(); enterWebhook(); submitWebhook();
  await screen.findByText("Connected to Discord channel new-channel.");
  await settle(initial, { connection: connection("old-channel") });
  expect(screen.getByText("Connected to Discord channel new-channel.")).toBeTruthy();
  expect(screen.queryByText("Connected to Discord channel old-channel.")).toBeNull();
});

it("preserves a newer webhook edit when an earlier submission completes", async () => {
  const save = pendingResponse();
  mockRequests((_path, init) => init.method === "PUT" ? save.promise : undefined);
  await openDiscord(); enterWebhook(); submitWebhook();
  enterWebhook("https://discord.com/api/webhooks/456/newer-draft");
  await settle(save, { connection: connection("alpha-channel") });
  expect((screen.getByLabelText("Discord webhook URL") as HTMLInputElement).value).toContain("newer-draft");
});

it.each([200, 500])("ignores an older Discord save after A to B to A navigation (HTTP %s)", async (status) => {
  const save = pendingResponse();
  mockRequests((path, init) => {
    if (init.method === "PUT") return save.promise;
    if (path.endsWith("/discord")) return json({ connection: connection(path.includes("/alpha/") ? "current-alpha" : "beta-channel") });
  });
  await openDiscord(); await screen.findByText("Connected to Discord channel current-alpha.");
  enterWebhook(); submitWebhook();
  selectDiscordCampaign("beta"); await screen.findByText("Connected to Discord channel beta-channel.");
  selectDiscordCampaign("alpha"); await screen.findByText("Connected to Discord channel current-alpha.");
  enterWebhook("https://discord.com/api/webhooks/789/new-alpha-draft");
  await settle(save, status === 200 ? { connection: connection("stale-alpha") } : { error: { message: "Old save failed" } }, status);
  expect(screen.getByText("Connected to Discord channel current-alpha.")).toBeTruthy();
  expect(screen.queryByText("Connected to Discord channel stale-alpha.")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect((screen.getByLabelText("Discord webhook URL") as HTMLInputElement).value).toContain("new-alpha-draft");
});

it("does not let an initial campaign list overwrite a successful creation refresh", async () => {
  const initial = pendingResponse(); const createdCampaign = { id: "gamma", name: "Gamma campaign" };
  let created = false;
  const fetchMock = mockRequests((path, init) => {
    if (path !== "/api/campaigns") return undefined;
    if (init.method === "POST") { created = true; return json({ campaign: createdCampaign }); }
    return created ? json({ campaigns: [...campaigns, createdCampaign] }) : initial.promise;
  });
  render(<CampaignManagement siteAdmin accountId="owner" />);
  fireEvent.change(screen.getByLabelText("Campaign ID"), { target: { value: "gamma" } });
  fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Gamma campaign" } });
  const form = screen.getByLabelText("Campaign ID").closest("form")!;
  act(() => { fireEvent.submit(form); fireEvent.submit(form); });
  await membersPanel().findByRole("option", { name: "Gamma campaign" });
  await settle(initial, { campaigns });
  expect((membersPanel().getByLabelText("Campaign") as unknown as HTMLSelectElement).value).toBe("gamma");
  expect(membersPanel().getByRole("option", { name: "Gamma campaign" })).toBeTruthy();
  expect(membersPanel().getByRole("status").textContent).toContain("Gamma campaign is ready.");
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});

it("ignores a stale member-list failure after navigating to another campaign", async () => {
  const alpha = pendingResponse();
  mockRequests((path) => path === "/api/campaigns/alpha/members" ? alpha.promise : undefined);
  await openManagement(); selectMembersCampaign("beta");
  await membersPanel().findByText("beta player");
  await settle(alpha, { error: { message: "Old member list failed" } }, 500);
  expect(membersPanel().queryByRole("status")).toBeNull();
  expect(screen.getByTestId("assignment-players").textContent).toBe("beta: beta player");
});
