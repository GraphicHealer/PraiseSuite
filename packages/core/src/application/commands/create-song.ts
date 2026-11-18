import type { Song } from "../../domain/songs/types.js";
import type { SongId } from "../../ids.js";
import type { SongSummary } from "../../ports/index.js";
import type { CommandHandler, QueryHandler, HandlerRegistry } from "../transport.js";

export interface CreateSongInput {
  title: string;
  authors?: string[];
}

export const createSong: CommandHandler<CreateSongInput, SongSummary> = async (
  input,
  ctx,
) => {
  const now = ctx.clock.now().toISOString();
  const song: Song = {
    id: ctx.ids.next() as SongId,
    title: input.title,
    authors: input.authors ?? [],
    copyright: null,
    ccliNumber: null,
    defaultKey: null,
    tempo: null,
    timeSignature: null,
    theme: null,
    secondaryTheme: null,
    aka: null,
    keyLine: null,
    userFields: { user1: "", user2: "", user3: "" },
    sections: [],
    arrangements: [],
    background: null,
    backgrounds: null,
    notes: null,
    revision: {
      id: ctx.ids.next() as Song["revision"]["id"],
      parentId: null,
      origin: "local",
      createdAt: now,
    },
  };
  await ctx.repos.songs.save(song);
  return { id: song.id, title: song.title, authors: song.authors, theme: null };
};

export const getSong: QueryHandler<{ id: SongId }, Song | null> = async (
  input,
  ctx,
) => ctx.repos.songs.get(input.id);

export const listSongs: QueryHandler<Record<string, never>, SongSummary[]> = async (
  _input,
  ctx,
) => ctx.repos.songs.list();

export function registerSongCommands(registry: HandlerRegistry): void {
  registry.commands.set("songs.create", createSong as CommandHandler);
  registry.queries.set("songs.get", getSong as QueryHandler);
  registry.queries.set("songs.list", listSongs as QueryHandler);
}
