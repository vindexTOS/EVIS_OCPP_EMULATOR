import { Controller, Get } from '@nestjs/common';
import {
  CONNECTOR_STATUSES,
  CONNECTOR_TYPE_INFO,
  CONNECTOR_TYPES,
  ERROR_CODES,
  STOP_REASONS,
} from '../../entities/enums';
import {
  FEATURE_PROFILES,
  SUPPORTED_MEASURANDS,
} from '../../engine/ocpp16/config-keys';

/** The fixed vocabulary of the emulator, for any client that wants to list it. */
@Controller('meta')
export class MetaController {
  @Get()
  meta() {
    return {
      ocppVersion: '1.6',
      connectorTypes: CONNECTOR_TYPES.map((type) => ({
        type,
        ...CONNECTOR_TYPE_INFO[type],
      })),
      connectorStatuses: CONNECTOR_STATUSES,
      errorCodes: ERROR_CODES,
      stopReasons: STOP_REASONS,
      featureProfiles: FEATURE_PROFILES,
      measurands: SUPPORTED_MEASURANDS,
    };
  }
}
