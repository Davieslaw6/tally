import type { SqlClient } from '../db/sql';
import type { Settings } from '../../shared/types';
import { Errors } from '../errors';
import { OWNER_ID } from './owner-service';

interface SettingsRow {
  theme: Settings['theme'];
  density: Settings['density'];
  nav_collapsed: number;
  chart_view: Settings['chartView'];
  chart_range: string;
  onboarding_completed: number;
}

export async function createSettingsDefaults(client: SqlClient, now: string): Promise<void> {
  await client
    .prepare(
      `INSERT INTO settings (id, theme, density, nav_collapsed, chart_view, chart_range, onboarding_completed, created_at, updated_at)
       VALUES (?, 'dark', 'comfortable', 0, 'bar', '6M', 0, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
    )
    .run(OWNER_ID, now, now);
}

export class SettingsService {
  constructor(private readonly client: SqlClient) {}

  private rowToDto(row: SettingsRow | undefined): Settings {
    return {
      theme: row?.theme ?? 'dark',
      density: row?.density ?? 'comfortable',
      navCollapsed: row?.nav_collapsed === 1,
      chartView: row?.chart_view ?? 'bar',
      chartRange: row?.chart_range ?? '6M',
      onboardingCompleted: row?.onboarding_completed === 1,
    };
  }

  async get(): Promise<Settings> {
    const row = (await this.client.prepare('SELECT * FROM settings WHERE id = ?').get(OWNER_ID)) as SettingsRow | undefined;
    if (!row) {
      await createSettingsDefaults(this.client, new Date().toISOString());
      return this.rowToDto(undefined);
    }
    return this.rowToDto(row);
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.get();
    const theme = patch.theme ?? current.theme;
    const density = patch.density ?? current.density;
    const chartView = patch.chartView ?? current.chartView;
    const chartRange = patch.chartRange ?? current.chartRange;
    if (!['dark', 'light', 'contrast'].includes(theme)) throw Errors.badRequest('Invalid theme.');
    if (!['comfortable', 'compact'].includes(density)) throw Errors.badRequest('Invalid density.');
    if (!['bar', 'area', 'line'].includes(chartView)) throw Errors.badRequest('Invalid chart view.');
    if (!/^(1M|3M|6M|1Y|YTD|custom)$/.test(chartRange)) throw Errors.badRequest('Invalid chart range.');

    await this.client
      .prepare(
        `UPDATE settings SET theme = ?, density = ?, nav_collapsed = ?, chart_view = ?, chart_range = ?,
           onboarding_completed = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        theme,
        density,
        patch.navCollapsed !== undefined ? (patch.navCollapsed ? 1 : 0) : current.navCollapsed ? 1 : 0,
        chartView,
        chartRange,
        patch.onboardingCompleted !== undefined ? (patch.onboardingCompleted ? 1 : 0) : current.onboardingCompleted ? 1 : 0,
        new Date().toISOString(),
        OWNER_ID,
      );
    return this.get();
  }
}
