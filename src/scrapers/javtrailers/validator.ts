import { ValidatorTestConfig } from '../base/types';

/**
 * Test configuration for validating the JAVTrailers scraper.
 * Update the values below to match a known video on the target site.
 */
export function getTestConfig(): ValidatorTestConfig | null {
  return {
    testFilename: 'ABF-300 test.mp4',
    expected: {
      code: 'ABF-300',
      name: 'ABF-300 風俗タワー 性感フルコース ACT.47 中森ななみ',
      releaseDate: '2025-12-17',
      maker: 'プレステージ',
      genres: ['単体作品', 'コスプレ'],
    },
  };
}
