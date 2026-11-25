// In-memory stand-in for the Firestore APIs used on bible_series, its
// series_content subcollection, completions and the drafts collection.

// Equality, or a range comparison on numbers, Dates and Timestamps (a missing field never matches a range).
const comparable = (v) => v?.toMillis?.() ?? (v instanceof Date ? v.getTime() : v);
function matches(actual, op, expected) {
    if (op === '==') return actual === expected;
    if (actual === undefined || actual === null) return false;
    const [a, b] = [comparable(actual), comparable(expected)];
    switch (op) {
        case '<': return a < b;
        case '<=': return a <= b;
        case '>': return a > b;
        case '>=': return a >= b;
        default: throw new Error(`memoryFirestore: unsupported where op ${op}`);
    }
}

export function memoryFirestore() {
    const store = new Map(); // document path -> data
    let counter = 0;
    const snapshot = (path) => ({ id: path.split('/').at(-1), exists: store.has(path), data: () => (store.has(path) ? { ...store.get(path) } : undefined) });
    const docRef = (path) => ({
        id: path.split('/').at(-1),
        path,
        get: async () => snapshot(path),
        set: async (data) => { store.set(path, { ...data }); },
        update: async (patch) => {
            if (!store.has(path)) throw new Error(`No document to update: ${path}`);
            store.set(path, { ...store.get(path), ...patch });
        },
        delete: async () => { store.delete(path); },
        collection: (name) => collection(`${path}/${name}`),
    });
    const collection = (path) => {
        const children = () => [...store.keys()].filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'));
        const query = (filter = () => true, order = null) => ({
            where: (field, op, value) => query((d) => filter(d) && matches(d[field], op, value), order),
            select: () => query(filter, order),
            orderBy: (field, dir) => query(filter, { field, dir }),
            limit: () => query(filter, order),
            count: () => ({ get: async () => {
                const count = children().map(snapshot).filter((snap) => filter(snap.data())).length;
                return { data: () => ({ count }) };
            } }),
            get: async () => {
                let docs = children().map(snapshot).filter((s) => filter(s.data()));
                if (order) {
                    // Like Firestore, ordering by a field leaves out documents without it.
                    const value = (s) => { const v = s.data()[order.field]; return v?.toMillis?.() ?? v; };
                    docs = docs.filter((s) => value(s) !== undefined)
                        .sort((a, b) => (order.dir === 'desc' ? -1 : 1) * (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0));
                }
                return { docs, empty: !docs.length, forEach: (fn) => docs.forEach(fn) };
            },
        });
        return {
            ...query(),
            // Like Firestore, includes documents that only exist as parents of subcollections.
            listDocuments: async () => [...new Set([...store.keys()]
                .filter((k) => k.startsWith(`${path}/`))
                .map((k) => k.slice(path.length + 1).split('/')[0]))].map((id) => docRef(`${path}/${id}`)),
            doc: (id) => docRef(`${path}/${id ?? `auto${String(++counter).padStart(4, '0')}`}`),
            add: async (data) => {
                const ref = docRef(`${path}/auto${String(++counter).padStart(4, '0')}`);
                await ref.set(data);
                return ref;
            },
        };
    };
    const batches = [];
    return {
        store,
        batches,
        collection,
        batch: () => {
            const ops = [];
            return {
                set: (ref, data) => ops.push(() => ref.set(data)),
                update: (ref, patch) => ops.push(() => ref.update(patch)),
                delete: (ref) => ops.push(() => ref.delete()),
                commit: async () => {
                    batches.push(ops.length);
                    for (const op of ops) await op();
                },
            };
        },
        // Firestore's BulkWriter: update fails on a missing document, like Firestore.
        bulkWriter: () => {
            const pending = [];
            return {
                update: (ref, data) => {
                    const write = ref.update(data).catch((error) => {
                        throw Object.assign(new Error(error.message), { code: 5 });
                    });
                    pending.push(write.catch(() => {}));
                    return write;
                },
                close: async () => { await Promise.all(pending); },
            };
        },
        // Deletes a document and everything under it.
        recursiveDelete: async (ref) => {
            for (const key of [...store.keys()]) if (key === ref.path || key.startsWith(`${ref.path}/`)) store.delete(key);
        },
        runTransaction: async (fn) => fn({
            get: (ref) => ref.get(),
            set: (ref, data) => { store.set(ref.path, { ...data }); },
        }),
    };
}
