import { importNxPackagePath } from '@nx-console/shared/npm';
import { Logger } from '@nx-console/shared/schema';
import { exec } from 'node:child_process';

export async function nxStopDaemon(workspacePath: string, logger: Logger) {
  logger.log('stopping daemon with `nx daemon --stop`');
  const { detectPackageManager, getPackageManagerCommand } =
    await importNxPackagePath<typeof import('nx/src/utils/package-manager')>(
      workspacePath,
      'src/utils/package-manager',
      logger
    );
  const packageManagerCommands = getPackageManagerCommand(
    detectPackageManager(workspacePath)
  );
  return new Promise<undefined>((res, rej) => {
    exec(
      `${packageManagerCommands.exec} nx daemon --stop`,
      {
        cwd: workspacePath,
      },
      (err) => {
        if (err) {
          rej(err);
        } else {
          res(undefined);
        }
      }
    );
  });
}
