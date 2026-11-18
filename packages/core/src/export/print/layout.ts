import type { TextStyle } from "../../domain/styles/types.js";

/** TextStyle -> CSS declaration string for print roles (PrintSettings). */
export function roleCss(s: TextStyle | undefined): string {
  if (!s) return "";
  const parts = [
    `font-family:'${s.font}',sans-serif`,
    `font-size:${s.size}pt`,
    `color:${s.color}`,
  ];
  if (s.bold) parts.push("font-weight:bold");
  if (s.italic) parts.push("font-style:italic");
  if (s.underline) parts.push("text-decoration:underline");
  if (s.align !== "left") parts.push(`text-align:${s.align}`);
  return parts.join(";");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Wrap role body fragments in a minimal print document. */
export function printPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { margin: 2cm; }
  body { margin:0; }
  .ps-sec { margin-top: 10pt; }
  .ps-line { white-space: pre; }
  @media print { .no-print { display: none; } }
</style></head><body>
<div class="no-print" style="padding:6pt 0;border-bottom:1px solid #ccc;margin-bottom:8pt;font-family:sans-serif;font-size:9pt;color:#666">
  PraiseSuite print preview — use your browser's Print (Ctrl+P) to save as PDF.
</div>
${body}
</body></html>`;
}

export { esc };
