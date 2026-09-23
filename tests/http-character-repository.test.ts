import { describe, expect, it, vi } from "vitest";
import { HttpCharacterRepository, CharacterApiError } from "@threepointpf/shared";
import { levelOneFighter } from "../apps/web/src/lib/sample-characters";
import { rulesCatalogs } from "@threepointpf/rules-data";

const response = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...Object.fromEntries(new Headers(headers).entries()) } });

describe("HttpCharacterRepository", () => {
  it("loads and validates a canonical character with relative same-origin requests", async () => {
    const fetcher = vi.fn(async () => response({ character: levelOneFighter, revision: 7 }));
    const repository = new HttpCharacterRepository({ fetch: fetcher as typeof fetch, rules: rulesCatalogs });
    expect(await repository.load(levelOneFighter.id)).toMatchObject({ id: levelOneFighter.id, name: levelOneFighter.name });
    expect(fetcher).toHaveBeenCalledWith(`/api/characters/${levelOneFighter.id}`, expect.objectContaining({ credentials: "same-origin" }));
  });

  it("returns null for missing characters", async () => {
    const repository = new HttpCharacterRepository({ fetch: vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch });
    expect(await repository.load("missing")).toBeNull();
  });

  it("sends only canonical authored state and carries the revision on update", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ character: levelOneFighter, revision: "r1" }))
      .mockImplementationOnce(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body));
        expect(payload.revision).toBe("r1");
        expect(payload.character).not.toHaveProperty("bab");
        expect(payload.character).not.toHaveProperty("derived");
        return response({ character: payload.character, revision: "r2" });
      });
    const repository = new HttpCharacterRepository({ fetch: fetcher as typeof fetch, rules: rulesCatalogs });
    await repository.load(levelOneFighter.id);
    await repository.save({ ...levelOneFighter, name: "Saved through HTTP" });
    expect(fetcher.mock.calls[1]?.[0]).toBe(`/api/characters/${levelOneFighter.id}`);
  });

  it("rejects malformed server character data", async () => {
    const repository = new HttpCharacterRepository({ fetch: vi.fn(async () => response({ character: { id: "bad" } })) as typeof fetch });
    await expect(repository.load("bad")).rejects.toMatchObject({ code: "protocol" });
  });

  it.each([
    [401, "unauthenticated"], [403, "forbidden"], [409, "conflict"], [422, "validation"], [503, "server"],
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    const fetcher = vi.fn(async () => response({ error: { code, message: "safe message" } }, status));
    const repository = new HttpCharacterRepository({ fetch: fetcher as typeof fetch });
    await expect(repository.load("id")).rejects.toMatchObject({ name: "CharacterApiError", code });
  });

  it("maps network rejection to a typed failure", async () => {
    const repository = new HttpCharacterRepository({ fetch: vi.fn(async () => { throw new Error("socket details"); }) as typeof fetch });
    await expect(repository.load("id")).rejects.toMatchObject({ code: "network", message: "Could not reach the character service" });
    await expect(repository.load("id")).rejects.toBeInstanceOf(CharacterApiError);
  });
});
