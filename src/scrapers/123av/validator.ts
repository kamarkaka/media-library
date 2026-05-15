import { ValidatorTestConfig } from '../base/types';

/**
 * Test configuration for validating the JAVTrailers scraper.
 * Update the values below to match a known video on the target site.
 */
export function getTestConfig(): ValidatorTestConfig | null {
  return {
    testFilename: 'ACZD-195 test.mp4',
    expected: {
      code: 'ACZD-195',
      name: 'ACZD-195 縄の淫花 松ゆきの VOL.3',
      releaseDate: '2024-06-14',
      maker: '三和出版',
      genres: ['アナル', '拘束', 'SM', '羞恥', '4時間以上作品', 'ドキュメンタリー', 'ボンテージ', 'M女'],
      cast: ['松ゆきの']
    },
  };
}
