#!/usr/bin/env python3
"""Cut real recorded UI scenes and add Korean captions without altering app pixels."""
import argparse
import json
import math
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("recording_directory", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--font", type=Path, required=True, help="Noto Sans CJK KR OTF")
args = parser.parse_args()
report = json.loads((args.recording_directory / "recording.json").read_text())
assert report["originalPreserved"] and report["previousFeedbackLinked"]
assert report["externalAiRequests"] == 0 and report["realRobotCommands"] == 0
assert not report["errors"]
videos = list(args.recording_directory.glob("*.webm"))
assert len(videos) == 1, "Use a fresh directory for each capture"
probe = json.loads(subprocess.check_output([
    "ffprobe", "-v", "error", "-show_entries", "format=duration:stream=r_frame_rate,width,height",
    "-of", "json", str(videos[0]),
]))
assert probe["streams"][0]["r_frame_rate"] == "25/1"
assert (probe["streams"][0]["width"], probe["streams"][0]["height"]) == (1600, 900)
duration = float(probe["format"]["duration"])
fps = 25
segments = report["segments"]
clips = []
clock = 0
for index, segment in enumerate(segments):
    start = math.ceil(segment["start"] * fps)
    end = math.floor((segments[index + 1]["start"] if index + 1 < len(segments) else duration) * fps)
    # Preserve the full DT movement, shorten only static holds/navigation waits.
    limit = (45 if index in (3, 7) else 11 if index in (5, 9) else 9) * fps
    end = min(end, start + limit)
    assert end > start
    clips.append({**segment, "sourceStartFrame": start, "sourceEndFrame": end,
                  "start": clock / fps, "duration": (end - start) / fps})
    clock += end - start

def timestamp(seconds):
    centiseconds = round(seconds * 100)
    return f"{centiseconds // 360000}:{centiseconds // 6000 % 60:02}:{centiseconds // 100 % 60:02}.{centiseconds % 100:02}"

def escape(text):
    return text.replace("\\", "＼").replace("{", "（").replace("}", "）").replace("\n", r"\N")

header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Noto Sans CJK KR,32,&H00FFFFFF,&H00FFFFFF,&H00182738,&H00182738,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Detail,Noto Sans CJK KR,24,&H00F5EBDD,&H00FFFFFF,&H00182738,&H00182738,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Small,Noto Sans CJK KR,18,&H00CFB8A1,&H00FFFFFF,&H00182738,&H00182738,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
events = []
def caption(start, end, style, x, y, value):
    events.append(f"Dialogue: 0,{timestamp(start)},{timestamp(end)},{style},,0,0,0,,{{\\pos({x},{y})}}{escape(value)}")

caption(0, clock / fps, "Small", 160, 10, "MG400  |  종이 좌표에서 로봇 좌표로")
caption(0, clock / fps, "Small", 160, 1047, "실제 앱 화면 · 시연용 학생/저장 응답 · DT 시뮬레이션 · 기본 체험 피드백 · 실물 로봇/실제 GPT 호출 없음")
for clip in clips:
    end = clip["start"] + clip["duration"]
    caption(clip["start"], end, "Title", 160, 39, clip["title"])
    caption(clip["start"], end, "Detail", 160, 1002, clip["detail"])
args.output.parent.mkdir(parents=True, exist_ok=True)
subtitle = args.output.with_suffix(".ass")
subtitle.write_text(header + "\n".join(events) + "\n", encoding="utf-8")
selection = "+".join(f"between(n,{clip['sourceStartFrame']},{clip['sourceEndFrame'] - 1})" for clip in clips)
def filter_path(value):
    return str(value.resolve()).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
filters = (f"select='{selection}',setpts=N/25/TB,pad=1920:1080:160:90:color=0x101c2e,"
           f"ass=filename='{filter_path(subtitle)}':fontsdir='{filter_path(args.font.parent)}'")
subprocess.run([
    "ffmpeg", "-y", "-hide_banner", "-i", str(videos[0]), "-vf", filters,
    "-an", "-r", "25", "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-pix_fmt", "yuv420p", "-threads", "2", "-movflags", "+faststart", str(args.output),
], check=True)
args.output.with_suffix(".edit.json").write_text(json.dumps({"duration": clock / fps, "clips": clips}, ensure_ascii=False, indent=2))
print(json.dumps({"file": str(args.output), "duration": clock / fps, "bytes": args.output.stat().st_size}))
