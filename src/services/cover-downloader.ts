import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';

export function downloadCover(
  url: string,
  videoCode: string,
  coverCacheDir: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const ext = path.extname(new URL(url).pathname) || '.jpg';
    const filename = videoCode.replace(/[/\\:*?"<>|]/g, '_') + ext;
    const filePath = path.join(coverCacheDir, filename);

    if (fs.existsSync(filePath)) {
      resolve(filePath);
      return;
    }

    fs.mkdirSync(coverCacheDir, { recursive: true });

    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          downloadCover(redirectUrl, videoCode, coverCacheDir).then(resolve);
          return;
        }
      }

      if (res.statusCode !== 200) {
        console.warn(`[cover] Failed to download ${url}: HTTP ${res.statusCode}`);
        res.resume();
        resolve(null);
        return;
      }

      const file = fs.createWriteStream(filePath);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(filePath);
      });
      file.on('error', (err) => {
        fs.unlink(filePath, () => {});
        console.warn(`[cover] Write error for ${videoCode}:`, err.message);
        resolve(null);
      });
    });

    request.on('error', (err) => {
      console.warn(`[cover] Download error for ${videoCode}:`, err.message);
      resolve(null);
    });

    request.on('timeout', () => {
      request.destroy();
      console.warn(`[cover] Timeout downloading ${videoCode}`);
      resolve(null);
    });
  });
}
