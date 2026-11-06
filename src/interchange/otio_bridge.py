#!/usr/bin/env python3
"""OpenTimelineIO JSON bridge for the Node.js editing engine."""

import json
import os
import sys
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import unquote, urlparse

import opentimelineio as otio


ENGINE_KEY = "ai-video-editing-engine"


def plain_json(value):
    if isinstance(value, Mapping):
        return {key: plain_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)) or (not isinstance(value, (str, bytes, int, float, bool, type(None))) and hasattr(value, "__iter__")):
        return [plain_json(item) for item in value]
    return value


def time_range(start_seconds, duration_seconds):
    return otio.opentime.TimeRange(
        otio.opentime.RationalTime(start_seconds, 1),
        otio.opentime.RationalTime(duration_seconds, 1),
    )


def export_timeline(request):
    engine_timeline = request["timeline"]
    project_root = Path(request["projectRoot"]).resolve()
    timeline = otio.schema.Timeline(name=engine_timeline["project"]["id"])
    timeline.metadata[ENGINE_KEY] = {"timeline": engine_timeline}
    tracks = timeline.tracks

    for source_track in sorted(engine_timeline["tracks"], key=lambda item: item["order"]):
        if source_track["kind"] == "overlay":
            continue
        kind = otio.schema.TrackKind.Video if source_track["kind"] == "video" else otio.schema.TrackKind.Audio
        track = otio.schema.Track(name=source_track["id"], kind=kind)
        track.metadata[ENGINE_KEY] = {"trackId": source_track["id"]}
        cursor = 0.0
        clips = sorted(source_track["clips"], key=lambda item: item["timelineStart"])
        for source_clip in clips:
            if source_clip.get("speedRamp") or abs(source_clip.get("playbackRate", 1) - 1) > 1e-9:
                raise ValueError(f"Clip {source_clip['id']} uses retiming, which is not supported by the OTIO interchange profile.")
            if source_clip.get("transitionIn") or source_clip.get("transitionOut"):
                raise ValueError(f"Clip {source_clip['id']} uses transitions, which are not supported by the OTIO interchange profile.")
            if source_clip["timelineStart"] < cursor - 1e-6:
                raise ValueError(f"Track {source_track['id']} contains overlapping clips, which OTIO interchange does not support.")
            gap = source_clip["timelineStart"] - cursor
            if gap > 1e-6:
                track.append(otio.schema.Gap(source_range=time_range(0, gap)))
            asset = next(item for item in engine_timeline["assets"] if item["id"] == source_clip["assetId"])
            media_path = (project_root / asset["path"]).resolve()
            if not media_path.is_file():
                raise ValueError(f"Asset {asset['id']} is missing: {media_path}")
            clip = otio.schema.Clip(
                name=source_clip["id"],
                media_reference=otio.schema.ExternalReference(
                    target_url=media_path.as_uri(),
                    available_range=time_range(0, asset.get("durationSeconds", source_clip["sourceOut"])),
                ),
                source_range=time_range(source_clip["sourceIn"], source_clip["sourceOut"] - source_clip["sourceIn"]),
            )
            clip.metadata[ENGINE_KEY] = {"clipId": source_clip["id"], "assetId": asset["id"]}
            track.append(clip)
            cursor = source_clip["timelineStart"] + source_clip["durationSeconds"]
        tracks.append(track)

    return otio.adapters.write_to_string(timeline, adapter_name="otio_json")


def local_reference(target_url, otio_path):
    parsed = urlparse(target_url)
    if parsed.scheme == "file":
        path_text = unquote(parsed.path)
        if os.name == "nt" and len(path_text) >= 3 and path_text[0] == "/" and path_text[2] == ":":
            path_text = path_text[1:]
        path = Path(path_text)
        if parsed.netloc and parsed.netloc not in ("", "localhost"):
            path = Path(f"//{parsed.netloc}{path_text}")
        return path
    if parsed.scheme:
        raise ValueError(f"Remote media reference is not supported: {target_url}")
    return (otio_path.parent / unquote(target_url)).resolve()


def import_timeline(request):
    otio_path = Path(request["otioPath"]).resolve()
    timeline = otio.adapters.read_from_string(request["otioText"], adapter_name="otio_json")
    payload = {
        "name": timeline.name,
        "engineTimeline": plain_json(timeline.metadata.get(ENGINE_KEY, {}).get("timeline")),
        "tracks": [],
    }
    for track_index, track in enumerate(timeline.tracks):
        if track.kind not in (otio.schema.TrackKind.Audio, otio.schema.TrackKind.Video):
            raise ValueError(f"Track {track.name!r} has unsupported kind {track.kind!r}.")
        kind = "audio" if track.kind == otio.schema.TrackKind.Audio else "video"
        imported = {
            "name": track.name,
            "kind": kind,
            "order": track_index,
            "engineTrackId": track.metadata.get(ENGINE_KEY, {}).get("trackId"),
            "clips": [],
        }
        cursor = 0.0
        for item in track:
            if isinstance(item, otio.schema.Gap):
                cursor += item.duration().to_seconds()
                continue
            if not isinstance(item, otio.schema.Clip):
                raise ValueError(f"OTIO item {item.name!r} is not a clip or gap; transitions and nested compositions are unsupported.")
            media_reference = item.media_reference
            if not isinstance(media_reference, otio.schema.ExternalReference):
                raise ValueError(f"Clip {item.name!r} does not use an external media reference.")
            source_range = item.source_range
            duration = source_range.duration.to_seconds()
            metadata = item.metadata.get(ENGINE_KEY, {})
            imported["clips"].append({
                "name": item.name,
                "path": str(local_reference(media_reference.target_url, otio_path)),
                "timelineStart": cursor,
                "sourceIn": source_range.start_time.to_seconds(),
                "sourceOut": source_range.end_time_exclusive().to_seconds(),
                "durationSeconds": duration,
                "engineClipId": metadata.get("clipId"),
                "engineAssetId": metadata.get("assetId"),
            })
            cursor += duration
        payload["tracks"].append(imported)
    return payload


def main():
    request = json.load(sys.stdin)
    if request.get("operation") == "export":
        result = export_timeline(request)
    elif request.get("operation") == "import":
        result = import_timeline(request)
    else:
        raise ValueError("operation must be export or import")
    json.dump({"result": result}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # Keep a concise, actionable bridge error for Node.
        print(f"OTIO bridge: {error}", file=sys.stderr)
        sys.exit(1)
