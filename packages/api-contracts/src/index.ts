import { z } from "zod";

/** Wire-format API version (TAS 12.5). Bump on breaking changes. */
export const API_VERSION = 1;

export const SongSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  theme: z.string().nullable(),
});
export type SongSummaryContract = z.infer<typeof SongSummarySchema>;

export const CreateSongInputSchema = z.object({
  title: z.string().min(1),
  authors: z.array(z.string()).optional(),
});
export type CreateSongInputContract = z.infer<typeof CreateSongInputSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  apiVersion: z.number(),
  appVersion: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Generic error envelope returned by every endpoint. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
