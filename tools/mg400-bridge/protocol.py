"""Validated commands, one owner, one in-flight operation, feedback-only completion."""
import asyncio
import copy
import math
import time

AXES = ("x", "y", "z", "r")
JOINT_LIMITS = {"j1": (-160, 160), "j2": (-25, 85), "j3": (-25, 105), "j4": (-180, 180)}
# J4 intentionally uses the narrower range shared by older MG400 revisions.
FLAGS = ("firmware", "network", "coordinates", "tool", "io", "workspace")


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def channel(value, optional=False):
    return optional and value is None or type(value) is int and 1 <= value <= 16


def validate_setup(setup):
    if not isinstance(setup, dict) or not isinstance(setup.get("verified"), dict) or set(setup["verified"]) != set(FLAGS):
        raise ValueError("All six preparation confirmations are required")
    if not all(setup["verified"][flag] is True for flag in FLAGS):
        raise ValueError("Confirm firmware/network/coordinates/tool/IO/workspace before preparing")
    if not all(type(setup.get(k)) is int and 0 <= setup[k] <= 9 for k in ("user", "tool")):
        raise ValueError("User/Tool must be 0..9")
    if not channel(setup.get("suctionDO")) or not channel(setup.get("releaseDO"), True) or not channel(setup.get("vacuumDI"), True):
        raise ValueError("IO channel must be 1..16")
    if setup["suctionDO"] == setup.get("releaseDO") or type(setup.get("activeHigh")) is not bool:
        raise ValueError("Check opposite output channels and polarity")
    if not number(setup.get("speed")) or not 1 <= setup["speed"] <= 20:
        raise ValueError("Only verified low speed 1..20% is supported")
    if not all(number(setup.get(k)) and 0 < setup[k] <= 5 for k in ("positionTolerance", "rotationTolerance")):
        raise ValueError("Tolerances must be >0 and <=5")
    workspace = setup.get("workspace", {})
    if not all(number(workspace.get(k + "Min")) and number(workspace.get(k + "Max"))
               and workspace[k + "Min"] < workspace[k + "Max"] for k in AXES):
        raise ValueError("Invalid verified workspace")
    return copy.deepcopy(setup)


def validate_operation(operation, setup):
    if not isinstance(operation, dict):
        raise ValueError("Invalid operation")
    kind = operation.get("kind")
    if kind == "move":
        if operation.get("relative"):
            raise ValueError("Bridge requires absolute targets resolved from fresh measured coordinates")
        if operation.get("motion") not in ("MoveJ", "MoveL"):
            raise ValueError("Only Cartesian MoveJ/MoveL are supported")
        pose = operation.get("target", {})
        if not all(number(pose.get(k)) and setup["workspace"][k + "Min"] <= pose[k]
                   <= setup["workspace"][k + "Max"] for k in AXES):
            raise ValueError("Target outside verified workspace or invalid number")
    elif kind == "jointStep":
        if operation.get("joint") not in JOINT_LIMITS or not number(operation.get("delta")) or not 0 < abs(operation["delta"]) <= 10:
            raise ValueError("Joint step requires one J1-J4 axis and a nonzero step up to 10 degrees")
    elif kind == "suction":
        if type(operation.get("on")) is not bool:
            raise ValueError("Vacuum on must be a boolean")
    elif kind not in ("enable", "disable"):
        raise ValueError("Unsupported command; direct raw SDK commands and joint moves are blocked")


def angular_error(a, b):
    return abs((a - b + 180) % 360 - 180)


def completed(operation, measurement, setup):
    if measurement["moving"]:
        return False
    kind = operation["kind"]
    if kind == "move":
        p, target = measurement["pose"], operation["target"]
        return math.dist([p[k] for k in AXES[:3]], [target[k] for k in AXES[:3]]) <= setup["positionTolerance"] \
            and angular_error(p["r"], target["r"]) <= setup["rotationTolerance"]
    if kind == "jointStep":
        return all(abs(measurement["joints"][k] - operation["target"][k]) <= .2 for k in JOINT_LIMITS)
    if kind in ("enable", "disable"):
        return measurement["enabled"] == (kind == "enable")
    expected = operation["on"] == setup["activeHigh"]
    outputs = int(measurement["outputBits"])
    ok = bool(outputs & (1 << (setup["suctionDO"] - 1))) == expected
    if setup["releaseDO"] is not None:
        ok = ok and bool(outputs & (1 << (setup["releaseDO"] - 1))) != expected
    if setup["vacuumDI"] is not None:
        ok = ok and bool(int(measurement["inputBits"]) & (1 << (setup["vacuumDI"] - 1))) == operation["on"]
    return ok


class BridgeController:
    def __init__(self, robot):
        self.robot = robot
        self.setup = None
        self.connected = False
        self.busy = False
        self.generation = 0
        self.last_sent_sequence = 0
        self.measurement_lock = asyncio.Lock()

    def measured(self, require_enabled=False):
        if not self.connected:
            raise ConnectionError("Connect before executing")
        m = self.robot.measurement()
        if not m or m["ageMs"] > 1500:
            raise RuntimeError("No fresh robot feedback; execution is blocked")
        if m["error"] or m["robotMode"] not in (4, 5, 7):
            raise RuntimeError("Robot error or unsafe mode; operator intervention required")
        if require_enabled and not m["enabled"]:
            raise RuntimeError("Enable robot explicitly before movement/vacuum")
        return m

    async def send_measurement(self, send):
        m = self.robot.measurement()
        await self.publish_measurement(m, send)
        return m

    async def publish_measurement(self, measurement, send):
        # Publisher and completion replies share this gate: never replay an
        # older/duplicate sequence after a more recent background measurement.
        async with self.measurement_lock:
            if measurement and measurement["seq"] > self.last_sent_sequence:
                self.last_sent_sequence = measurement["seq"]
                await send({"type": "measurement", "measurement": measurement})

    async def handle(self, request, send):
        request_id = request.get("id")
        if not isinstance(request_id, str) or not request_id or len(request_id) > 100:
            return
        try:
            kind = request.get("type")
            if kind == "connect":
                if self.busy or self.connected:
                    raise RuntimeError("Disconnect before changing robot target")
                await asyncio.to_thread(self.robot.connect, request.get("robotIp", ""))
                self.connected = True
                self.setup = None
                self.last_sent_sequence = 0
                await send({"type": "hello", "protocol": 2, "source": self.robot.source, "model": "MG400", "capabilities": {"jointStep": True}})
                deadline = time.monotonic() + 3
                while not self.robot.measurement() and time.monotonic() < deadline:
                    await asyncio.sleep(.05)
                await self.send_measurement(send)
                if not self.robot.measurement():
                    raise RuntimeError("No valid feedback packet; check version and feedback port")
                await send({"type": "reply", "id": request_id, "ok": True, "result": {}})
            elif kind == "configure":
                if self.busy or self.measured()["moving"] or self.measured()["robotMode"] not in (4, 5):
                    raise RuntimeError("Configure only while robot is stopped")
                setup = validate_setup(request.get("setup"))
                self.setup = None
                self.busy = True
                generation = self.generation
                try:
                    await asyncio.to_thread(self.robot.configure, setup)
                    deadline = time.monotonic() + 3
                    while time.monotonic() < deadline:
                        m = self.measured()
                        if generation != self.generation or m["moving"] or m["robotMode"] not in (4, 5):
                            raise RuntimeError("Connection/stop state changed during configuration")
                        if m["user"] == setup["user"] and m["tool"] == setup["tool"]:
                            break
                        await asyncio.sleep(.05)
                    else:
                        raise RuntimeError("Selected User/Tool not confirmed by feedback")
                    self.setup = setup
                    await self.send_measurement(send)
                    await send({"type": "reply", "id": request_id, "ok": True, "result": {"appliedSpeed": setup["speed"]}})
                finally:
                    self.busy = False
            elif kind == "execute":
                if request.get("confirmed") is not True or self.busy or not self.setup:
                    raise RuntimeError("Explicit confirmation and verified setup required; another command may be active")
                setup = self.setup
                if "expectedSpeed" in request and request["expectedSpeed"] != setup["speed"]:
                    raise RuntimeError("Confirmed speed differs from applied setup; confirm again")
                operation = request.get("operation")
                validate_operation(operation, setup)
                before = self.measured(operation["kind"] not in ("enable", "disable"))
                if before["moving"] or before["user"] != setup["user"] or before["tool"] != setup["tool"]:
                    raise RuntimeError("Stopped robot with matching User/Tool is required")
                if not all(setup["workspace"][k + "Min"] <= before["pose"][k] <= setup["workspace"][k + "Max"] for k in AXES):
                    raise RuntimeError("Current robot position outside verified workspace")
                if operation["kind"] == "jointStep":
                    # Derive the absolute target on the robot-side PC. Ignore any client-supplied target.
                    target = dict(before["joints"])
                    target[operation["joint"]] += operation["delta"]
                    if not all(lo <= target[k] <= hi for k, (lo, hi) in JOINT_LIMITS.items()):
                        raise ValueError("Joint target outside MG400 limits (J4 restricted to +/-180 degrees)")
                    operation = {"kind": "jointStep", "joint": operation["joint"], "delta": operation["delta"], "target": target}
                generation = self.generation
                self.busy = True
                previous_seq = before["seq"]
                stable = 0
                try:
                    if operation["kind"] == "jointStep":
                        await asyncio.to_thread(self.robot.check_joint_path, before["joints"], operation["target"], setup)
                        current = self.measured(True)
                        if generation != self.generation or current["moving"] or current["user"] != setup["user"] or current["tool"] != setup["tool"] or any(
                            abs(current["joints"][k] - before["joints"][k]) > .05 for k in JOINT_LIMITS):
                            raise RuntimeError("Robot moved or setup changed during joint preflight; retry from stopped position")
                    await asyncio.to_thread(self.robot.command, operation, setup)
                    deadline = time.monotonic() + 30
                    while time.monotonic() < deadline:
                        if generation != self.generation:
                            raise RuntimeError("Execution was cancelled")
                        await asyncio.sleep(.05)
                        m = self.measured(operation["kind"] not in ("enable", "disable"))
                        if m["user"] != setup["user"] or m["tool"] != setup["tool"]:
                            raise RuntimeError("Coordinate/tool context changed during execution")
                        if operation["kind"] in ("move", "jointStep") and not all(
                            setup["workspace"][k + "Min"] <= m["pose"][k] <= setup["workspace"][k + "Max"] for k in AXES):
                            raise RuntimeError("Measured path left the verified workspace")
                        if m["seq"] <= previous_seq:
                            continue
                        previous_seq = m["seq"]
                        stable = stable + 1 if completed(operation, m, setup) else 0
                        if stable >= 3:
                            # The exact confirmed sample must precede its reply.
                            await self.publish_measurement(m, send)
                            await send({"type": "reply", "id": request_id, "ok": True, "result": {"seq": m["seq"]}})
                            return
                    raise TimeoutError("Fresh measured target/IO completion timeout")
                except Exception:
                    self.setup = None
                    try:
                        await asyncio.to_thread(self.robot.stop)
                    except Exception:
                        pass  # Failure still surfaces; never fabricate stop/success.
                    raise
                finally:
                    self.busy = False
            elif kind == "stop":
                self.generation += 1
                self.setup = None
                await asyncio.to_thread(self.robot.stop)
                await send({"type": "reply", "id": request_id, "ok": True, "result": {"requested": True, "physicalEmergencyStop": False}})
            else:
                raise ValueError("Unsupported protocol v2 request")
        except Exception as error:
            await send({"type": "reply", "id": request_id, "ok": False, "error": str(error)})

    async def close(self):
        self.generation += 1
        if self.busy:
            try:
                await asyncio.to_thread(self.robot.stop)
            except Exception:
                pass
        self.setup = None
        self.connected = False
        await asyncio.to_thread(self.robot.close)

