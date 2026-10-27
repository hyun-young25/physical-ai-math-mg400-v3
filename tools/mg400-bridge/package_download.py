"""Rebuild reproducible public download from source (never includes local TLS keys)."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[2]
source = Path(__file__).resolve().parent
public = root / "artifacts" / "robot-control" / "public"
public.mkdir(parents=True, exist_ok=True)
allowed = ("server.py", "protocol.py", "robot.py", "test_bridge.py", "README.md")
with zipfile.ZipFile(public / "mg400-bridge.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for filename in allowed:
        info = zipfile.ZipInfo("mg400-bridge/" + filename, date_time=(2026, 10, 5, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, (source / filename).read_bytes())
(public / "mg400-practice-guide.md").write_bytes((source / "README.md").read_bytes())
print("Built public/mg400-bridge.zip and public/mg400-practice-guide.md (no certificates, keys or environment files)")
