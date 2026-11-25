import { randomUUID } from 'crypto';
import path from 'path';

export const ALLOWED_IMAGE_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Audio types the apps can play, by the type browsers report -> [stored content type, extension]. */
export const ALLOWED_AUDIO_TYPES = {
    'audio/mpeg': ['audio/mpeg', '.mp3'],
    'audio/mp3': ['audio/mpeg', '.mp3'],
    'audio/mp4': ['audio/mp4', '.m4a'],
    'audio/x-m4a': ['audio/mp4', '.m4a'],
    'audio/m4a': ['audio/mp4', '.m4a'],
    'audio/aac': ['audio/aac', '.aac'],
    'audio/wav': ['audio/wav', '.wav'],
    'audio/x-wav': ['audio/wav', '.wav'],
    'audio/wave': ['audio/wav', '.wav'],
};

export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

/** Folder in the bucket that audio blocks' files go in. */
export const AUDIO_FOLDER = 'audio_files';

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

/** The Firebase Storage download URL for an object with a download token. */
export function downloadUrl(bucketName, objectPath, token) {
    return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

/**
 * Uploads series cover images to the Firebase Storage bucket of the
 * selected environment under bible_series/<series-slug>/, the location the
 * app reads `image_gs_location` from, and audio blocks' files under
 * audio_files/.
 */
export class StorageService {
    constructor(bucket) {
        this.bucket = bucket;
    }

    get bucketName() {
        return this.bucket.name;
    }

    /**
     * Uploads an audio block's file to audio_files/ (never overwriting) and
     * returns its download URL: a Firebase Storage URL with a download token,
     * which doesn't expire and plays without signing in, like the URLs the
     * Firebase client SDKs' getDownloadURL returns.
     *
     * @returns {Promise<{ url: string, gsUri: string, path: string, bucket: string, contentType: string, size: number }>}
     */
    async uploadAudio({ filename, contentType, buffer }) {
        const type = ALLOWED_AUDIO_TYPES[String(contentType ?? '').split(';')[0].trim().toLowerCase()];
        if (!type) throw new StorageServiceError('Only MP3, M4A, AAC or WAV audio can be uploaded', 415);
        if (!buffer?.length) throw new StorageServiceError('The audio file is empty', 400);
        if (buffer.length > MAX_AUDIO_BYTES) throw new StorageServiceError(`Audio files must be ${MAX_AUDIO_BYTES / 1024 / 1024} MB or smaller`, 413);

        const [storedType, ext] = type;
        const name = `${slugify(path.parse(String(filename ?? '')).name) || 'audio'}${ext}`;
        const objectPath = await this.#availablePath(AUDIO_FOLDER, name);
        const token = randomUUID();
        await this.bucket.file(objectPath).save(buffer, {
            resumable: false,
            contentType: storedType,
            metadata: {
                cacheControl: 'public, max-age=31536000',
                metadata: { firebaseStorageDownloadTokens: token, originalName: String(filename ?? '').slice(0, 200) },
            },
        });
        return {
            url: downloadUrl(this.bucket.name, objectPath, token),
            gsUri: `gs://${this.bucket.name}/${objectPath}`,
            path: objectPath,
            bucket: this.bucket.name,
            contentType: storedType,
            size: buffer.length,
        };
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

    // Never overwrite an existing file: a live series may be using it.
    async #availablePath(folder, name) {
        const { name: base, ext } = path.parse(name);
        for (let i = 1; i < 100; i++) {
            const candidate = `${folder}/${i === 1 ? base : `${base}_${i}`}${ext}`;
            const [exists] = await this.bucket.file(candidate).exists();
            if (!exists) return candidate;
        }
        throw new StorageServiceError('Too many files with this name', 409);
    }
}
