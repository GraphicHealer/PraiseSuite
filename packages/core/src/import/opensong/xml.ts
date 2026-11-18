import { XMLParser } from "fast-xml-parser";

/**
 * Shared parser for OpenSong XML files. trimValues/preserveOrder settings
 * keep lyric whitespace and text content intact; parseTagValue off keeps
 * everything as strings.
 */
export function parseXml(xml: string): unknown {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: false,
    parseTagValue: false,
    processEntities: true,
  });
  return parser.parse(xml);
}

export function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

export function asString(v: unknown): string {
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : String(v);
}

/** Element text or "" — accepts element or missing value. */
export function textOf(el: unknown): string {
  return asString(asRecord(el)["#text"] ?? el);
}

export function attrOf(el: unknown, name: string): string {
  return asString(asRecord(el)[`@_${name}`]);
}
