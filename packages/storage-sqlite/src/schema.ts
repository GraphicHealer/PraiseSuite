import { integer, sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * Entities are stored as canonical JSON (the deeply nested domain model:
 * sections -> lines -> chords, arrangements, slides). Scalar columns exist
 * for listing, sorting, and FTS indexing. The same schema definition is the
 * basis for the PostgreSQL dialect used by the server deployment.
 */
export const songs = sqliteTable("songs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  authors: text("authors").notNull(), // JSON string[]
  theme: text("theme"),
  secondaryTheme: text("secondary_theme"),
  ccliNumber: text("ccli_number"),
  defaultKey: text("default_key"),
  folder: text("folder"),
  revisionId: text("revision_id").notNull(),
  revisionParentId: text("revision_parent_id"),
  data: text("data").notNull(), // full Song JSON
});

export const services = sqliteTable("services", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  date: text("date"),
  description: text("description"),
  revisionId: text("revision_id").notNull(),
  revisionParentId: text("revision_parent_id"),
  data: text("data").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  serviceId: text("service_id"),
  name: text("name").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  lastActivityAt: text("last_activity_at").notNull(),
  data: text("data").notNull(),
});

export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),
  mediaType: text("media_type").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  originalFilename: text("original_filename"),
  size: integer("size").notNull(),
  checksum: text("checksum").notNull(),
});

/**
 * Per-object revision history — the sync layer's merge material (TAS 10.3).
 * Every save appends one row keyed by (objectType, objectId, revisionId).
 */
export const revisions = sqliteTable(
  "revisions",
  {
    objectType: text("object_type").notNull(),
    objectId: text("object_id").notNull(),
    revisionId: text("revision_id").notNull(),
    parentId: text("parent_id"),
    origin: text("origin").notNull(),
    createdAt: text("created_at").notNull(),
    snapshot: text("snapshot").notNull(),
  },
  (t) => [primaryKey({ columns: [t.objectType, t.objectId, t.revisionId] })],
);
