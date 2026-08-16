import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_DIR = path.join(REPO_ROOT, "evidence", "interventions");

/** Returns a path relative to the repo root for storage in InterventionRequest.screenshotRef. */
export async function saveInterventionScreenshot(interventionId: string, screenshot: Buffer): Promise<string> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const filePath = path.join(EVIDENCE_DIR, `${interventionId}.png`);
  await writeFile(filePath, screenshot);
  return path.relative(REPO_ROOT, filePath);
}
