import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ApiModule } from './api/api.module';
import { OcppWsModule } from './ocpp-ws/ocpp-ws.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mongodb',
        url: config.get<string>(
          'MONGO_URI',
          'mongodb://localhost:27017/ocpp_emulator',
        ),
        database: config.get<string>('MONGO_DB', 'ocpp_emulator'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: true,
      }),
    }),
    ApiModule,
    OcppWsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
