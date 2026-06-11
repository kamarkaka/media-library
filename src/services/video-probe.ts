import { execFileSync } from 'child_process';
import path from 'path';

// Shared ffprobe metadata extraction, used by the scan worker and the relink-file endpoint.

export interface VideoInfo {
  duration: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  framerate: number | null;
  fileSize: number | null;
}

export function getVideoInfo(filePath: string): VideoInfo {
  const info: VideoInfo = {
    duration: null, width: null, height: null,
    videoCodec: null, audioCodec: null, bitrate: null,
    framerate: null, fileSize: null,
  };
  try {
    const output = execFileSync('ffprobe', [
      '-v', 'fatal',
      '-show_entries', 'format=duration,size,bit_rate',
      '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate',
      '-of', 'json',
      filePath,
    ], { timeout: 30000, encoding: 'utf-8' });

    const data = JSON.parse(output);
    const format = data.format || {};
    const streams: any[] = data.streams || [];
    const videoStream = streams.find((s: any) => s.codec_type === 'video');
    const audioStream = streams.find((s: any) => s.codec_type === 'audio');

    const dur = parseFloat(format.duration);
    info.duration = isNaN(dur) ? null : Math.round(dur);
    info.fileSize = format.size ? parseInt(format.size, 10) : null;
    info.bitrate = format.bit_rate ? parseInt(format.bit_rate, 10) : null;

    if (videoStream) {
      info.width = videoStream.width || null;
      info.height = videoStream.height || null;
      info.videoCodec = videoStream.codec_name || null;
      if (videoStream.r_frame_rate) {
        const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
        if (den && !isNaN(num / den)) {
          info.framerate = Math.round((num / den) * 100) / 100;
        }
      }
    }
    if (audioStream) {
      info.audioCodec = audioStream.codec_name || null;
    }

    return info;
  } catch (err) {
    console.warn(`[probe] ffprobe failed for ${path.basename(filePath)}:`, err);
    return info;
  }
}

// Map probe results to the shared videos / video_files technical columns.
export function videoInfoColumns(info: VideoInfo): Record<string, any> {
  return {
    length: info.duration,
    width: info.width,
    height: info.height,
    video_codec: info.videoCodec,
    audio_codec: info.audioCodec,
    bitrate: info.bitrate,
    framerate: info.framerate,
    file_size: info.fileSize,
  };
}
