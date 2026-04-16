import { ValidatorTestConfig } from '../base/types';

/**
 * Returns the test configuration for validating the DVD scraper.
 * Set env vars to configure:
 *   DVD_VALIDATOR_FILENAME - test filename to resolve
 *   DVD_VALIDATOR_CODE - expected code
 *   DVD_VALIDATOR_NAME - expected name
 *   DVD_VALIDATOR_RELEASE_DATE - expected release date (YYYY-MM-DD)
 *   DVD_VALIDATOR_DIRECTOR - expected director
 *   DVD_VALIDATOR_MAKER - expected maker
 *   DVD_VALIDATOR_GENRES - expected genres (comma-separated)
 *   DVD_VALIDATOR_CAST - expected cast (comma-separated)
 *   DVD_VALIDATOR_COVER_IMAGE - expected cover image URL (prefix match)
 */
export function getTestConfig(): ValidatorTestConfig | null {
  const testFilename = process.env.DVD_VALIDATOR_FILENAME;
  if (!testFilename) {
    console.log('[validator:dvd] No DVD_VALIDATOR_FILENAME configured');
    return null;
  }

  const expected: any = {};
  if (process.env.DVD_VALIDATOR_CODE) expected.code = process.env.DVD_VALIDATOR_CODE;
  if (process.env.DVD_VALIDATOR_NAME) expected.name = process.env.DVD_VALIDATOR_NAME;
  if (process.env.DVD_VALIDATOR_RELEASE_DATE) expected.releaseDate = process.env.DVD_VALIDATOR_RELEASE_DATE;
  if (process.env.DVD_VALIDATOR_DIRECTOR) expected.director = process.env.DVD_VALIDATOR_DIRECTOR;
  if (process.env.DVD_VALIDATOR_MAKER) expected.maker = process.env.DVD_VALIDATOR_MAKER;
  if (process.env.DVD_VALIDATOR_GENRES) expected.genres = process.env.DVD_VALIDATOR_GENRES.split(',').map(s => s.trim());
  if (process.env.DVD_VALIDATOR_CAST) expected.cast = process.env.DVD_VALIDATOR_CAST.split(',').map(s => s.trim());
  if (process.env.DVD_VALIDATOR_COVER_IMAGE) expected.coverImage = process.env.DVD_VALIDATOR_COVER_IMAGE;

  return { testFilename, expected };
}
