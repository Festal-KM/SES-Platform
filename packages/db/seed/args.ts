// packages/db/seed/args.ts
// CLI の引数・環境変数の解釈（`pnpm seed --preset=isolation --reset`。docs/05 §13.6）。
// 🔴 純粋関数として切り出し、CLI 本体（cli.ts）は「解釈 → 実行 → 終了コード」だけにする
//    （引数の解釈をテストできるようにするため）。
import { SEED_PRESET_NAMES, type SeedPresetName } from './types.js';

export type SeedArgs = {
  readonly preset: SeedPresetName;
  readonly reset: boolean;
  /** `--reset-only`: 削除だけを行い、投入しない。 */
  readonly resetOnly: boolean;
  readonly help: boolean;
};

export class SeedArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedArgsError';
  }
}

/**
 * 🔴 既定値を持たせない引数: `--preset`。
 *    「省略したら isolation」等の既定を置くと、意図しない母集団を本番相当の DB に投入する
 *    事故の入口になる。必ず明示させる。
 */
export function parseSeedArgs(argv: readonly string[]): SeedArgs {
  let preset: string | undefined;
  let reset = false;
  let resetOnly = false;
  let help = false;

  for (const raw of argv) {
    if (raw === '--help' || raw === '-h') {
      help = true;
      continue;
    }
    if (raw === '--reset') {
      reset = true;
      continue;
    }
    if (raw === '--reset-only') {
      resetOnly = true;
      continue;
    }
    if (raw.startsWith('--preset=')) {
      preset = raw.slice('--preset='.length);
      continue;
    }
    throw new SeedArgsError(
      `不明な引数です: ${raw}（使い方: pnpm seed --preset=${SEED_PRESET_NAMES.join('|')} [--reset|--reset-only]）`,
    );
  }

  if (help) {
    return { preset: 'isolation', reset: false, resetOnly: false, help: true };
  }
  if (preset === undefined) {
    throw new SeedArgsError(
      `--preset を指定してください（${SEED_PRESET_NAMES.join(' | ')}）。既定値はありません。`,
    );
  }
  if (!(SEED_PRESET_NAMES as readonly string[]).includes(preset)) {
    throw new SeedArgsError(
      `--preset の値が不正です: ${preset}（${SEED_PRESET_NAMES.join(' | ')}）。`,
    );
  }
  return { preset: preset as SeedPresetName, reset, resetOnly, help: false };
}

export const SEED_DATABASE_URL_VAR = 'SEED_DATABASE_URL';

/**
 * 🔴 投入・削除に使う特権接続の接続文字列。
 *
 * `MIGRATION_DATABASE_URL` と同じ扱いで、**アプリの実行時環境には置かない**
 * （`packages/config` の `envSchema` にも載せない。載せると「アプリのプロセスが
 * 分離を素通りできる接続文字列を持っている」状態を常態化させてしまう）。
 * シードを実行するコマンドの直前にだけ指定する。
 */
export function resolveSeedDatabaseUrl(
  source: Readonly<Record<string, string | undefined>>,
): string {
  const url = source[SEED_DATABASE_URL_VAR];
  if (url === undefined || url === '') {
    throw new SeedArgsError(
      `${SEED_DATABASE_URL_VAR} が未設定です。合成データの投入・削除には、RLS の適用ポリシーを` +
        '持たない特権接続（ローカルの PostgreSQL スーパーユーザー）が要ります' +
        '（app_tenant は tenants に INSERT できず、app_migrator も FORCE ROW LEVEL SECURITY で' +
        '読み書きできません。docs/05 §4.2 / §4.4）。',
    );
  }
  return url;
}

export function seedUsage(): string {
  return [
    '使い方: pnpm seed --preset=<preset> [--reset|--reset-only]',
    '',
    `  --preset=<${SEED_PRESET_NAMES.join('|')}>  投入するプリセット（必須。既定値なし）`,
    '  --reset                          投入前に対象テナントの業務データを削除する',
    '  --reset-only                     削除だけを行い、投入しない',
    '',
    '環境変数:',
    '  APP_ENV                          🔴 demo / development のときだけ実行できる（F-053 AC-6）',
    `  ${SEED_DATABASE_URL_VAR}              特権接続の接続文字列（アプリの DATABASE_URL とは別）`,
  ].join('\n');
}
