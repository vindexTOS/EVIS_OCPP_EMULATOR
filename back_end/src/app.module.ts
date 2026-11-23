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
    ConfigModule.forRoot({ isGlobal: true }),
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
