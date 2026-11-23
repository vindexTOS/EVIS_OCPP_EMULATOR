import { Global, Module } from '@nestjs/common';
import { EngineService } from './engine.service';
import { HistoryService } from './history.service';

@Global()
@Module({
  providers: [EngineService, HistoryService],
  exports: [EngineService, HistoryService],
})
export class EngineModule {}
