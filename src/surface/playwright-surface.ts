import { Browser, Locator, Page, chromium } from "playwright";
import { LocatorStrategy, LogicalLocator, LocatorResolution, ResolvedElement } from "../locator/types";
import { resolveLogicalLocator } from "../locator/resolve";
import { Observation, Surface } from "./types";

function escapeAttributeValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

/**
 * The only module in this codebase allowed to import from "playwright".
 * Everything it exposes publicly (Surface, LogicalLocator, ResolvedElement,
 * LocatorResolution) is plain data or the opaque `ref: unknown` boundary —
 * no Playwright type ever leaks past this file.
 */
export class PlaywrightBrowserSurface implements Surface {
  private constructor(
    private readonly browser: Browser,
    private readonly page: Page
  ) {}

  static async launch(options: { headless?: boolean } = {}): Promise<PlaywrightBrowserSurface> {
    const browser = await chromium.launch({ headless: options.headless ?? true });
    const page = await browser.newPage();
    return new PlaywrightBrowserSurface(browser, page);
  }

  async navigate(url: string, options?: { timeoutMs?: number }): Promise<void> {
    await this.page.goto(url, {
      waitUntil: "load",
      ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    });
  }

  async perceive(): Promise<Observation> {
    return {
      url: this.page.url(),
      title: await this.page.title(),
      snapshot: await this.computeSnapshot(),
    };
  }

  async resolve(locator: LogicalLocator): Promise<LocatorResolution> {
    return resolveLogicalLocator<Locator>(locator, (strategy) => this.matchStrategy(strategy));
  }

  async click(element: ResolvedElement): Promise<void> {
    await this.asLocator(element).click();
  }

  async fill(element: ResolvedElement, value: string): Promise<void> {
    await this.asLocator(element).fill(value);
  }

  async selectOption(element: ResolvedElement, value: string): Promise<void> {
    await this.asLocator(element).selectOption(value);
  }

  async extractText(element: ResolvedElement): Promise<string> {
    return (await this.asLocator(element).innerText()).trim();
  }

  async screenshot(): Promise<Buffer> {
    return this.page.screenshot();
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  private asLocator(element: ResolvedElement): Locator {
    return element.ref as Locator;
  }

  // ---- locator resolution --------------------------------------------------

  private async matchStrategy(strategy: LocatorStrategy): Promise<{ count: number; uniqueRef?: Locator }> {
    const locator = await this.locatorFor(strategy);
    if (!locator) return { count: 0 };
    const count = await locator.count();
    if (count === 1) return { count, uniqueRef: locator.first() };
    return { count };
  }

  private async locatorFor(strategy: LocatorStrategy): Promise<Locator | null> {
    switch (strategy.kind) {
      case "role":
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Playwright's AriaRole
        // union is intentionally not exposed outside this file; LogicalLocator keeps `role` as
        // a plain string so the type stays surface-independent.
        return this.page.getByRole(strategy.role as any, { name: strategy.name, exact: true });
      case "label":
        return this.page.getByLabel(strategy.text, { exact: true });
      case "text":
        return this.page.getByText(strategy.text, { exact: strategy.exact ?? true });
      case "attribute":
        return this.page.locator(`[${strategy.attribute}="${escapeAttributeValue(strategy.value)}"]`);
      case "css": {
        if (!strategy.scope) {
          return this.page.locator(strategy.selector);
        }
        const scopeMatch = await this.matchStrategy(strategy.scope);
        if (scopeMatch.count !== 1 || !scopeMatch.uniqueRef) return null;
        return scopeMatch.uniqueRef.locator(strategy.selector);
      }
    }
  }

  // ---- describe() ------------------------------------------------------------

  async describe(element: ResolvedElement): Promise<LogicalLocator> {
    const locator = this.asLocator(element);
    const strategies: LocatorStrategy[] = [];

    const info = await locator.evaluate((el: Element) => {
      function stableAttrOf(node: Element): { attribute: string; value: string } | null {
        const name = node.getAttribute("name");
        if (name) return { attribute: "name", value: name };
        for (const attr of Array.from(node.attributes)) {
          if (attr.name.startsWith("data-")) return { attribute: attr.name, value: attr.value };
        }
        const id = node.id;
        if (id && !/^[a-f0-9-]{8,}$/i.test(id)) return { attribute: "id", value: id };
        return null;
      }

      const roleMap: Record<string, string> = {
        a: "link",
        h1: "heading",
        h2: "heading",
        h3: "heading",
        h4: "heading",
        h5: "heading",
        h6: "heading",
        table: "table",
        tr: "row",
        td: "cell",
        th: "cell",
        select: "combobox",
        textarea: "textbox",
        button: "button",
        form: "form",
      };

      const tag = el.tagName.toLowerCase();
      const type = (el as HTMLInputElement).type?.toLowerCase();
      let role: string | null = null;
      if (tag === "input") {
        if (type === "submit" || type === "button") role = "button";
        else if (type === "hidden") role = null;
        else role = "textbox";
      } else if (tag === "a" && el.hasAttribute("href")) {
        role = "link";
      } else {
        role = roleMap[tag] ?? null;
      }

      const labels = (el as HTMLInputElement).labels;
      const label = labels && labels.length > 0 ? (labels[0].textContent ?? "").trim() : null;

      let name = "";
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) {
        name = ariaLabel.trim();
      } else if (label) {
        name = label;
      } else if (tag === "input" && (type === "submit" || type === "button")) {
        name = (el.getAttribute("value") ?? "").trim();
      } else if (role === "link" || role === "button" || role === "heading") {
        name = (el.textContent ?? "").trim().replace(/\s+/g, " ");
      }

      const attr = stableAttrOf(el);
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
      const distinctiveText = text.length > 0 && text.length <= 60 ? text : null;

      return { role, name: name || null, label, attr, distinctiveText };
    });

    if (info.role && info.name) {
      strategies.push({ kind: "role", role: info.role, name: info.name });
    }
    if (info.label) {
      strategies.push({ kind: "label", text: info.label });
    }
    if (info.attr) {
      strategies.push({ kind: "attribute", attribute: info.attr.attribute, value: info.attr.value });
    }
    if (info.distinctiveText) {
      strategies.push({ kind: "text", text: info.distinctiveText, exact: true });
    }

    const scoped = await locator.evaluate((el: Element) => {
      function stableAttrOf(
        node: Element
      ): { kind: "attribute"; attribute: string; value: string } | null {
        const name = node.getAttribute("name");
        if (name) return { kind: "attribute", attribute: "name", value: name };
        for (const attr of Array.from(node.attributes)) {
          if (attr.name.startsWith("data-")) {
            return { kind: "attribute", attribute: attr.name, value: attr.value };
          }
        }
        const id = node.id;
        if (id && !/^[a-f0-9-]{8,}$/i.test(id)) return { kind: "attribute", attribute: "id", value: id };
        return null;
      }
      function nthOfType(node: Element): number {
        let i = 1;
        let sib = node.previousElementSibling;
        while (sib) {
          if (sib.tagName === node.tagName) i++;
          sib = sib.previousElementSibling;
        }
        return i;
      }
      function segment(node: Element): string {
        return `${node.tagName.toLowerCase()}:nth-of-type(${nthOfType(node)})`;
      }

      const path: string[] = [];
      let node: Element = el;
      let anchor:
        | { kind: "attribute"; attribute: string; value: string }
        | { kind: "css"; selector: string }
        | null = null;
      let depth = 0;

      // Walk up, never past <body>, collecting a relative nth-of-type chain
      // until we find an ancestor with a stable attribute or a table/form
      // landmark to scope against.
      while (depth < 8) {
        const parent = node.parentElement;
        if (!parent || parent === document.body) break;
        const attr = stableAttrOf(parent);
        if (attr) {
          path.unshift(segment(node));
          anchor = attr;
          break;
        }
        if (parent.tagName === "TABLE" || parent.tagName === "FORM") {
          path.unshift(segment(node));
          anchor = { kind: "css", selector: parent.tagName.toLowerCase() };
          break;
        }
        path.unshift(segment(node));
        node = parent;
        depth++;
      }

      if (!anchor) return null;
      return { scope: anchor, selector: path.join(" > ") };
    });

    if (scoped) {
      strategies.push({ kind: "css", selector: scoped.selector, scope: scoped.scope as LocatorStrategy });
    }

    return { strategies };
  }

  // ---- evidence / observation --------------------------------------------

  private async computeSnapshot(): Promise<string> {
    return this.page.evaluate(() => {
      const roleMap: Record<string, string> = {
        a: "link",
        h1: "heading",
        h2: "heading",
        h3: "heading",
        h4: "heading",
        h5: "heading",
        h6: "heading",
        table: "table",
        tr: "row",
        td: "cell",
        th: "cell",
        select: "combobox",
        textarea: "textbox",
        button: "button",
        form: "form",
      };

      function nodeInfo(el: Element): { role: string | null; name: string } {
        const tag = el.tagName.toLowerCase();
        const type = (el as HTMLInputElement).type?.toLowerCase();
        let role: string | null = null;
        if (tag === "input") {
          if (type === "submit" || type === "button") role = "button";
          else if (type === "hidden") role = null;
          else role = "textbox";
        } else if (tag === "a" && el.hasAttribute("href")) {
          role = "link";
        } else {
          role = roleMap[tag] ?? null;
        }

        let name = "";
        const ariaLabel = el.getAttribute("aria-label");
        const labels = (el as HTMLInputElement).labels;
        if (ariaLabel) {
          name = ariaLabel.trim();
        } else if (labels && labels.length > 0) {
          name = (labels[0].textContent ?? "").trim();
        } else if (tag === "input" && (type === "submit" || type === "button")) {
          name = (el.getAttribute("value") ?? "").trim();
        } else if (role === "link" || role === "button" || role === "heading") {
          name = (el.textContent ?? "").trim().replace(/\s+/g, " ");
        }
        return { role, name };
      }

      const lines: string[] = [];

      function walk(el: Element, depth: number) {
        if (lines.length > 300) return;
        const info = nodeInfo(el);
        const directText = Array.from(el.childNodes)
          .filter((n) => n.nodeType === 3)
          .map((n) => (n.textContent ?? "").trim())
          .filter(Boolean)
          .join(" ");

        let nextDepth = depth;
        if (info.role) {
          lines.push("  ".repeat(depth) + info.role + (info.name ? ` "${info.name}"` : ""));
          nextDepth = depth + 1;
        } else if (directText) {
          lines.push("  ".repeat(depth) + `text "${directText}"`);
          nextDepth = depth + 1;
        }

        for (const child of Array.from(el.children)) {
          walk(child, nextDepth);
        }
      }

      walk(document.body, 0);
      return lines.join("\n");
    });
  }
}
