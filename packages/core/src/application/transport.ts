import type { Clock, IdGenerator, Repositories } from "../ports/index.js";

/** Services injected into every command/query handler. */
export interface HandlerContext {
  repos: Repositories;
  ids: IdGenerator;
  clock: Clock;
}

export type CommandHandler<I = unknown, O = unknown> = (
  input: I,
  ctx: HandlerContext,
) => Promise<O>;

export type QueryHandler<I = unknown, O = unknown> = (
  input: I,
  ctx: HandlerContext,
) => Promise<O>;

export interface HandlerRegistry {
  commands: Map<string, CommandHandler>;
  queries: Map<string, QueryHandler>;
}

export function createRegistry(): HandlerRegistry {
  return { commands: new Map(), queries: new Map() };
}

export class UnknownOperationError extends Error {
  constructor(kind: "command" | "query", name: string) {
    super(`Unknown ${kind}: ${name}`);
    this.name = "UnknownOperationError";
  }
}

/**
 * In-process implementation of the client-core transport contract (TAS 3.4).
 * The remote transport (HTTP/WS) implements the same surface in apps/server.
 */
export class LocalTransport {
  constructor(
    private readonly registry: HandlerRegistry,
    private readonly ctx: HandlerContext,
  ) {}

  async command<TInput, TOutput>(name: string, input: TInput): Promise<TOutput> {
    const handler = this.registry.commands.get(name);
    if (!handler) throw new UnknownOperationError("command", name);
    return handler(input, this.ctx) as Promise<TOutput>;
  }

  async query<TInput, TOutput>(name: string, input: TInput): Promise<TOutput> {
    const handler = this.registry.queries.get(name);
    if (!handler) throw new UnknownOperationError("query", name);
    return handler(input, this.ctx) as Promise<TOutput>;
  }
}
