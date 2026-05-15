import { ValidatorTestConfig } from '../base/types';

/**
 * Test configuration for validating the JAVTrailers scraper.
 * Update the values below to match a known video on the target site.
 */
export function getTestConfig(): ValidatorTestConfig | null {
  return {
    testFilename: 'ACZD-200 test.mp4',
    expected: {
      code: 'ACZD-200',
      name: 'ACZD-200 囚われの緊縛令嬢 DIDコレクション2 - 吉根ゆりあ',
      releaseDate: '2024-09-13',
      maker: '三和出版',
      genres: ['拘束', 'SM', '放尿・お漏らし', '縛り・緊縛', 'ハイビジョン', 'M女', '4K'],
      cast: ['吉根ゆりあ', '千石もなか', '雅子りな']
    },
  };
}
