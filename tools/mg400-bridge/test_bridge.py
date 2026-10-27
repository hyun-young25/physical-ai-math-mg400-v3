"""Offline tests only. No calls to RealRobot.connect, no external robot sockets."""
import argparse
import asyncio
import base64
import json
import struct
import unittest
from unittest.mock import patch
from protocol import BridgeController, completed, validate_setup
from robot import CommandChannel, MockRobot, RealRobot, decode_feedback
from server import Server


def setup():
    return {"user": 0, "tool": 0, "suctionDO": 1, "releaseDO": None, "vacuumDI": None,
            "activeHigh": True, "speed": 10, "positionTolerance": 2, "rotationTolerance": 2,
            "workspace": {"xMin": 200, "xMax": 350, "yMin": -160, "yMax": 160, "zMin": 0, "zMax": 320, "rMin": -180, "rMax": 180},
            "verified": dict.fromkeys(("firmware", "network", "coordinates", "tool", "io", "workspace"), True)}


def packet():
    b = bytearray(1440)
    struct.pack_into("<h", b, 0, 1440)
    struct.pack_into("<Q", b, 48, 0x123456789ABCDEF)
    struct.pack_into("<Q", b, 24, 5)
    struct.pack_into("<Q", b, 8, 5)
    struct.pack_into("<Q", b, 16, 9)
    struct.pack_into("<Q", b, 32, 100000)
    struct.pack_into("<6d", b, 432, 1, 2, 3, 4, 0, 0)
    struct.pack_into("<6d", b, 624, 250, -100, 280, 30, 0, 0)
    b[1026] = b[1031] = 1
    return b


class DecodeTests(unittest.TestCase):
    def test_official_offsets_and_bit_numbering(self):
        m = decode_feedback(packet())
        self.assertEqual(m["pose"], {"x": 250, "y": -100, "z": 280, "r": 30})
        self.assertEqual(m["joints"], {"j1": 1, "j2": 2, "j3": 3, "j4": 4})
        self.assertEqual(m["outputBits"], "9")
        self.assertEqual(m["inputBits"], "5")  # DI1 and DI3, bit0 = DI1.

    def test_rejects_incompatible_or_nonfinite_packets_and_wrong_model(self):
        for offset, value in ((48, 0), (1031, 2), (1026, 2)):
            b = packet(); b[offset] = value
            with self.assertRaises(ValueError):
                decode_feedback(b)
        with self.assertRaises(ValueError):
            decode_feedback(packet()[:-1])
        b = packet(); struct.pack_into("<d", b, 624, float("nan"))
        with self.assertRaises(ValueError):
            decode_feedback(b)

    def test_hardware_disabled_by_default_without_opening_socket(self):
        with patch("socket.create_connection", side_effect=AssertionError("NO HARDWARE SOCKETS")):
            with self.assertRaises(PermissionError):
                RealRobot().connect("192.168.1.6")

    def test_command_parser_waits_for_complete_response_and_rejects_error(self):
        class Fake:
            chunks = [b"0,{},", b"MovL(250,0,280,0);"]
            def settimeout(self, _): pass
            def sendall(self, _): pass
            def recv(self, _): return self.chunks.pop(0)
        c = CommandChannel("offline", 0, lambda *_a, **_k: Fake())
        self.assertTrue(c.send("anything").startswith("0,"))
        c.socket.chunks = [b"-1,{},MovL(250,0,280,0);"]
        with self.assertRaises(RuntimeError): c.send("anything")


class JointSdkTests(unittest.TestCase):
    def test_official_fk_then_jointmovj_and_rejected_fk(self):
        class Channel:
            def __init__(self): self.sent = []; self.reply = "0,{250,0,100,0},PositiveSolution(0,0,0,0,0,0)"
            def send(self, cmd): self.sent.append(cmd); return self.reply
        robot = RealRobot(True); robot.dashboard = Channel(); robot.motion = Channel()
        start = dict.fromkeys(("j1", "j2", "j3", "j4"), 0)
        target = {**start, "j2": .5}
        robot.check_joint_path(start, target, setup())
        self.assertEqual(len(robot.dashboard.sent), 2)
        self.assertTrue(robot.dashboard.sent[0].startswith("PositiveSolution("))
        self.assertEqual(robot.motion.sent, [])
        robot.command({"kind":"jointStep", "target":target},setup())
        self.assertEqual(robot.motion.sent, ["JointMovJ(0.000000,0.500000,0.000000,0.000000)"])
        for reply in ("0,{900,0,100,0},PositiveSolution()", "0,{},PositiveSolution()", "0,{nan,0,0,0},PositiveSolution()"):
            robot.dashboard.reply = reply
            with self.assertRaises(ValueError): robot.check_joint_path(start,target,setup())


class LowSpeedCommandTests(unittest.TestCase):
    def test_every_motion_reasserts_common_speed_before_any_motor_command(self):
        calls = []
        class Channel:
            def __init__(self, name):
                self.name = name
            def send(self, command):
                calls.append((self.name, command))
                return "0,{},ok;"
        robot = RealRobot.__new__(RealRobot)  # No socket construction or connect.
        robot.dashboard = Channel("dashboard"); robot.motion = Channel("motion")
        s = setup(); s["speed"] = 2
        operations = [
            {"kind":"move", "motion":"MoveJ", "target":{"x":250,"y":0,"z":100,"r":0}},
            {"kind":"move", "motion":"MoveL", "target":{"x":250,"y":0,"z":100,"r":0}},
            {"kind":"jointStep", "target":{"j1":0,"j2":0,"j3":0,"j4":0}},
        ]
        for operation in operations:
            robot.command(operation, s)
        self.assertEqual([calls[i] for i in (0,2,4)], [("dashboard","SpeedFactor(2)")]*3)
        self.assertTrue(all(calls[i][0]=="motion" for i in (1,3,5)))
        with patch.object(robot.dashboard, "send", side_effect=RuntimeError("offline speed rejection")):
            with self.assertRaises(RuntimeError):
                robot.command(operations[0], s)
        self.assertEqual(len(calls), 6)  # Rejected speed sends no new motor command.


class ControllerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.robot = MockRobot()
        self.controller = BridgeController(self.robot)
        self.messages = []
        self.index = 0
    async def asyncTearDown(self):
        await self.controller.close()
    async def send(self, m):
        self.messages.append(m)
    async def request(self, kind, **data):
        self.index += 1; rid = str(self.index)
        await self.controller.handle({"type": kind, "id": rid, **data}, self.send)
        return next(m for m in reversed(self.messages) if m.get("id") == rid)
    async def prepare(self):
        self.assertTrue((await self.request("connect", robotIp="192.168.1.6"))["ok"])
        self.assertTrue((await self.request("configure", setup=setup()))["ok"])
    async def test_applied_speed_ack_stale_confirmation_and_configure_failure(self):
        await self.request("connect", robotIp="192.168.1.6")
        s = setup(); s["speed"] = 5
        result = await self.request("configure", setup=s)
        self.assertEqual(result["result"]["appliedSpeed"], 5)
        stale = await self.request("execute", operation={"kind":"enable"}, confirmed=True, expectedSpeed=10)
        self.assertFalse(stale["ok"])
        self.assertFalse(self.robot.measurement()["enabled"])
        with patch.object(self.robot, "configure", side_effect=RuntimeError("offline configuration rejection")):
            result = await self.request("configure", setup=s)
        self.assertFalse(result["ok"])
        self.assertIsNone(self.controller.setup)
        self.assertFalse(self.controller.busy)
    async def test_joint_steps_limits_and_preflight(self):
        await self.prepare()
        self.assertTrue(self.messages[0]["capabilities"]["jointStep"])
        await self.request("execute", operation={"kind":"enable"}, confirmed=True)
        for joint in ("j1","j2","j3","j4"):
            for delta in (.5,-.5):
                old = self.robot.joints[joint]
                reply = await self.request("execute", operation={"kind":"jointStep","joint":joint,"delta":delta,"target":{"j1":900}}, confirmed=True)
                self.assertTrue(reply["ok"], reply)
                self.assertEqual(self.robot.joints[joint],old+delta)
        for joint, delta in (("j2",11),("j0",1),("j1",0)):
            self.assertFalse((await self.request("execute",operation={"kind":"jointStep","joint":joint,"delta":delta},confirmed=True))["ok"])
        self.robot.joints["j2"] = 85
        self.assertFalse((await self.request("execute",operation={"kind":"jointStep","joint":"j2","delta":.5},confirmed=True))["ok"])
        self.robot.joints["j2"] = 0
        count = len(self.robot.commands)
        with patch.object(self.robot,"check_joint_path",side_effect=ValueError("FK outside workspace")):
            self.assertFalse((await self.request("execute",operation={"kind":"jointStep","joint":"j2","delta":.5},confirmed=True))["ok"])
        self.assertFalse(any(op["kind"] == "jointStep" for op in self.robot.commands[count:]))

    async def test_connect_and_configure_never_actuate(self):
        with patch("socket.create_connection", side_effect=AssertionError("NO HARDWARE SOCKETS")):
            await self.prepare()
        self.assertEqual(self.robot.commands, [])
        self.assertEqual(self.messages[0]["source"], "mock")
    async def test_preparation_confirmation_servo_and_workspace_are_enforced(self):
        await self.prepare()
        op = {"kind": "move", "motion": "MoveL", "target": {"x": 280, "y": 0, "z": 280, "r": 0}}
        self.assertFalse((await self.request("execute", operation=op, confirmed=False))["ok"])
        self.assertFalse((await self.request("execute", operation=op, confirmed=True))["ok"])
        self.assertTrue((await self.request("execute", operation={"kind": "enable"}, confirmed=True))["ok"])
        self.assertTrue((await self.request("execute", operation=op, confirmed=True))["ok"])
        op["target"]["x"] = 900
        self.assertFalse((await self.request("execute", operation=op, confirmed=True))["ok"])
        self.assertEqual(len([c for c in self.robot.commands if c["kind"] == "move"]), 1)
        self.assertEqual(len(next(m for m in reversed(self.messages) if m["type"] == "measurement")["measurement"]["joints"]), 4)
    async def test_ack_never_substitutes_for_actual_target_and_source_is_mock(self):
        await self.prepare()
        await self.request("execute", operation={"kind": "enable"}, confirmed=True)
        reply = await self.request("execute", operation={"kind": "move", "motion": "MoveJ",
            "target": {"x": 280, "y": 0, "z": 280, "r": 25}}, confirmed=True)
        self.assertTrue(reply["ok"])
        self.assertEqual(self.messages[-2]["type"], "measurement")
        self.assertEqual(self.messages[-2]["measurement"]["seq"], reply["result"]["seq"])
        self.assertEqual(self.messages[-2]["measurement"]["source"], "mock")
        sequences = [m["measurement"]["seq"] for m in self.messages if m["type"] == "measurement"]
        self.assertEqual(sequences, sorted(set(sequences)))
    async def test_dual_outputs_and_pressure_are_observed(self):
        s = setup(); s.update(releaseDO=2, vacuumDI=3)
        await self.prepare(); await self.request("configure", setup=s)
        await self.request("execute", operation={"kind": "enable"}, confirmed=True)
        for on in (True, False):
            op = {"kind": "suction", "on": on}
            self.assertTrue((await self.request("execute", operation=op, confirmed=True))["ok"])
            self.assertTrue(completed(op, self.messages[-2]["measurement"], s))
        self.assertEqual(self.robot.outputs, 2)
        self.assertEqual(self.robot.inputs, 0)
    async def test_stale_feedback_invalid_setup_and_joint_commands_are_blocked(self):
        await self.prepare()
        bad = setup(); bad["verified"]["workspace"] = False
        self.assertFalse((await self.request("configure", setup=bad))["ok"])
        self.assertFalse((await self.request("execute", operation={"kind": "joints"}, confirmed=True))["ok"])
        original = self.robot.measurement
        self.robot.measurement = lambda: {**original(), "ageMs": 2000}
        self.assertFalse((await self.request("execute", operation={"kind": "enable"}, confirmed=True))["ok"])
        self.assertEqual(self.robot.commands, [])
    async def test_stop_is_out_of_band_and_never_releases_vacuum_or_clears_alarm(self):
        await self.prepare()
        await self.request("execute", operation={"kind": "enable"}, confirmed=True)
        await self.request("execute", operation={"kind": "suction", "on": True}, confirmed=True)
        # Simulate a move which never reaches its target.
        original = self.robot.command
        self.robot.command = lambda op, s: original(op, s) if op["kind"] != "move" else None
        task = asyncio.create_task(self.request("execute", operation={"kind": "move", "motion": "MoveL",
            "target": {"x": 280, "y": 0, "z": 280, "r": 0}}, confirmed=True))
        await asyncio.sleep(.08)
        reply = await self.request("stop")
        self.assertTrue(reply["ok"])
        self.assertFalse((await task)["ok"])
        self.assertEqual(self.robot.outputs, 1)
        self.assertIsNone(self.controller.setup)
        self.assertFalse(any(c.get("kind") == "clear-error" for c in self.robot.commands))


class WebSocketTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.server = Server(argparse.Namespace(allow_origin=["https://test.invalid"], allow_hardware=False))
        self.service = await asyncio.start_server(self.server.accept, "127.0.0.1", 0)
        self.port = self.service.sockets[0].getsockname()[1]
        self.clients = []
    async def asyncTearDown(self):
        for writer in self.clients:
            writer.close()
        self.service.close(); await self.service.wait_closed(); await asyncio.sleep(.05)
    async def connect(self, origin):
        r, w = await asyncio.open_connection("127.0.0.1", self.port); self.clients.append(w)
        key = base64.b64encode(b"offline-test-key").decode()
        w.write((f"GET / HTTP/1.1\r\nHost: localhost\r\nOrigin: {origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {key}\r\n\r\n").encode())
        await w.drain(); h = await r.readuntil(b"\r\n\r\n")
        return r, w, h
    async def test_origin_allowlist_and_single_controller(self):
        _, _, bad = await self.connect("https://evil.invalid"); self.assertIn(b"403", bad)
        _, _, good = await self.connect("https://test.invalid"); self.assertIn(b"101", good)
        _, _, other = await self.connect("https://test.invalid"); self.assertIn(b"409", other)
    async def test_real_websocket_protocol_connects_only_to_mock(self):
        r, w, h = await self.connect("https://test.invalid"); self.assertIn(b"101", h)
        message = json.dumps({"type": "connect", "id": "offline", "robotIp": "192.168.1.6"}).encode()
        mask = b"abcd"
        w.write(bytes([0x81, 0x80 | len(message)]) + mask + bytes(v ^ mask[i % 4] for i, v in enumerate(message)))
        await w.drain()
        first, size = await r.readexactly(2)
        self.assertEqual(first, 0x81)
        if size == 126: size = struct.unpack("!H", await r.readexactly(2))[0]
        hello = json.loads(await r.readexactly(size))
        self.assertEqual(hello["source"], "mock")
        self.assertEqual(hello["protocol"], 2)


if __name__ == "__main__":
    unittest.main()

