declare module "pagedjs" {
  /** Minimal typing for the parts of paged.js we use. */
  export interface PreviewFlow {
    total: number;
    pages: unknown[];
    overflow: unknown[];
  }

  export class Previewer {
    constructor(options?: Record<string, unknown>);
    preview(
      content: HTMLElement | HTMLElement[] | DocumentFragment | string,
      stylesheets?: (string | CSSStyleSheet | HTMLStyleElement | Record<string, string>)[],
      renderTo?: HTMLElement | DocumentFragment,
    ): Promise<PreviewFlow>;
    on(event: string, callback: (...args: unknown[]) => void): void;
    removeStyles(doc?: Document): void;
  }
}
