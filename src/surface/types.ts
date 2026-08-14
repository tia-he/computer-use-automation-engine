import { LogicalLocator, LocatorResolution, ResolvedElement } from "../locator/types";

export interface Observation {
  url: string;
  title: string;
  /** Lightweight textual/structural tree — used for evidence and (later) LLM input. */
  snapshot: string;
}

/**
 * Surface-independent contract. Nothing outside a concrete Surface
 * implementation (e.g. src/surface/playwright-surface.ts) may depend on the
 * underlying automation technology.
 */
export interface Surface {
  navigate(url: string, options?: { timeoutMs?: number }): Promise<void>;
  perceive(): Promise<Observation>;
  resolve(locator: LogicalLocator): Promise<LocatorResolution>;
  click(element: ResolvedElement): Promise<void>;
  fill(element: ResolvedElement, value: string): Promise<void>;
  selectOption(element: ResolvedElement, value: string): Promise<void>;
  extractText(element: ResolvedElement): Promise<string>;
  /** Given an element already resolved/acted on, propose a reusable LogicalLocator for it. */
  describe(element: ResolvedElement): Promise<LogicalLocator>;
  screenshot(): Promise<Buffer>;
  close(): Promise<void>;
}
