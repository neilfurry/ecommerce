import { type CanActivate, HttpStatus, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';

/**
 * Hides the developer tools completely unless DEV_TOOLS_ENABLED=true (which the config
 * schema forbids in production): disabled routes answer 404 as if they did not exist.
 */
@Injectable()
export class DevToolsEnabledGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (!this.config.devToolsEnabled) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
    }
    return true;
  }
}
