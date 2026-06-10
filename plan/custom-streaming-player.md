# Custom Streaming Player with FFmpeg Backend

## Problem

The current player serves raw video files via HTTP range requests. This causes playback issues for many videos:
- **Codec incompatibility**: MKV, AVI, WMV, FLV containers are indexed but browsers can't play them natively. The `<source>` tag hardcodes `type="video/mp4"`.
- **Seek issues**: Some MP4 files have the `moov` atom at the end of the file, making random seek unreliable with raw range-request streaming. The browser must download from the beginning to build a seek index.
- **No transcoding**: Files are served byte-for-byte from disk with no format conversion.

## Solution: HLS Streaming via FFmpeg

Use FFmpeg on the server to transcode videos into HLS (HTTP Live Streaming) format on-the-fly. HLS splits video into small `.ts` segments with an `.m3u8` playlist, enabling reliable seek to any position. Use [hls.js](https://github.com/video-dev/hls.js) on the client for playback.

### Why HLS

- **Universal browser support** via hls.js (Safari supports HLS natively)
- **Reliable seeking**: Each segment is independently decodable — seek jumps to the correct segment
- **Codec normalization**: FFmpeg transcodes any input format to H.264 + AAC, which all browsers support
- **Multi-quality**: HLS master playlists support multiple quality levels with seamless switching during playback

## Architecture

```
Browser                              Server
  │                                    │
  │  GET /api/videos/:id/hls          │
  │  ──────────────────────────────►  │  Returns master.m3u8 (lists quality levels)
  │  ◄──────────────────────────────  │
  │                                    │
  │  GET /api/videos/:id/hls/720p    │
  │  ──────────────────────────────►  │  FFmpeg spawns for 720p, returns playlist.m3u8
  │  ◄──────────────────────────────  │
  │                                    │
  │  GET /api/videos/:id/hls/720p/:n │
  │  ──────────────────────────────►  │  Returns segment N (.ts file)
  │  ◄──────────────────────────────  │
  │        (repeat per segment)        │
```

## Plan

### Phase 1: Server-side HLS transcoding with multi-quality

**New file: `src/services/hls-transcoder.ts`**

Generate a master playlist pointing to per-quality variant playlists. Each quality level is transcoded independently by FFmpeg.

**Quality levels** (only levels at or below the source resolution are generated):

| Level    | Resolution | Bitrate | Bandwidth (for master playlist) |
|----------|------------|---------|--------------------------------|
| 360p     | 640×360    | 800k   | 1000000                        |
| 720p     | 1280×720   | 2500k  | 3000000                        |
| 1080p    | 1920×1080  | 5000k  | 6000000                        |
| original | source     | source  | (highest)                      |

- **Master playlist**: Generated on request. Reads the video's `height` from the DB to determine available quality levels (e.g., a 720p source only gets 360p + 720p + original, no 1080p). Returns `master.m3u8`.
- **Variant transcoding**: Each quality spawns a separate FFmpeg process:
  ```
  ffmpeg -i <input> -c:v libx264 -c:a aac -preset veryfast
         -vf scale=-2:<height> -b:v <bitrate>
         -hls_time 10 -hls_list_size 0 -hls_segment_type mpegts
         -hls_segment_filename '<cache_dir>/<video_id>/<quality>/seg%04d.ts'
         <cache_dir>/<video_id>/<quality>/playlist.m3u8
  ```
- **Original quality**: Uses `-c:v copy -c:a copy` (no re-encoding) if the source is H.264/AAC, otherwise transcodes at source resolution with no bitrate cap.
- Cache segments on disk in `data/hls-cache/<video_id>/<quality>/`
- Track active transcoding jobs per video+quality to avoid duplicate spawns
- If segments already exist (cache hit), serve directly without re-transcoding
- Add a cleanup mechanism: delete cache when video is removed, or on a size/age limit

**`src/routes/api/videos.ts`** — New endpoints:
- `GET /:id/hls` — Returns the master `.m3u8` playlist listing all available quality levels
- `GET /:id/hls/:quality` — Returns the variant `.m3u8` playlist for a specific quality (triggers transcoding if not cached)
- `GET /:id/hls/:quality/:segment` — Returns a `.ts` segment file

**`src/config.ts`** — New config:
- `hlsCacheDir`: path for cached segments (default: `data/hls-cache/`)
- `ffmpegPath`: path to ffmpeg binary (default: `ffmpeg` on PATH)
- `seekStep`: fast-forward/rewind step in seconds (default: `10`)

### Phase 2: Custom player UI

Replace the native `<video controls>` with a custom player UI built with vanilla JS.

**`views/player.ejs`** — Replace the video element:
- Remove `controls` attribute
- Add custom control bar overlay:
  - Play/Pause button
  - Rewind / Fast-forward buttons (configurable step)
  - Seekable progress bar with draggable playhead
  - Current time / Duration display
  - Quality selector button (shows current level, dropdown to switch: 360p / 720p / 1080p / Original / Auto)
  - Fullscreen toggle button
  - Volume control (optional)

**`public/js/player.js`** — Custom player logic:
- Initialize hls.js: `new Hls()`, attach to video element, load `/api/videos/:id/hls`
- **Play/Pause**: Toggle `video.play()` / `video.pause()`
- **Fast forward/backward**: `video.currentTime += seekStep` / `video.currentTime -= seekStep`. Read step from a data attribute set by the server config.
- **Seek bar**: 
  - Render progress bar showing `video.currentTime / video.duration`
  - On mousedown/touchstart on the bar, begin drag
  - On mousemove/touchmove, update visual position
  - On mouseup/touchend, set `video.currentTime = (clickX / barWidth) * video.duration`
  - Show buffer progress from `video.buffered` ranges
- **Fullscreen**: Use `video.requestFullscreen()` / `document.exitFullscreen()` with the control bar inside the fullscreen container
- **Quality switching**:
  - hls.js exposes `hls.levels` (available quality levels) and `hls.currentLevel` (active level, -1 = auto)
  - Render a quality selector button showing the current level (e.g. "720p" or "Auto")
  - On click, show a popup with all available levels + "Auto" option
  - On selection, set `hls.currentLevel = index` (or `-1` for auto)
  - hls.js handles the seamless switch — it finishes the current segment then loads the new quality
  - Preserve playback position across quality switches (hls.js does this automatically)
  - Default to "Auto" which lets hls.js pick based on bandwidth estimation
- **Keyboard shortcuts**: 
  - Space: play/pause
  - Left/Right arrow: seek backward/forward by configured step
  - F: toggle fullscreen

### Phase 3: Settings page — seek step config

**`views/settings.ejs`** — Add a "Player Settings" section:
- Seek step dropdown: 5s / 10s / 15s / 30s
- Saved to the `settings` table in DB (key: `seek_step`)

**`src/routes/settings.ts`** — Load `seek_step` setting and pass to view

**`src/routes/player.ts`** — Load `seek_step` setting and pass to player view as a data attribute on the video container

**`src/routes/api/library.ts`** or new settings API — `PUT /api/settings/seek-step` endpoint

### Phase 4: Fallback for directly-playable files

Not all files need transcoding. MP4 files with H.264 video and AAC audio can be served directly via the existing range-request endpoint, which is faster and avoids CPU-intensive transcoding.

**`src/services/hls-transcoder.ts`** — Add a check:
- If `video_codec === 'h264' && audio_codec === 'aac' && container is mp4/m4v`, serve via the existing direct stream endpoint
- Otherwise, serve via HLS transcoding

The custom player UI should handle both modes: use hls.js for HLS streams (with quality selector), or set `video.src` directly for MP4 files (quality selector hidden since there's only one level).

## Files to create/modify

### New files
- `src/services/hls-transcoder.ts` — FFmpeg spawning, caching, job tracking

### Modified files
- `src/routes/api/videos.ts` — HLS playlist + segment endpoints
- `src/config.ts` — `hlsCacheDir`, `ffmpegPath`, `seekStep`
- `views/player.ejs` — Custom player UI with control bar
- `public/js/player.js` — hls.js integration, custom controls, keyboard shortcuts
- `public/css/styles.css` — Player control bar styles
- `views/settings.ejs` — Seek step dropdown
- `public/js/settings.js` — Seek step save handler
- `src/routes/settings.ts` — Load seek step
- `src/routes/player.ts` — Pass seek step to view

### New dependency
- `hls.js` — Client-side HLS playback library (loaded via CDN, no build step needed)

## Not in scope

- Subtitle support
- Audio track selection
- Live transcoding progress indicator
- Pre-transcoding all videos (transcoding is on-demand per quality level)

## Verification

1. `npm run dev`
2. Play an MP4 (H.264/AAC) video — should use direct streaming, seek works
3. Play an MKV/AVI video — should trigger HLS transcoding, check `data/hls-cache/` for segments
4. Test seek bar drag — video should jump to correct position
5. Test fast-forward/backward buttons with different step settings
6. Test fullscreen toggle
7. Test keyboard shortcuts (Space, Left, Right, F)
8. Change seek step in Settings — verify it takes effect on player page
9. Check that repeated plays of the same video use cached segments
10. Switch quality during playback — video should continue from same position at new quality
11. Verify quality selector only shows levels at or below source resolution
12. Test "Auto" quality — should adapt based on network conditions
13. Check `data/hls-cache/<video_id>/` has subdirectories per quality level
