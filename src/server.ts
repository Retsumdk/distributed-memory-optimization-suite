import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { MemoryCluster } from "./cluster.js";
import { MemoryError, isMemoryError } from "./errors.js";
import { isMemoryKind } from "./store.js";
import type { MemoryEntry, MemoryKind, NewMemoryInput } from "./types.js";

const MAX_BODY_BYTES = 1_000_000;

export interface ServerOptions {
  token?: string;
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  if (aBytes.length !== bBytes.length) return false;
  return timingSafeEqual(aBytes, bBytes);
}

function authorized(request: IncomingMessage, token: string | undefined): boolean {
  if (token === undefined) return true;
  const header = request.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  return constantTimeEqual(header.slice("Bearer ".length), token);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(payload);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new MemoryError("VALIDATION", `request body exceeds ${MAX_BODY_BYTES} bytes`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(chunks.join("")));
    request.on("error", reject);
  });
}

function entryToJson(entry: MemoryEntry): Record<string, unknown> {
  return { ...entry };
}

export function createMemoryServer(cluster: MemoryCluster, options: ServerOptions = {}): Server {
  const token = options.token;

  const mutation = (request: IncomingMessage, response: ServerResponse): boolean => {
    if (authorized(request, token)) return true;
    sendJson(response, 401, { error: "UNAUTHORIZED", message: "missing or invalid bearer token" });
    return false;
  };

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = request.method ?? "GET";
    try {
      if (method === "GET" && path === "/healthz") {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (method === "GET" && path === "/stats") {
        sendJson(response, 200, cluster.stats());
        return;
      }
      if (method === "GET" && path === "/nodes") {
        sendJson(response, 200, {
          nodes: cluster.nodes().map((store) => store.stats()),
        });
        return;
      }
      if (method === "POST" && path === "/nodes") {
        if (!mutation(request, response)) return;
        const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        const store = cluster.addNode(String(body["id"] ?? ""), Number(body["capacityTokens"] ?? 0));
        sendJson(response, 201, store.stats());
        return;
      }
      if (method === "GET" && path === "/entries") {
        const nodeFilter = url.searchParams.get("node");
        const kindFilter = url.searchParams.get("kind");
        if (kindFilter !== null && !isMemoryKind(kindFilter)) {
          throw new MemoryError("VALIDATION", `unknown memory kind "${kindFilter}"`);
        }
        const stores = nodeFilter === null ? cluster.nodes() : [cluster.node(nodeFilter)].filter((s) => s !== undefined);
        if (nodeFilter !== null && stores.length === 0) {
          throw new MemoryError("NOT_FOUND", `unknown node "${nodeFilter}"`);
        }
        const entries: Record<string, unknown>[] = [];
        for (const store of stores) {
          for (const entry of store.entries()) {
            if (kindFilter !== null && entry.kind !== (kindFilter as MemoryKind)) continue;
            entries.push(entryToJson(entry));
          }
        }
        sendJson(response, 200, { entries, count: entries.length });
        return;
      }
      if (method === "POST" && path === "/entries") {
        if (!mutation(request, response)) return;
        const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        const rawKind = body["kind"] ?? "episodic";
        if (typeof rawKind !== "string" || !isMemoryKind(rawKind)) {
          throw new MemoryError("VALIDATION", `unknown memory kind "${String(rawKind)}"`);
        }
        const input: NewMemoryInput = {
          node: String(body["node"] ?? ""),
          ...(typeof body["agent"] === "string" ? { agent: body["agent"] as string } : {}),
          content: String(body["content"] ?? ""),
          ...(typeof body["tokens"] === "number" ? { tokens: body["tokens"] as number } : {}),
          kind: rawKind as MemoryKind,
          ...(typeof body["importance"] === "number" ? { importance: body["importance"] as number } : {}),
          ...(typeof body["pinned"] === "boolean" ? { pinned: body["pinned"] as boolean } : {}),
          ...(Array.isArray(body["tags"]) ? { tags: body["tags"].map(String) } : {}),
          ...(typeof body["id"] === "string" ? { id: body["id"] as string } : {}),
        };
        const entry = cluster.add(input);
        sendJson(response, 201, entryToJson(entry));
        return;
      }
      const touchMatch = path.match(/^\/entries\/([^/]+)\/touch$/);
      if (method === "POST" && touchMatch !== null) {
        if (!mutation(request, response)) return;
        const id = decodeURIComponent(touchMatch[1] as string);
        const entry = cluster.get(id);
        if (entry === undefined) {
          throw new MemoryError("NOT_FOUND", `entry "${id}" not found`);
        }
        const store = cluster.node(entry.node);
        if (store === undefined || !store.touch(id)) {
          throw new MemoryError("NOT_FOUND", `entry "${id}" not found`);
        }
        const touched = store.get(id);
        if (touched === undefined) {
          throw new MemoryError("NOT_FOUND", `entry "${id}" not found`);
        }
        sendJson(response, 200, entryToJson(touched));
        return;
      }
      const deleteMatch = path.match(/^\/entries\/([^/]+)$/);
      if (method === "DELETE" && deleteMatch !== null) {
        if (!mutation(request, response)) return;
        const id = decodeURIComponent(deleteMatch[1] as string);
        const entry = cluster.get(id);
        if (entry === undefined) {
          throw new MemoryError("NOT_FOUND", `entry "${id}" not found`);
        }
        const store = cluster.node(entry.node);
        const removed = store !== undefined && store.remove(id);
        if (!removed) {
          throw new MemoryError("NOT_FOUND", `entry "${id}" not found`);
        }
        sendJson(response, 200, { removed: true, id });
        return;
      }
      if (method === "POST" && path === "/optimize") {
        if (!mutation(request, response)) return;
        sendJson(response, 200, cluster.optimizeAll());
        return;
      }
      sendJson(response, 404, { error: "NOT_FOUND", message: `no route for ${method} ${path}` });
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: "VALIDATION", message: "request body is not valid JSON" });
        return;
      }
      if (isMemoryError(error)) {
        sendJson(response, error.httpStatus, { error: error.code, message: error.message });
        return;
      }
      sendJson(response, 500, { error: "INTERNAL", message: error instanceof Error ? error.message : String(error) });
    }
  });
}
