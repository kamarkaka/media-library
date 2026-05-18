import { ValidatorTestConfig } from '../base/types';

/**
 * Test configuration for validating the JAVTrailers scraper.
 * Update the values below to match a known video on the target site.
 */
export function getTestConfig(): ValidatorTestConfig | null {
  return {
    testFilename: 'SVDVD-196 test.mp4',
    expected: {
      code: 'SVDVD-196',
      name: 'SVDVD-196 "美しい女の子の犬、ダルマ陵の音羽レオン"',
      releaseDate: '2010-12-04',
      director: 'New Kage Kazama',
      maker: 'サディスティックヴィレッジ',
      genres: ['拘束', '辱め', '美少女', '単体作品', '調教・奴隷', '電マ'],
      cast: ['音羽レオン'],
    },
  };
}
