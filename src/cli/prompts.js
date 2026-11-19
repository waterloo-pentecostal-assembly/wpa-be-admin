// Prompt helpers shared by the admin CLI menus (inquirer 13: list prompts are
// `select`; an unknown type silently becomes a text input).

import inquirer from 'inquirer';
import ora from 'ora';

export const BACK = Symbol('back');

/**
 * Lets the user pick one option. `choices` are strings or { name, value, description }.
 * A "Back" entry is added unless `back: false`; picking it returns BACK.
 */
export async function choose(message, choices, { back = true, pageSize = 15 } = {}) {
    const items = choices.map((c) => (typeof c === 'string' ? { name: c, value: c } : c));
    if (back) items.push(new inquirer.Separator(), { name: '← Back', value: BACK });
    const { value } = await inquirer.prompt({ type: 'select', name: 'value', message, choices: items, pageSize, loop: false });
    return value;
}

export async function ask(message, { default: defaultValue, required = false, validate } = {}) {
    const { value } = await inquirer.prompt({
        type: 'input',
        name: 'value',
        message,
        default: defaultValue,
        validate: (v) => {
            if (required && !String(v).trim()) return 'Required';
            return validate ? validate(v) : true;
        },
    });
    return String(value).trim();
}

export async function askPassword(message = 'Password') {
    const { value } = await inquirer.prompt({ type: 'password', name: 'value', message, mask: '*' });
    return value;
}

export async function askNumber(message, { default: defaultValue, min = 0 } = {}) {
    const value = await ask(message, {
        default: defaultValue === undefined ? undefined : String(defaultValue),
        validate: (v) => (Number.isFinite(Number(v)) && Number(v) >= min ? true : `Enter a number ≥ ${min}`),
    });
    return Number(value);
}

/** A date typed as YYYY-MM-DD (local midnight). */
export async function askDate(message, { default: defaultValue } = {}) {
    const value = await ask(`${message} (YYYY-MM-DD)`, {
        default: defaultValue,
        required: true,
        validate: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) && !Number.isNaN(new Date(`${v.trim()}T00:00:00`).getTime()) ? true : 'Use YYYY-MM-DD'),
    });
    return new Date(`${value}T00:00:00`);
}

/** YYYY-MM-DD in local time (askDate's dates are local midnight). */
export const isoDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export async function confirm(message, { default: defaultValue = false } = {}) {
    const { value } = await inquirer.prompt({ type: 'confirm', name: 'value', message, default: defaultValue });
    return value;
}

/**
 * Confirms something that writes data. In prod the user has to type "prod".
 * @returns {Promise<boolean>}
 */
export async function confirmWrite(env, message) {
    if (env !== 'prod') return confirm(`${message}`, { default: false });
    const typed = await ask(`${message}\n  This writes to PROD. Type "prod" to continue (anything else cancels)`);
    return typed === 'prod';
}

/** Runs `fn` with a spinner; the spinner fails (and the error is rethrown) if it throws. */
export async function withSpinner(text, fn) {
    // ora loops forever on a terminal that reports 0 columns; print a plain line there.
    const spinner = ora({ text, isEnabled: Boolean(process.stderr.isTTY && process.stderr.columns > 0) }).start();
    try {
        const result = await fn();
        spinner.succeed();
        return result;
    } catch (error) {
        spinner.fail(`${text}: ${error.message}`);
        throw error;
    }
}

/**
 * Lets the user pick bible_series documents, newest first.
 * @returns {Promise<Array<{ id: string, title: string }>|typeof BACK>}
 */
export async function pickSeries(firestore, { multiple = false, message } = {}) {
    const snapshot = await withSpinner('Loading series', () => firestore.collection('bible_series').select('title', 'start_date', 'is_active').get());
    const series = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => (b.start_date?.toMillis?.() ?? 0) - (a.start_date?.toMillis?.() ?? 0));
    if (!series.length) throw new Error('There are no series in this environment');
    const label = (s) => `${s.title || '(untitled)'}${s.is_active ? ' (active)' : ''}  ${s.start_date?.toDate ? isoDate(s.start_date.toDate()) : ''}  [${s.id}]`;
    if (multiple) {
        const { value } = await inquirer.prompt({
            type: 'checkbox',
            name: 'value',
            message: message ?? 'Choose series (space to select, enter to confirm)',
            choices: series.map((s) => ({ name: label(s), value: { id: s.id, title: s.title } })),
            pageSize: 15,
            loop: false,
            required: true,
        });
        return value;
    }
    const picked = await choose(message ?? 'Choose a series', series.map((s) => ({ name: label(s), value: { id: s.id, title: s.title } })));
    return picked === BACK ? BACK : [picked];
}
