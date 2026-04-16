import cron from 'node-cron';
import { config } from '../config';
import db from '../db';
import { listScrapers, runValidation } from '../scrapers/base';

async function runAllValidations(): Promise<void> {
  const scrapers = listScrapers();
  if (scrapers.length === 0) {
    console.log('[validator] No scrapers found, skipping');
    return;
  }

  console.log(`[validator] Running validation for ${scrapers.length} scraper(s): ${scrapers.join(', ')}`);

  for (const scraperType of scrapers) {
    const row = { scraper_type: scraperType, success: 0, fields: '[]', error: null as string | null };
    try {
      const result = await runValidation(scraperType);
      if (result) {
        row.success = result.success ? 1 : 0;
        row.fields = JSON.stringify(result.fields);
        console.log(`[validator] ${scraperType}: ${result.success ? 'PASS' : 'FAIL'}`);
      } else {
        row.error = 'No test config available';
        console.log(`[validator] ${scraperType}: skipped (no test config)`);
      }
    } catch (err: any) {
      row.error = err.message;
      console.error(`[validator] ${scraperType}: ERROR — ${err.message}`);
    }
    await db('validation_results').insert(row);
  }

  // Prune old rows, keeping the latest 30 per scraper
  const keepIds = db('validation_results')
    .select('id')
    .orderBy('created_at', 'desc')
    .limit(30 * scrapers.length);
  await db('validation_results').whereNotIn('id', keepIds).del();
}

export function startValidatorScheduler(): void {
  const cronExpr = config.validatorCron;

  if (!cron.validate(cronExpr)) {
    console.error(`[validator] Invalid cron expression: "${cronExpr}", scheduler not started`);
    return;
  }

  cron.schedule(cronExpr, () => {
    runAllValidations().catch((err) => {
      console.error('[validator] Unexpected error during scheduled run:', err);
    });
  });

  console.log(`[validator] Scheduled with cron: ${cronExpr}`);
}

export async function getLatestValidationResults(): Promise<any[]> {
  const rows = await db('validation_results as vr')
    .join(
      db('validation_results')
        .select('scraper_type')
        .max('created_at as max_date')
        .groupBy('scraper_type')
        .as('latest'),
      function () {
        this.on('vr.scraper_type', 'latest.scraper_type')
          .andOn('vr.created_at', 'latest.max_date');
      },
    )
    .select('vr.*')
    .orderBy('vr.scraper_type');

  return rows.map((r: any) => ({
    ...r,
    success: !!r.success,
    fields: JSON.parse(r.fields),
  }));
}
