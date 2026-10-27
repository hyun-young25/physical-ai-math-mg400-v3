/**
 * MG400 robot proxy routes.
 *
 * All endpoints are under /api/robot.
 * The API server maintains a single TCP connection to the robot
 * and proxies REST calls into Dashboard TCP commands.
 */
import { Router, type IRouter } from "express";
import { mg400 } from "../lib/mg400";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/* ── POST /api/robot/connect ─────────────────────────────────────────
   Body: { ip: string, port?: number }
   Establishes TCP connection to MG400 Dashboard port.           */
router.post("/robot/connect", async (req, res): Promise<void> => {
  const { ip, port } = req.body as { ip?: string; port?: number };

  if (!ip || typeof ip !== "string") {
    res.status(400).json({ error: "ip is required" });
    return;
  }

  try {
    await mg400.connect(ip, port ?? 29999);
    req.log.info({ ip, port }, "Robot connected");
    res.json({ ok: true, message: `Connected to ${ip}:${port ?? 29999}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.warn({ ip, err: msg }, "Robot connect failed");
    res.status(503).json({ ok: false, error: msg });
  }
});

/* ── POST /api/robot/disconnect ──────────────────────────────────── */
router.post("/robot/disconnect", async (req, res): Promise<void> => {
  await mg400.disconnect();
  req.log.info("Robot disconnected");
  res.json({ ok: true });
});

/* ── GET /api/robot/status ───────────────────────────────────────────
   Returns: { connected, mode, modeName }                        */
router.get("/robot/status", async (req, res): Promise<void> => {
  if (!mg400.isConnected()) {
    res.json({ connected: false, mode: null });
    return;
  }

  try {
    const mode = await mg400.getMode();
    const modeNames: Record<number, string> = {
      1: "init", 2: "brake", 4: "disabled", 5: "enabled",
      6: "backdrive", 7: "running", 8: "recording",
      9: "error", 10: "paused", 11: "jogging",
    };
    res.json({ connected: true, mode, modeName: modeNames[mode] ?? "unknown" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.warn({ err: msg }, "GetRobotMode failed");
    res.status(503).json({ connected: true, mode: null, error: msg });
  }
});

/* ── POST /api/robot/enable ─────────────────────────────────────────
   Sends EnableRobot() — required before jogging or moving.      */
router.post("/robot/enable", async (req, res): Promise<void> => {
  if (!mg400.isConnected()) {
    res.status(409).json({ error: "Not connected" });
    return;
  }
  try {
    const r = await mg400.enable();
    if (r.errorId !== 0) {
      res.status(422).json({ ok: false, errorId: r.errorId, raw: r.raw });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/* ── POST /api/robot/disable ────────────────────────────────────────
   Sends DisableRobot() — releases motors.                       */
router.post("/robot/disable", async (req, res): Promise<void> => {
  if (!mg400.isConnected()) {
    res.status(409).json({ error: "Not connected" });
    return;
  }
  try {
    const r = await mg400.disable();
    if (r.errorId !== 0) {
      res.status(422).json({ ok: false, errorId: r.errorId, raw: r.raw });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/* ── POST /api/robot/reset ──────────────────────────────────────────
   Sends ClearError() — clears alarms.                           */
router.post("/robot/reset", async (req, res): Promise<void> => {
  if (!mg400.isConnected()) {
    res.status(409).json({ error: "Not connected" });
    return;
  }
  try {
    await mg400.reset();
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/* ── POST /api/robot/speed ───────────────────────────────────────────
   Body: { ratio: number }  (1 – 100)                            */
router.post("/robot/speed", async (req, res): Promise<void> => {
  if (!mg400.isConnected()) {
    res.status(409).json({ error: "Not connected" });
    return;
  }
  const { ratio } = req.body as { ratio?: number };
  if (typeof ratio !== "number" || ratio < 1 || ratio > 100) {
    res.status(400).json({ error: "ratio must be 1–100" });
    return;
  }
  try {
    const r = await mg400.setSpeed(ratio);
    res.json({ ok: true, errorId: r.errorId });
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/* ── GET /api/robot/pose ─────────────────────────────────────────────
   Returns current joint angles AND Cartesian pose.
   { j1,j2,j3,j4, x,y,z,rx,ry,rz }                             */
router.get("/robot/pose", async (req, res): Promise<void> => {
  if (!mg400.isConnected()) {
    res.status(409).json({ error: "Not connected" });
    return;
  }
  try {
    const [angle, pose] = await Promise.all([
      mg400.getAngle(),
      mg400.getPose(),
    ]);
    res.json({ ok: true, ...angle, ...pose });
  } catch (err) {
    req.log.warn({ err: err instanceof Error ? err.message : err }, "GetPose failed");
    res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/* ── POST /api/robot/jog ─────────────────────────────────────────────
   Body: { axis: string }
   axis examples: "j1+", "j1-", "x+", "x-", "y+", "y-",
                  "z+", "z-", "rx+", "rx-"
   Starts continuous jog. Client must call /stop-jog to stop.    */
router.post("/robot/jog", async (req, res): Promise<void> => {
  if (!mg400.isConnected()) {
    res.status(409).json({ error: "Not connected" });
    return;
  }
  const { axis } = req.body as { axis?: string };
  if (!axis || typeof axis !== "string") {
    res.status(400).json({ error: "axis is required (e.g. 'j1+', 'x-')" });
    return;
  }

  const VALID = /^(j[1-4][+-]|[xyz][+-]|rx[+-])$/i;
  if (!VALID.test(axis)) {
    res.status(400).json({ error: `Invalid axis: ${axis}` });
    return;
  }

  try {
    const r = await mg400.moveJog(axis.toLowerCase());
    res.json({ ok: true, errorId: r.errorId, raw: r.raw });
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/* ── POST /api/robot/stop-jog ───────────────────────────────────────
   Sends MoveJog() with no argument — stops current jog motion.  */
router.post("/robot/stop-jog", async (req, res): Promise<void> => {
  if (!mg400.isConnected()) {
    res.status(409).json({ error: "Not connected" });
    return;
  }
  try {
    await mg400.stopJog();
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/* ── POST /api/robot/command ─────────────────────────────────────────
   Body: { cmd: string }
   Raw pass-through for any Dashboard TCP command.
   Use for debugging or commands not yet covered above.           */
router.post("/robot/command", async (req, res): Promise<void> => {
  if (!mg400.isConnected()) {
    res.status(409).json({ error: "Not connected" });
    return;
  }
  const { cmd } = req.body as { cmd?: string };
  if (!cmd || typeof cmd !== "string") {
    res.status(400).json({ error: "cmd is required" });
    return;
  }
  try {
    const r = await mg400.send(cmd);
    req.log.info({ cmd, errorId: r.errorId }, "Raw command sent");
    res.json({ ok: r.errorId === 0, errorId: r.errorId, values: r.values, raw: r.raw });
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
