declare const brand: unique symbol;

/** Branded string ID — prevents mixing entity ID types at compile time. */
export type Brand<T extends string, B extends string> = T & {
  readonly [brand]: B;
};

export type SongId = Brand<string, "SongId">;
export type SongSectionId = Brand<string, "SongSectionId">;
export type ArrangementId = Brand<string, "ArrangementId">;
export type ArrangementSectionId = Brand<string, "ArrangementSectionId">;
export type ServiceId = Brand<string, "ServiceId">;
export type ServiceItemId = Brand<string, "ServiceItemId">;
export type SessionId = Brand<string, "SessionId">;
export type OutputId = Brand<string, "OutputId">;
export type DeviceId = Brand<string, "DeviceId">;
export type MediaAssetId = Brand<string, "MediaAssetId">;
export type UserId = Brand<string, "UserId">;
export type OrganizationId = Brand<string, "OrganizationId">;
export type RevisionId = Brand<string, "RevisionId">;
