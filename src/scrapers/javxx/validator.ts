import { ValidatorTestConfig } from '../base/types';

/**
 * Test configuration for validating the JAVTrailers scraper.
 * Update the values below to match a known video on the target site.
 */
export function getTestConfig(): ValidatorTestConfig | null {
  return {
    testFilename: 'ACZD-159 test.mp4',
    expected: {
      code: 'ACZD-159',
      name: 'ACZD-159 - 縄の淫花 赤城穂波',
      releaseDate: '2024-01-12',
      maker: '三和出版',
      genres: ['Sm', 'M女', '拘束', '拷問', '縛ﾘ･緊縛', '単体作品', 'ﾄﾞｷｭﾒﾝﾀﾘｰ', '巨乳'],
      cast: ['赤城穂波']
    },
  };
}
