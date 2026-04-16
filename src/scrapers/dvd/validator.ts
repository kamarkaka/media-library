import { ValidatorTestConfig } from '../base/types';

/**
 * Test configuration for validating the DVD scraper.
 * Update the values below to match a known video on the target site.
 */
export function getTestConfig(): ValidatorTestConfig | null {
  return {
    testFilename: 'ABF-300 test.mp4',
    expected: {
      code: 'ABF-300',
      name: 'ABF-300 プレステージ専属 プレステージ最高峰BODYが挑む初グラビア 海が似合う褐色美女 BEST OF 相沢みなみ',
      releaseDate: '2025-01-10',
      director: 'ONNA',
      maker: 'プレステージ',
      genres: ['ベスト・総集編', '美少女', 'スレンダー', '独占配信', '単体作品'],
      cast: ['相沢みなみ'],
    },
  };
}
