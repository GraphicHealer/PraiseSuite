import type { Service, ServiceItem } from "../../domain/services/types.js";
import type { TextStyle } from "../../domain/styles/types.js";
import { esc, printPage, roleCss } from "./layout.js";

function itemDetail(item: ServiceItem): string {
  if (item.kind === "scripture") {
    const ref = item.config["reference"];
    return typeof ref === "string" ? ref : "";
  }
  if (item.subtitle) return item.subtitle;
  return "";
}

/** Service -> printable set list (item order, kind, detail). */
export function setListHtml(service: Service, roles: Record<string, TextStyle> = {}): string {
  const parts: string[] = [];
  parts.push(`<h1 style="${roleCss(roles["title"])};margin-bottom:2pt">${esc(service.name)}</h1>`);
  if (service.date) parts.push(`<div style="${roleCss(roles["author"])};color:#666">${esc(service.date)}</div>`);
  if (service.description) parts.push(`<div style="${roleCss(roles["author"])};color:#666">${esc(service.description)}</div>`);
  parts.push(`<table style="margin-top:10pt;border-collapse:collapse;font-family:sans-serif;font-size:11pt">`);
  // OpenSong SetListReport: @print=false items and "--"-prefixed names are skipped.
  const printable = service.items.filter(
    (item) => item.config["print"] !== "false" && !item.title.startsWith("--"),
  );
  printable.forEach((item, i) => {
    const detail = itemDetail(item);
    parts.push(
      `<tr>` +
        `<td style="padding:3pt 10pt 3pt 0;color:#888;vertical-align:top">${i + 1}.</td>` +
        `<td style="padding:3pt 10pt 3pt 0;${roleCss(roles["lyrics"])}">${esc(item.title)}</td>` +
        `<td style="padding:3pt 10pt 3pt 0;color:#888;font-size:9pt">${esc(item.kind)}</td>` +
        `<td style="padding:3pt 0;color:#666;font-size:9pt">${esc(detail)}</td>` +
      `</tr>`,
    );
  });
  parts.push(`</table>`);
  return printPage(`${service.name} — set list`, parts.join("\n"));
}
