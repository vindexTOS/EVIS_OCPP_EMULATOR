import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiModule } from './api/api.module';
import { databaseOptions } from './config/database';
import { EngineModule } from './engine/engine.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    // back_end/.env first, then the repository's shared .env (the UI reads it too).
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env'] }),
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        databaseOptions(
          config.get<string>('SQLITE_PATH', 'data/emulator.sqlite'),
        ),
    }),
    EngineModule,
    ApiModule,
    RealtimeModule,
  ],
})
export class AppModule {}
