import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ENTITIES } from '../entities';

/**
 * The whole emulator lives in one SQLite file. `SQLITE_PATH` moves it;
 * ":memory:" keeps nothing (used by tests).
 */
export function databaseOptions(
  path = 'data/emulator.sqlite',
): TypeOrmModuleOptions {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  return {
    type: 'better-sqlite3',
    database: path,
    entities: ENTITIES,
    // The schema follows the entities; there is no migration history to keep.
    synchronize: true,
    enableWAL: path !== ':memory:',
  };
}
