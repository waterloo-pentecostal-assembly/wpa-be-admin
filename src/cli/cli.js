// Admin CLI: npm run cli (WPA_BE_ENV=prod|dev|local_dev, default local_dev).
// Every operation is a menu entry; operations that write ask first, and in
// prod you have to type "prod".
// See https://www.twilio.com/blog/how-to-build-a-cli-with-node-js

import '../config/loadEnv.js'; // first: .env must be loaded before anything reads process.env
import { firestore, auth, env, messaging } from '../index.js';
import { DataLoaderCli } from './dataLoader.js';
import { DataFetchingCli } from './dataFetching.js';
import { DevHelpersCli } from './devHelpers.js';
import { MaintenanceCli } from './maintenance.js';
import { ScriptureCli } from './scripture.js';
import { UserManagerCli } from './userManager.js';
import { choose } from './prompts.js';
import { projectLabel } from './scriptureTasks.js';
import { DataLoaderService } from '../services/dataLoaderService.js';
import { DataFetchingService } from '../services/dataFetchingService.js';
import { DataDeletingService } from '../services/dataDeletingService.js';
import { DataManagerService } from '../services/dataManagerService.js';
import { UserManagerService } from '../services/userManagerService.js';

const EXIT = 'Exit';

class AdminCli {
    /** @param {Record<string, { run: () => Promise<void> }>} menus - label -> submenu */
    constructor(menus) {
        this.menus = menus;
    }

    async run() {
        console.log(`WPA BE admin CLI · ENV: ${env} (${projectLabel(env)})${env === 'prod' ? '  ⚠ PRODUCTION' : ''}`);
        for (;;) {
            const option = await choose(`[ENV: ${env}] Choose an option`, [...Object.keys(this.menus), EXIT], { back: false });
            if (option === EXIT) return;
            try {
                await this.menus[option].run();
            } catch (error) {
                if (error?.name === 'ExitPromptError') return; // Ctrl+C
                console.error(`\n✖ ${error.message}\n`);
            }
        }
    }
}

const userManagerService = new UserManagerService(firestore, auth, messaging);

const adminCli = new AdminCli({
    'Users': new UserManagerCli(userManagerService, env),
    'Load data': new DataLoaderCli(new DataLoaderService(firestore)),
    'Fetch data': new DataFetchingCli(new DataFetchingService(firestore), firestore),
    'Scripture (backfill, restore, proxy check)': new ScriptureCli({ firestore, env }),
    'Maintenance': new MaintenanceCli({
        dataManagerService: new DataManagerService(firestore),
        dataDeletingService: new DataDeletingService(firestore),
        env,
    }),
    'Development assist (dev only)': new DevHelpersCli(userManagerService, env),
});

adminCli.run()
    .then(() => process.exit(0))
    .catch((error) => {
        if (error?.name !== 'ExitPromptError') console.error(error);
        process.exit(error?.name === 'ExitPromptError' ? 0 : 1);
    });
