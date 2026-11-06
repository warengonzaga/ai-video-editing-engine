#!/usr/bin/env python3
"""OpenTimelineIO JSON bridge for the Node.js editing engine."""

import json
import math
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
        if source_track.get("audioEffects"):
            raise ValueError(f"Track {source_track['id']} uses audio effects, which are not supported by the OTIO interchange profile.")
        if source_track.get("volumeKeyframes"):
            raise ValueError(f"Track {source_track['id']} uses volume automation, which is not supported by the OTIO interchange profile.")
        kind = otio.schema.TrackKind.Video if source_track["kind"] == "video" else otio.schema.TrackKind.Audio
        track = otio.schema.Track(name=source_track["id"], kind=kind)
        track.enabled = not (source_track.get("muted", False) if source_track["kind"] == "audio" else not source_track.get("visible", True))
        track.metadata[ENGINE_KEY] = {"trackId": source_track["id"]}
        cursor = 0.0
        clips = sorted(source_track["clips"], key=lambda item: item["timelineStart"])
        index = 0
        while index < len(clips):
            source_clip = clips[index]
            if source_clip.get("volumeKeyframes"):
                raise ValueError(f"Clip {source_clip['id']} uses volume automation, which is not supported by the OTIO interchange profile.")
            if source_clip.get("audioEffects"):
                raise ValueError(f"Clip {source_clip['id']} uses clip audio effects, which are not supported by the OTIO interchange profile.")
            if source_clip.get("reverse"):
                raise ValueError(f"Clip {source_clip['id']} uses reverse playback, which is not supported by the OTIO interchange profile.")
            if source_clip.get("speedRamp"):
                raise ValueError(f"Clip {source_clip['id']} uses a variable speed ramp, which is not supported by the OTIO interchange profile.")
            if source_clip.get("transitionIn") or source_clip.get("transitionOut"):
                raise ValueError(f"Clip {source_clip['id']} uses transitions, which are not supported by the OTIO interchange profile.")
            if source_clip["timelineStart"] < cursor - 1e-6:
                raise ValueError(f"Track {source_track['id']} contains overlapping clips, which OTIO interchange does not support.")
            gap = source_clip["timelineStart"] - cursor
            if gap > 1e-6:
                track.append(otio.schema.Gap(source_range=time_range(0, gap)))
            next_clip = clips[index + 1] if index + 1 < len(clips) else None
            overlap = 0.0 if next_clip is None else (
                source_clip["timelineStart"] + source_clip["durationSeconds"] - next_clip["timelineStart"]
            )
            if overlap > 1e-6:
                if abs(source_clip.get("playbackRate", 1) - 1) > 1e-9:
                    raise ValueError(f"Clip {source_clip['id']} uses retiming in a crossfade, which is not supported by the OTIO interchange profile.")
                validate_crossfade_pair(source_track, source_clip, next_clip, overlap)
                if next_clip.get("reverse"):
                    raise ValueError(f"Clip {next_clip['id']} uses reverse playback, which is not supported by the OTIO interchange profile.")
                if next_clip.get("audioEffects"):
                    raise ValueError(f"Clip {next_clip['id']} uses clip audio effects, which are not supported by the OTIO interchange profile.")
                if next_clip.get("volumeKeyframes"):
                    raise ValueError(f"Clip {next_clip['id']} uses volume automation, which is not supported by the OTIO interchange profile.")
                if next_clip.get("speedRamp") or abs(next_clip.get("playbackRate", 1) - 1) > 1e-9:
                    raise ValueError(f"Clip {next_clip['id']} uses retiming, which is not supported by the OTIO interchange profile.")
                if next_clip.get("transitionIn") or next_clip.get("transitionOut"):
                    raise ValueError(f"Clip {next_clip['id']} uses transitions, which are not supported by the OTIO interchange profile.")
                if index + 2 < len(clips) and next_clip["timelineStart"] + next_clip["durationSeconds"] > clips[index + 2]["timelineStart"] + 1e-6:
                    raise ValueError("Three-way or chained clip overlaps are not supported by the OTIO interchange profile.")
                in_offset = overlap / 2
                out_offset = overlap - in_offset
                track.append(make_otio_clip(
                    source_clip,
                    project_root,
                    engine_timeline["assets"],
                    source_clip["sourceIn"],
                    source_clip["sourceOut"] - out_offset,
                    f"{source_clip['id']}-crossfade-out",
                ))
                track.append(otio.schema.Transition(
                    name=f"{source_clip['id']}-{next_clip['id']}-crossfade",
                    transition_type="SMPTE_Dissolve",
                    in_offset=otio.opentime.RationalTime(in_offset, 1),
                    out_offset=otio.opentime.RationalTime(out_offset, 1),
                ))
                track.append(make_otio_clip(
                    next_clip,
                    project_root,
                    engine_timeline["assets"],
                    next_clip["sourceIn"] + in_offset,
                    next_clip["sourceOut"],
                    f"{next_clip['id']}-crossfade-in",
                ))
                cursor = max(
                    source_clip["timelineStart"] + source_clip["durationSeconds"],
                    next_clip["timelineStart"] + next_clip["durationSeconds"],
                )
                index += 2
                continue

            if source_clip.get("fadeInSeconds", 0) > 0 or source_clip.get("fadeOutSeconds", 0) > 0:
                raise ValueError(f"Clip {source_clip['id']} uses a standalone clip fade, which is not supported by the OTIO interchange profile.")
            track.append(make_otio_clip(
                source_clip,
                project_root,
                engine_timeline["assets"],
                source_clip["sourceIn"],
                source_clip["sourceOut"],
                source_clip["id"],
            ))
            cursor = source_clip["timelineStart"] + source_clip["durationSeconds"]
            index += 1
        trailing_gap = engine_timeline["project"]["durationSeconds"] - cursor
        if trailing_gap > 1e-6:
            track.append(otio.schema.Gap(source_range=time_range(0, trailing_gap)))
        tracks.append(track)

    return otio.adapters.write_to_string(timeline, adapter_name="otio_json")


def validate_crossfade_pair(track, outgoing, incoming, overlap):
    fade_in = incoming.get("fadeInSeconds", 0)
    fade_out = outgoing.get("fadeOutSeconds", 0)
    if abs(fade_in - overlap) > 1e-6:
        raise ValueError(
            f"Track {track['id']} contains overlapping clips {outgoing['id']} and {incoming['id']} without a matching incoming fade; OTIO export requires an explicit crossfade."
        )
    if track["kind"] == "audio" and abs(fade_out - overlap) > 1e-6:
        raise ValueError(
            f"Audio crossfade {outgoing['id']} to {incoming['id']} must use matching outgoing and incoming fades."
        )
    if track["kind"] == "video" and fade_out > 0 and abs(fade_out - overlap) > 1e-6:
        raise ValueError(
            f"Video crossfade {outgoing['id']} to {incoming['id']} has a non-matching outgoing fade."
        )
    if outgoing.get("fadeInSeconds", 0) > 0 or incoming.get("fadeOutSeconds", 0) > 0:
        raise ValueError("Crossfades with additional standalone clip fades are not supported by the OTIO interchange profile.")


def make_otio_clip(source_clip, project_root, assets, source_in, source_out, name):
    asset = next(item for item in assets if item["id"] == source_clip["assetId"])
    media_path = (project_root / asset["path"]).resolve()
    if not media_path.is_file():
        raise ValueError(f"Asset {asset['id']} is missing: {media_path}")
    clip = otio.schema.Clip(
        name=name,
        media_reference=otio.schema.ExternalReference(
            target_url=media_path.as_uri(),
            available_range=time_range(0, asset.get("durationSeconds", source_clip["sourceOut"])),
        ),
        source_range=time_range(source_in, source_out - source_in),
    )
    clip.metadata[ENGINE_KEY] = {"clipId": source_clip["id"], "assetId": asset["id"]}
    clip.enabled = source_clip.get("enabled", True)
    playback_rate = source_clip.get("playbackRate", 1)
    if abs(playback_rate - 1) > 1e-9:
        clip.effects.append(otio.schema.LinearTimeWarp(name="Engine Playback Rate", time_scalar=playback_rate))
    return clip


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
        "durationSeconds": 0.0,
        "engineTimeline": plain_json(timeline.metadata.get(ENGINE_KEY, {}).get("timeline")),
        "tracks": [],
    }

    def import_track(track, group_path, parent_enabled, parent_range=None):
        if track.kind not in (otio.schema.TrackKind.Audio, otio.schema.TrackKind.Video):
            raise ValueError(f"Track {track.name!r} has unsupported kind {track.kind!r}.")
        if track.effects:
            effects = ", ".join(effect.effect_name or type(effect).__name__ for effect in track.effects)
            raise ValueError(f"Track {track.name!r} has effects ({effects}) that the OTIO interchange profile does not support.")
        track_range = track.source_range
        if track_range is not None and parent_range is not None:
            raise ValueError(f"Track {track.name!r} combines track and parent stack trims; combined trim ranges are not supported.")
        if track_range is not None:
            range_start = track_range.start_time.to_seconds()
            range_end = track_range.end_time_exclusive().to_seconds()
        elif parent_range is not None:
            range_start, range_end = parent_range
        else:
            range_start, range_end = 0.0, math.inf
        if (
            not math.isfinite(range_start)
            or not math.isfinite(range_end)
            or range_start < 0
            or range_end <= range_start
        ):
            raise ValueError(f"Track {track.name!r} has an invalid or negative trimmed source range.")
        kind = "audio" if track.kind == otio.schema.TrackKind.Audio else "video"
        name = " / ".join([*group_path, track.name])
        imported = {
            "name": name,
            "kind": kind,
            "order": len(payload["tracks"]),
            "enabled": bool(track.enabled and parent_enabled),
            "engineTrackId": track.metadata.get(ENGINE_KEY, {}).get("trackId"),
            "clips": [],
        }
        cursor = 0.0
        expanded_items = otio.algorithms.track_with_expanded_transitions(track)

        def clip_record(item, timeline_start, crossfade=None, source_window=None):
            if not isinstance(item, otio.schema.Clip):
                raise ValueError("Only transitions between two clips are supported by the OTIO interchange profile.")
            unsupported_effects = [effect for effect in item.effects if not isinstance(effect, otio.schema.LinearTimeWarp)]
            if unsupported_effects:
                effects = ", ".join(effect.effect_name or type(effect).__name__ for effect in unsupported_effects)
                raise ValueError(f"Clip {item.name!r} has effects ({effects}) that the OTIO interchange profile does not support.")
            time_warps = [effect for effect in item.effects if isinstance(effect, otio.schema.LinearTimeWarp) and effect.enabled]
            if len(time_warps) > 1:
                raise ValueError(f"Clip {item.name!r} uses multiple LinearTimeWarp effects, which the OTIO interchange profile does not support.")
            playback_rate = time_warps[0].time_scalar if time_warps else 1.0
            if (
                isinstance(playback_rate, bool)
                or not isinstance(playback_rate, (int, float))
                or not math.isfinite(playback_rate)
                or not 0.1 <= playback_rate <= 5
            ):
                raise ValueError(f"Clip {item.name!r} uses a LinearTimeWarp rate outside the Engine's supported range (0.1 to 5).")
            if crossfade and abs(playback_rate - 1) > 1e-9:
                raise ValueError(f"Transition clip {item.name!r} uses retiming, which the OTIO interchange profile does not support.")
            media_reference = item.media_reference
            if not isinstance(media_reference, otio.schema.ExternalReference):
                raise ValueError(f"Clip {item.name!r} does not use an external media reference.")
            source_range = item.source_range or media_reference.available_range
            if source_range is None:
                raise ValueError(f"Clip {item.name!r} has no source range or available media range.")
            source_offset, timeline_duration = (0.0, None) if source_window is None else source_window
            source_start = source_range.start_time.to_seconds() + source_offset * playback_rate
            source_duration = source_range.duration.to_seconds() if timeline_duration is None else timeline_duration * playback_rate
            duration = source_duration / playback_rate
            metadata = item.metadata.get(ENGINE_KEY, {})
            return {
                "name": item.name,
                "path": str(local_reference(media_reference.target_url, otio_path)),
                "timelineStart": timeline_start,
                "sourceIn": source_start,
                "sourceOut": source_start + source_duration,
                "durationSeconds": duration,
                "enabled": bool(item.enabled),
                **({"playbackRate": playback_rate} if abs(playback_rate - 1) > 1e-9 else {}),
                "engineClipId": metadata.get("clipId") if crossfade is None else None,
                "engineAssetId": metadata.get("assetId"),
                **({"crossfade": crossfade} if crossfade else {}),
            }

        for item in expanded_items:
            if isinstance(item, tuple):
                outgoing, transition, incoming = item
                duration = (transition.in_offset + transition.out_offset).to_seconds()
                if duration <= 0:
                    raise ValueError(f"Transition {transition.name!r} must have a positive duration.")
                selected_start = max(cursor, range_start)
                selected_end = min(cursor + duration, range_end)
                if selected_end > selected_start:
                    if selected_start > cursor + 1e-6 or selected_end < cursor + duration - 1e-6:
                        raise ValueError(f"Track {track.name!r} trims through transition {transition.name!r}; transition-boundary trims are not supported.")
                if transition.transition_type != "SMPTE_Dissolve":
                    if selected_end > selected_start:
                        raise ValueError(
                            f"Transition {transition.name!r} uses unsupported type {transition.transition_type!r}; only SMPTE_Dissolve is supported."
                        )
                if selected_end > selected_start:
                    pair_id = f"otio-transition-{len(imported['clips']) + 1:04d}"
                    timeline_start = selected_start - range_start
                    for item_clip, role, suffix in ((outgoing, "outgoing", "a-out"), (incoming, "incoming", "b-in")):
                        crossfade = {"role": role, "durationSeconds": duration}
                        record = clip_record(item_clip, timeline_start, crossfade)
                        record["name"] = f"{pair_id}-{suffix}"
                        if abs(record["durationSeconds"] - duration) > 1e-6:
                            raise ValueError(f"Transition {transition.name!r} does not expand to equal-duration clip segments.")
                        imported["clips"].append(record)
                cursor += duration
                continue
            if isinstance(item, otio.schema.Gap):
                if item.effects:
                    effects = ", ".join(effect.effect_name or type(effect).__name__ for effect in item.effects)
                    raise ValueError(f"Gap {item.name!r} has effects ({effects}) that the OTIO interchange profile does not support.")
                cursor += item.duration().to_seconds()
                continue
            if not isinstance(item, otio.schema.Clip):
                raise ValueError(
                    f"OTIO item {item.name!r} is not a clip or gap; unsupported transitions and nested compositions inside tracks cannot be imported."
                )
            full_record = clip_record(item, cursor)
            item_duration = full_record["durationSeconds"]
            selected_start = max(cursor, range_start)
            selected_end = min(cursor + item_duration, range_end)
            if selected_end > selected_start:
                if track_range is None:
                    imported["clips"].append(full_record)
                else:
                    relative_start = selected_start - cursor
                    relative_end = selected_end - cursor
                    record = clip_record(
                        item,
                        selected_start - range_start,
                        source_window=(relative_start, relative_end - relative_start),
                    )
                    imported["clips"].append(record)
            cursor += item_duration
        visible_duration = cursor if track_range is None and parent_range is None else range_end - range_start
        payload["durationSeconds"] = max(payload["durationSeconds"], visible_duration)
        payload["tracks"].append(imported)

    def import_stack(stack, group_path=(), include_self=True, parent_enabled=True, parent_range=None):
        stack_range = stack.source_range
        if stack_range is not None and parent_range is not None:
            raise ValueError(f"Stack {stack.name!r} combines nested stack trims; combined trim ranges are not supported.")
        if stack_range is not None:
            range_start = stack_range.start_time.to_seconds()
            range_end = stack_range.end_time_exclusive().to_seconds()
            if (
                not math.isfinite(range_start)
                or not math.isfinite(range_end)
                or range_start < 0
                or range_end <= range_start
            ):
                raise ValueError(f"Stack {stack.name!r} has an invalid or negative trimmed source range.")
            if any(isinstance(item, otio.schema.Stack) for item in stack):
                raise ValueError(f"Stack {stack.name!r} trims nested stacks; nested stack trims are not supported.")
            if any(isinstance(item, otio.schema.Track) and item.source_range is not None for item in stack):
                raise ValueError(f"Stack {stack.name!r} combines stack and track trims; combined trim ranges are not supported.")
            child_range = (range_start, range_end)
        else:
            child_range = parent_range
        if stack.effects:
            effects = ", ".join(effect.effect_name or type(effect).__name__ for effect in stack.effects)
            raise ValueError(f"Stack {stack.name!r} has effects ({effects}) that the OTIO interchange profile does not support.")
        stack_enabled = bool(stack.enabled and parent_enabled)
        next_group = (*group_path, stack.name) if include_self and stack.name else group_path
        for item in stack:
            if isinstance(item, otio.schema.Track):
                import_track(item, next_group, stack_enabled, child_range)
            elif isinstance(item, otio.schema.Stack):
                import_stack(item, next_group, parent_enabled=stack_enabled, parent_range=child_range)
            else:
                raise ValueError(f"OTIO stack item {item.name!r} is not a track or nested stack.")

    import_stack(timeline.tracks, include_self=False)
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
