"""Local-only RFC6455 JSON bridge; no third-party Python packages required.

Defaults to --mock, never opens robot sockets unless --allow-hardware is passed.
Exactly one browser owner. An explicit Origin allowlist is always required.
"""
import argparse
import asyncio
import base64
import hashlib
import ipaddress
import json
import ssl
import struct
import time
from urllib.parse import urlparse
from protocol import BridgeController
from robot import MockRobot, RealRobot

MAX_PAYLOAD = 16384


class WebSocket:
    def __init__(self, reader, writer):
        self.reader, self.writer = reader, writer
        self.lock = asyncio.Lock()
        self.last_pong = time.monotonic()

    async def frame(self, opcode, data):
        length = len(data)
        header = bytes([0x80 | opcode, length]) if length < 126 else bytes([0x80 | opcode, 126]) + struct.pack("!H", length)
        async with self.lock:
            self.writer.write(header + data)
            await self.writer.drain()

    async def send(self, message):
        await self.frame(1, json.dumps(message, allow_nan=False, separators=(",", ":")).encode())

    async def receive(self):
        while True:
            first, second = await self.reader.readexactly(2)
            opcode = first & 15
            if first & 0x70 or not first & 0x80 or not second & 0x80:
                raise ValueError("Compressed/fragmented/unmasked frames are not supported")
            length = second & 127
            if length == 126:
                length = struct.unpack("!H", await self.reader.readexactly(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", await self.reader.readexactly(8))[0]
            if length > MAX_PAYLOAD or opcode >= 8 and length > 125:
                raise ValueError("Oversized WebSocket message")
            mask = await self.reader.readexactly(4)
            body = await self.reader.readexactly(length)
            body = bytes(value ^ mask[index % 4] for index, value in enumerate(body))
            if opcode == 8:
                await self.frame(8, body[:125])
                return None
            if opcode == 9:
                await self.frame(10, body)
                continue
            if opcode == 10:
                self.last_pong = time.monotonic()
                continue
            if opcode != 1:
                raise ValueError("JSON text frames required")
            message = json.loads(body.decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite JSON")))
            if not isinstance(message, dict):
                raise ValueError("JSON object required")
            return message


class Server:
    def __init__(self, args):
        self.args = args
        self.owner = None

    async def accept(self, reader, writer):
        controller = None
        tasks = set()
        try:
            header = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
            if len(header) > 8192:
                raise ValueError("Oversized HTTP header")
            lines = header.decode("ascii").split("\r\n")
            fields = {}
            for line in lines[1:]:
                if ":" in line:
                    key, value = line.split(":", 1)
                    if key.lower() in fields:
                        raise ValueError("Duplicate HTTP header")
                    fields[key.lower()] = value.strip()
            origin = fields.get("origin", "")
            key = fields.get("sec-websocket-key", "")
            if lines[0] != "GET / HTTP/1.1" or origin not in self.args.allow_origin \
                or fields.get("upgrade", "").lower() != "websocket" \
                or "upgrade" not in fields.get("connection", "").lower() \
                or fields.get("sec-websocket-version") != "13" \
                or len(base64.b64decode(key, validate=True)) != 16:
                writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                await writer.drain()
                return
            if self.owner is not None:
                writer.write(b"HTTP/1.1 409 Conflict\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                await writer.drain()
                return
            self.owner = writer
            accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
            writer.write(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + b"\r\n\r\n")
            await writer.drain()
            ws = WebSocket(reader, writer)
            controller = BridgeController(RealRobot(True) if self.args.allow_hardware else MockRobot())
            async def publish():
                try:
                    last_ping = time.monotonic()
                    while True:
                        await asyncio.sleep(.1)
                        now = time.monotonic()
                        if now - ws.last_pong > 3:
                            break
                        if now - last_ping >= 1:
                            await asyncio.wait_for(ws.frame(9, b"mg400"), 1)
                            last_ping = now
                        if controller.connected:
                            await asyncio.wait_for(controller.send_measurement(ws.send), 1)
                except (OSError, RuntimeError, ValueError, asyncio.TimeoutError):
                    pass
                finally:
                    # A dead publisher is a lost control connection, not a
                    # reason to leave an active command unattended.
                    await controller.close()
                    writer.close()
            publisher = asyncio.create_task(publish())
            tasks.add(publisher)
            in_flight = set()
            while True:
                message = await ws.receive()
                if message is None:
                    break
                # Out-of-band stop may pass an in-flight execute. No unbounded
                # task flood, duplicate IDs or concurrent configuring commands.
                request_id = message.get("id")
                if not isinstance(request_id, str):
                    continue
                if request_id in in_flight or len(in_flight) >= 2:
                    await ws.send({"type": "reply", "id": request_id, "ok": False, "error": "Duplicate request or request limit"})
                    continue
                if in_flight and message.get("type") != "stop":
                    await ws.send({"type": "reply", "id": request_id, "ok": False, "error": "Previous request is still active"})
                    continue
                in_flight.add(request_id)
                async def handle(msg, rid):
                    try:
                        await controller.handle(msg, ws.send)
                    finally:
                        in_flight.discard(rid)
                task = asyncio.create_task(handle(message, request_id))
                tasks.add(task)
                task.add_done_callback(tasks.discard)
        except (OSError, ValueError, UnicodeError, asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError):
            pass
        finally:
            if controller:
                await controller.close()
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            if self.owner is writer:
                self.owner = None
            writer.close()
            try:
                await writer.wait_closed()
            except OSError:
                pass


async def main(args):
    if bool(args.cert) != bool(args.key):
        raise ValueError("Both TLS certificate and key are required")
    context = None
    if args.cert:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(args.cert, args.key)
    if not ipaddress.ip_address(args.host).is_loopback and not context:
        raise ValueError("LAN binding requires TLS. Use loopback or --cert/--key.")
    for origin in args.allow_origin:
        u = urlparse(origin)
        if u.scheme not in ("http", "https") or not u.netloc or u.path or u.query or u.fragment:
            raise ValueError("Origin must be exactly https://host[:port], without a trailing slash/path")
    server = Server(args)
    service = await asyncio.start_server(server.accept, args.host, args.port, ssl=context, limit=8192)
    print(f"MG400 bridge v2.1 (TCP + joint steps): {'HARDWARE ARMED FOR EXPLICIT REQUESTS' if args.allow_hardware else 'MOCK ONLY — NOT REAL MEASUREMENTS'}", flush=True)
    print(f"{'wss' if context else 'ws'}://{args.host}:{args.port}/; allowed origins={args.allow_origin}", flush=True)
    print("Connection sends no movement, enable, vacuum or alarm-clear command.", flush=True)
    async with service:
        await service.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--mock", action="store_true", help="No robot sockets, labelled mock telemetry (default)")
    mode.add_argument("--allow-hardware", action="store_true", help="Robot-side PC ONLY, operator-supervised hardware requests")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--allow-origin", action="append", required=True, help="Exact browser application Origin; repeat if needed")
    parser.add_argument("--cert", help="Trusted TLS certificate PEM path")
    parser.add_argument("--key", help="Local TLS key PEM path; never upload this key")
    try:
        asyncio.run(main(parser.parse_args()))
    except KeyboardInterrupt:
        pass

