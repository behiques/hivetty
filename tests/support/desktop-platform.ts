import { createDesktopPlatform } from '../../electron/main/platform';
import { setPlatform } from '../../core/platform';

/**
 * Install the desktop's platform over whatever `electron` mock the suite set
 * up (HIVE-422). Core reads the platform where it used to import Electron, so a
 * suite that mocks `electron` and reaches one of those reads calls this in its
 * `beforeEach`. The adapter reads every Electron export lazily, so a mock that
 * leaves exports out still installs.
 */
export function installDesktopPlatform(): void {
  setPlatform(createDesktopPlatform());
}
