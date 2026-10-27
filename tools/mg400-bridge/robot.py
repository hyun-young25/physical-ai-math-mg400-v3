"""MG400 1440-byte feedback + ASCII commands. Standard-library only.

Schema/commands: Dobot-Arm/TCP-IP-4Axis-Python dobot_api.py (MIT).
MG400/M1Pro controller >= V1.5.6.0; not the incompatible six-axis/V4 SDK.
No physical connection is opened until an explicit connect request.
"""
import ipaddress
import math
import re
import socket
import struct
import threading
import time


def decode_feedback(data):
    if len(data) != 1440 or struct.unpack_from("<h", data)[0] != 1440:
        raise ValueError("Unsupported feedback size; expected MG400 1440-byte protocol")
    if struct.unpack_from("<Q", data, 48)[0] != 0x123456789ABCDEF:
        raise ValueError("Feedback magic mismatch; check model/controller/SDK version")
    if data[1031] != 1:
        raise ValueError("Controller feedback does not identify an MG400; other models are blocked")
    if data[1012] > 9 or data[1013] > 9 or any(data[i] not in (0, 1) for i in (1026, 1028, 1029, 1030)):
        raise ValueError("Unsupported coordinate/flag encoding")
    q = struct.unpack_from("<6d", data, 432)
    p = struct.unpack_from("<6d", data, 624)
    if not all(math.isfinite(n) for n in (*q[:4], *p[:4])):
        raise ValueError("Non-finite robot measurement")
    mode = struct.unpack_from("<Q", data, 24)[0]
    if mode not in (1, 4, 5, 6, 7, 9, 10, 11):
        raise ValueError("Unsupported robot state")
    return {
        "pose": dict(zip(("x", "y", "z", "r"), p[:4])),
        "joints": dict(zip(("j1", "j2", "j3", "j4"), q[:4])),
        "inputBits": str(struct.unpack_from("<Q", data, 8)[0]),
        "outputBits": str(struct.unpack_from("<Q", data, 16)[0]),
        "robotMode": mode, "enabled": bool(data[1026]),
        "moving": mode in (7, 11) or bool(data[1028]) or bool(data[1030]),
        "error": bool(data[1029]) or mode == 9,
        "user": data[1012], "tool": data[1013],
        "controllerTimer": struct.unpack_from("<Q", data, 32)[0],
    }


class CommandChannel:
    def __init__(self, ip, port, factory=socket.create_connection):
        self.socket = factory((ip, port), timeout=3)
        self.socket.settimeout(3)
        self.lock = threading.Lock()
        self.buffer = b""

    def send(self, command):
        with self.lock:
            self.socket.sendall(command.encode("ascii"))
            while b";" not in self.buffer:
                part = self.socket.recv(4096)
                if not part:
                    raise ConnectionError("Controller closed command channel")
                self.buffer += part
                if len(self.buffer) > 32768:
                    raise ValueError("Oversized controller reply")
            response, self.buffer = self.buffer.split(b";", 1)
            response = response.decode("ascii").strip()
            # Never treat a nonzero manufacturer return code as success.
            code, separator, _ = response.partition(",")
            if not separator or not code.lstrip("-").isdigit() or int(code) != 0:
                raise RuntimeError("Controller rejected command: " + response)
            return response

    def close(self):
        self.socket.close()


class RealRobot:
    source = "hardware"

    def __init__(self, allow_hardware=False):
        self.allowed = allow_hardware
        self.dashboard = self.motion = self.feedback = None
        self.latest = None
        self.failure = None
        self.sequence = 0
        self.received = 0
        self.sample_age = 0
        self.closed = threading.Event()
        self.data_lock = threading.Lock()
        self.generation = 0

    def connect(self, ip):
        if not self.allowed:
            raise PermissionError("Hardware is disabled. Use --allow-hardware only on the robot-side PC.")
        address = ipaddress.IPv4Address(ip)
        if address.is_multicast or address.is_unspecified or address.is_loopback:
            raise ValueError("Use the robot controller's verified LAN IPv4 address")
        self.close()
        self.closed = threading.Event()
        generation = self.generation
        self.latest, self.failure, self.sequence = None, None, 0
        try:
            self.dashboard = CommandChannel(ip, 29999)
            self.motion = CommandChannel(ip, 30003)
            self.feedback = socket.create_connection((ip, 30004), timeout=3)
            self.feedback.settimeout(2)
            if generation != self.generation:
                raise ConnectionError("Connection cancelled")
            threading.Thread(target=self._feedback_loop, args=(self.feedback, self.closed, generation), daemon=True).start()
        except Exception:
            self.close()
            raise
        # Opening sockets sends no EnableRobot/DO/move/reset command.

    def _feedback_loop(self, feedback, closed, generation):
        buffer = b""
        last_timer = None
        baseline_timer = baseline_receive = None
        try:
            while not closed.is_set():
                part = feedback.recv(1440 - len(buffer))
                if not part:
                    raise ConnectionError("Feedback connection closed")
                buffer += part
                if len(buffer) != 1440:
                    continue
                measurement = decode_feedback(buffer)
                buffer = b""
                timer = measurement.pop("controllerTimer")
                if timer == last_timer:
                    continue  # Repeated device samples cannot refresh freshness.
                if last_timer is not None and timer < last_timer:
                    raise ValueError("Controller feedback timer reset; reconnect and verify setup")
                last_timer = timer
                now = time.monotonic()
                if baseline_timer is None:
                    baseline_timer, baseline_receive = timer, now
                sample_age = max(0, (now - baseline_receive) * 1000 - (timer - baseline_timer))
                with self.data_lock:
                    if closed.is_set() or generation != self.generation:
                        return
                    self.sequence += 1
                    measurement.update(source=self.source, seq=self.sequence, measuredAt=timer)
                    self.latest = measurement
                    self.received = now
                    self.sample_age = sample_age
        except Exception as error:
            with self.data_lock:
                if not closed.is_set() and generation == self.generation:
                    self.failure = str(error)
                    self.latest = None

    def measurement(self):
        with self.data_lock:
            if self.failure:
                raise ConnectionError(self.failure)
            if not self.latest:
                return None
            return {**self.latest, "ageMs": self.sample_age + max(0, (time.monotonic() - self.received) * 1000)}

    def configure(self, setup):
        self.dashboard.send(f"User({setup['user']})")
        self.dashboard.send(f"Tool({setup['tool']})")
        self.dashboard.send(f"SpeedFactor({setup['speed']:g})")

    def check_joint_path(self, start, target, setup):
        # Controller FK respects the configured User/Tool; do not use the teaching FK.
        # Sample the bounded, single-axis path at <=1 degree before any motor command.
        count = max(1, math.ceil(max(abs(target[k] - start[k]) for k in start)))
        for i in range(count + 1):
            q = {k: start[k] + (target[k] - start[k]) * i / count for k in start}
            values = ",".join(f"{q[k]:.6f}" for k in ("j1", "j2", "j3", "j4"))
            response = self.dashboard.send(f"PositiveSolution({values},{setup['user']},{setup['tool']})")
            match = re.match(r"^0,\s*\{([^{}]*)\}", response)
            if not match:
                raise ValueError("Unsupported PositiveSolution reply; no joint motion sent")
            try:
                pose = [float(v.strip()) for v in match.group(1).split(",")]
            except ValueError as error:
                raise ValueError("Invalid controller FK reply; no joint motion sent") from error
            if len(pose) != 4 or not all(math.isfinite(v) for v in pose):
                raise ValueError("Expected four-axis controller FK; no joint motion sent")
            if not all(setup["workspace"][k + "Min"] <= v <= setup["workspace"][k + "Max"] for k, v in zip(("x", "y", "z", "r"), pose)):
                detail = "; ".join(f"{k.upper()}={v!r} [{setup['workspace'][k+'Min']}, {setup['workspace'][k+'Max']}]"
                                   for k, v in zip(("x", "y", "z", "r"), pose)
                                   if not setup["workspace"][k+"Min"] <= v <= setup["workspace"][k+"Max"])
                raise ValueError(f"Joint path outside verified TCP workspace at sample {i}/{count}: {detail}; no joint motion sent")

    def command(self, operation, setup):
        kind = operation["kind"]
        if kind in ("move", "jointStep"):
            # Reassert the acknowledged common ratio for manual, task and start moves.
            # A rejected speed command must prevent the motor command.
            self.dashboard.send(f"SpeedFactor({setup['speed']:g})")
        if kind == "move":
            p = operation["target"]
            command = "MovJ" if operation["motion"] == "MoveJ" else "MovL"
            values = ",".join(f"{p[k]:.6f}" for k in ("x", "y", "z", "r"))
            # Use the global frames already applied by configure() and checked
            # against fresh feedback by the controller before each operation.
            # The four-axis guide defines omitted User/Tool as those global frames.
            # Keep one command per request: never retry rejected motion automatically.
            self.motion.send(f"{command}({values})")
        elif kind == "jointStep":
            values = ",".join(f"{operation['target'][k]:.6f}" for k in ("j1", "j2", "j3", "j4"))
            self.motion.send(f"JointMovJ({values})")
        elif kind == "enable":
            self.dashboard.send("EnableRobot()")
        elif kind == "disable":
            self.dashboard.send("DisableRobot()")
        elif kind == "suction":
            on = operation["on"]
            active = int(setup["activeHigh"])
            # Opposing output is switched first when applying vacuum.
            if on and setup["releaseDO"] is not None:
                self.dashboard.send(f"DOExecute({setup['releaseDO']},{1-active})")
            self.dashboard.send(f"DOExecute({setup['suctionDO']},{active if on else 1-active})")
            if not on and setup["releaseDO"] is not None:
                self.dashboard.send(f"DOExecute({setup['releaseDO']},{active})")
        else:
            raise ValueError("Unsupported operation")

    def stop(self):
        if self.dashboard:
            # Manufacturer's software robot-stop command; NOT a physical E-stop.
            self.dashboard.send("ResetRobot()")

    def close(self):
        self.closed.set()
        self.generation += 1
        for channel in (self.dashboard, self.motion, self.feedback):
            if channel:
                try:
                    channel.close()
                except OSError:
                    pass
        self.dashboard = self.motion = self.feedback = None
        with self.data_lock:
            self.latest = None


class MockRobot:
    """Clearly labelled deterministic simulator; never constructs a TCP socket."""
    source = "mock"

    def __init__(self):
        self.sequence = 0
        self.connected = False
        self.pose = {"x": 250., "y": -150., "z": 300., "r": 0.}
        self.joints = {"j1": 0., "j2": 0., "j3": 0., "j4": 0.}
        self.enabled = False
        self.error = False
        self.outputs = self.inputs = 0
        self.user = self.tool = 0
        self.commands = []

    def connect(self, ip):
        ipaddress.IPv4Address(ip)
        self.connected = True
        self.sequence = 0

    def measurement(self):
        if not self.connected:
            return None
        self.sequence += 1
        return {
            "source": "mock", "seq": self.sequence, "measuredAt": time.time() * 1000, "ageMs": 0,
            "pose": dict(self.pose), "joints": dict(self.joints), "enabled": self.enabled,
            "moving": False, "error": self.error, "robotMode": 9 if self.error else 5 if self.enabled else 4,
            "inputBits": str(self.inputs), "outputBits": str(self.outputs), "user": self.user, "tool": self.tool,
        }

    def configure(self, setup):
        self.user, self.tool = setup["user"], setup["tool"]

    def check_joint_path(self, start, target, setup):
        pass  # Protocol simulation only; never represents physical FK or a safe physical path.

    def command(self, operation, setup):
        self.commands.append(dict(operation))
        kind = operation["kind"]
        if kind == "move":
            self.pose = dict(operation["target"])
            # Deliberately NOT fake FK: mock joints have their own explicit source.
        elif kind == "jointStep":
            self.joints = dict(operation["target"])
        elif kind == "enable":
            self.enabled = True
        elif kind == "disable":
            self.enabled = False
        elif kind == "suction":
            on = operation["on"]
            def output(channel, value):
                if channel is None:
                    return
                mask = 1 << (channel - 1)
                self.outputs = self.outputs | mask if value else self.outputs & ~mask
            output(setup["suctionDO"], on == setup["activeHigh"])
            output(setup["releaseDO"], on != setup["activeHigh"])
            if setup["vacuumDI"] is not None:
                mask = 1 << (setup["vacuumDI"] - 1)
                self.inputs = self.inputs | mask if on else self.inputs & ~mask

    def stop(self):
        self.commands.append({"kind": "software-stop"})

    def close(self):
        self.connected = False
