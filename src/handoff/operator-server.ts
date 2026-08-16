import http from "node:http";
import { HandoffSession } from "./session";

/**
 * Minimal local control endpoint — explicitly not a co-browsing dashboard.
 * A human (or a CLI wrapping curl) inspects and resolves the pending
 * intervention over plain JSON:
 *   GET  /pending          -> [] | [InterventionRequest]
 *   POST /approve/:id      -> ReplayResult (JSON)
 *   POST /reject/:id       -> ReplayResult (JSON)
 * Runs in the same process as the live Surface/HandoffSession, since the
 * live browser session can't be handed to a separate process without a
 * remote-debugging transport this phase deliberately doesn't build.
 */
export function createOperatorServer(session: HandoffSession): http.Server {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/pending") {
        const pending = session.pendingIntervention;
        respond(res, 200, pending ? [pending] : []);
        return;
      }

      const approveMatch = req.url?.match(/^\/approve\/([^/]+)$/);
      if (req.method === "POST" && approveMatch) {
        const result = await session.approve(approveMatch[1]);
        respond(res, 200, result);
        return;
      }

      const rejectMatch = req.url?.match(/^\/reject\/([^/]+)$/);
      if (req.method === "POST" && rejectMatch) {
        const result = await session.reject(rejectMatch[1]);
        respond(res, 200, result);
        return;
      }

      respond(res, 404, { error: "not found" });
    } catch (err) {
      respond(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}

function respond(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}
