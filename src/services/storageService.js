import path from 'path';

export const ALLOWED_IMAGE_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class StorageServiceError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'StorageServiceError';
        this.status = status;
    }
}

export function slugify(value) {
    return String(value ?? '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60);
}

/** Safe object name for an uploaded file, keeping a sensible extension. */
export function safeFileName(filename, contentType) {
    const ext = ALLOWED_IMAGE_TYPES[contentType];
    const base = slugify(path.parse(String(filename ?? '')).name) || 'cover';
    return `${base}${ext}`;
}

/**
 * Uploads series cover images to the Firebase Storage bucket of the
 * selected environment under bible_series/<series-slug>/, the location the
 * app reads `image_gs_location` from.
 */
export class StorageService {
    constructor(bucket) {
        this.bucket = bucket;
    }

    get bucketName() {
        return this.bucket.name;
    }

    async uploadSeriesImage({ seriesTitle, filename, contentType, buffer }) {
        if (!ALLOWED_IMAGE_TYPES[contentType]) {
            throw new StorageServiceError('Only JPEG, PNG, WebP or GIF images can be uploaded', 415);
        }
        if (!buffer?.length) throw new StorageServiceError('The image is empty', 400);
        if (buffer.length > MAX_IMAGE_BYTES) throw new StorageServiceError('Images must be 10 MB or smaller', 413);

        const folder = `bible_series/${slugify(seriesTitle) || 'untitled'}`;
        const name = safeFileName(filename, contentType);
        const objectPath = await this.#availablePath(folder, name);

        await this.bucket.file(objectPath).save(buffer, {
            resumable: false,
            contentType,
            metadata: { cacheControl: 'public, max-age=31536000' },
        });
        return { gsUri: `gs://${this.bucket.name}/${objectPath}`, path: objectPath, bucket: this.bucket.name };
    }

    /** Short-lived https URL for showing a gs:// image in the browser. */
    async previewUrl(gsUri) {
        const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(gsUri ?? '');
        if (!match) throw new StorageServiceError('Not a gs:// location', 400);
        const [, bucketName, objectPath] = match;
        const bucket = bucketName === this.bucket.name ? this.bucket : this.bucket.storage.bucket(bucketName);
        const file = bucket.file(objectPath);
        const [exists] = await file.exists();
        if (!exists) throw new StorageServiceError('Image not found in storage', 404);
        const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 60 * 60 * 1000 });
        return url;
    }

    // Never overwrite an existing image: a live series may be using it.
    async #availablePath(folder, name) {
        const { name: base, ext } = path.parse(name);
        for (let i = 1; i < 100; i++) {
            const candidate = `${folder}/${i === 1 ? base : `${base}_${i}`}${ext}`;
            const [exists] = await this.bucket.file(candidate).exists();
            if (!exists) return candidate;
        }
        throw new StorageServiceError('Too many images with this name', 409);
    }
}
