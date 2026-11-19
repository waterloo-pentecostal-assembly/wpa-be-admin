import { BACK, ask, askNumber, askPassword, choose, confirm, confirmWrite, pickSeries } from './prompts.js';
import {
    listBackups, projectLabel, restoreScriptureBackup, runBibleProxyCheck, runScriptureBackfill, signInForScripture,
    signOutOfScripture,
} from './scriptureTasks.js';

/**
 * Scripture tools: backfill stored scripture through the Bible proxy, restore
 * a backfill backup, and check access to the proxy. The proxy only serves
 * admins, so the first of these signs in. The sign-in is saved for later runs
 * (see promptAdminSignIn) until "Sign out of the Bible proxy".
 */
export class ScriptureCli {
    /**
     * @param {{ firestore: import('firebase-admin').firestore.Firestore, env: string }} deps
     */
    constructor({ firestore, env }) {
        this.firestore = firestore;
        this.env = env;
        this.session = null;
    }

    async run() {
        const actions = {
            'Backfill scripture: dry run (report only)': () => this.backfill({ apply: false }),
            'Backfill scripture: apply  [writes, saves a backup first]': () => this.backfill({ apply: true }),
            'Restore a backfill backup  [writes]': () => this.restore(),
            'Check Bible proxy access': () => this.checkProxy(),
            'Sign out of the Bible proxy (forget the saved sign-in)': () => this.signOut(),
        };
        const option = await choose(`Scripture (${projectLabel(this.env)}): choose an option`, Object.keys(actions));
        if (option === BACK) return;
        await actions[option]();
    }

    signOut() {
        this.session = null;
        const { projectId, forgotten } = signOutOfScripture();
        console.log(forgotten ? `Signed out: the saved sign-in for ${projectId} is deleted.` : `No saved sign-in for ${projectId}.`);
    }

    async signIn() {
        if (this.session) return this.session;
        this.session = await signInForScripture({
            askEmail: () => ask('Admin email', { required: true }),
            askPassword: (email) => askPassword(`Password for ${email}`),
        });
        return this.session;
    }

    async backfill({ apply }) {
        const scope = await choose('Which series?', [
            { name: 'All series', value: 'all' },
            { name: 'Choose series…', value: 'some' },
        ]);
        if (scope === BACK) return;
        let seriesIds = null;
        if (scope === 'some') {
            const picked = await pickSeries(this.firestore, { multiple: true });
            if (picked === BACK || !picked.length) return;
            seriesIds = picked.map((s) => s.id);
        }
        const bibleId = await ask('Translation (API.Bible ID)', { default: process.env.API_BIBLE_DEFAULT_BIBLE_ID || undefined, required: !process.env.API_BIBLE_DEFAULT_BIBLE_ID });
        const force = await confirm('Also redo series already recorded in this translation?', { default: false });
        const maxCalls = await askNumber('Stop if more chapter fetches than this could be needed', { default: 1000, min: 1 });
        const verbose = await confirm('List every entry that changes?', { default: false });

        const session = await this.signIn();
        const result = await runScriptureBackfill({
            firestore: this.firestore,
            env: this.env,
            session,
            bibleId,
            seriesIds,
            apply,
            force,
            maxCalls,
            verbose,
            confirmWrite: (message) => confirmWrite(this.env, message),
        });
        if (!apply && (result.updates || result.series)) console.log('Run "Backfill scripture: apply" to write these changes.');
        if (result.backupFile) console.log('To undo: Scripture → Restore a backfill backup.');
    }

    async restore() {
        const backups = listBackups(this.env);
        if (!backups.length) {
            console.log(`No backfill backups for ${this.env} in backups/.`);
            return;
        }
        const file = await choose('Backup to restore', backups.map((b) => ({
            name: `${b.createdAt}  ${b.entries} entries, ${b.series} series  (${b.name})`,
            value: b.file,
        })));
        if (file === BACK) return;
        await restoreScriptureBackup({
            firestore: this.firestore,
            env: this.env,
            file,
            confirmWrite: (message) => confirmWrite(this.env, message),
        });
    }

    async checkProxy() {
        const bibleId = await ask('Translation to check (blank = default)', { default: process.env.API_BIBLE_DEFAULT_BIBLE_ID || '' });
        let nonAdmin = null;
        if (await confirm('Also check that a non-admin account gets 403?', { default: false })) {
            const email = await ask('Non-admin email', { required: true });
            nonAdmin = { email, password: await askPassword(`Password for ${email}`) };
        }
        const showRoutes = await confirm('Print the proxy\'s route allowlist (/admin/routes)?', { default: false });
        const session = await this.signIn();
        await runBibleProxyCheck({ bibleId: bibleId || undefined, session, nonAdmin, showRoutes });
    }
}
