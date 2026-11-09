// Engagement types offered by the builder, with the default template each
// starts from. `{scripture}` in text is replaced with the day's reading.

export const SCRIPTURE_TOKEN = '{scripture}';

const SOAP_QUESTIONS = [
    'Scripture: Read {scripture}. Look for a verse that was meaningful to you and write it down',
    'Observation: What is God saying to you in this scripture? Ask the Holy Spirit to teach you and reveal Jesus to you. Paraphrase and write this scripture down in your own words.',
    'Application: Personalize what you have read by asking yourself how it applies to your life right now. Perhaps it is instruction, encouragement, revelation, a new promise or corrections for an area of your life. Write down how this passage applies to you today.',
    'Prayer: This can be as simple as asking God to help you live out the truth from this passage, or it may be seeking God for a greater understanding of what He may reveal to you. Remember, prayer is a two-way conversation, so be sure to listen to what God has to say! Now write it down.',
].join('\n');

// `blocks` omit ids; createTemplate() assigns them.
export const ENGAGEMENT_TYPES = [
    {
        id: 'read', label: 'Read', color: 'emerald',
        blocks: [
            { kind: 'text', text: 'Please read the passage for today below.' },
            { kind: 'scripture', source: 'reading' },
        ],
    },
    {
        id: 'reflect', label: 'Reflect', color: 'amber',
        blocks: [
            { kind: 'text', text: 'After reading today’s scripture ({scripture}), reflect on the questions below.' },
            { kind: 'question', text: SOAP_QUESTIONS },
        ],
    },
    {
        id: 'prayer', label: 'Prayer', color: 'violet',
        blocks: [
            { kind: 'text', text: 'After reading through {scripture}, please pray the following prayer points.' },
            { kind: 'text', text: '', perDay: true, placeholder: '- Pray that…' },
        ],
    },
    {
        id: 'memorize', label: 'Memorize', color: 'sky',
        blocks: [
            { kind: 'text', text: 'Read the verse below and memorize it.' },
            { kind: 'scripture', source: 'passage', ref: '', perDay: true },
        ],
    },
    {
        id: 'worship', label: 'Worship', color: 'rose',
        blocks: [
            { kind: 'text', text: 'After you have read the passage for today ({scripture}), please listen to this song below:' },
            { kind: 'link', text: '', url: '', perDay: true },
        ],
    },
    {
        id: 'listen', label: 'Listen', color: 'blue',
        blocks: [
            { kind: 'text', text: 'Tap below to listen to the song.' },
            { kind: 'link', text: '', url: '', perDay: true },
        ],
    },
    {
        id: 'devotional', label: 'Devotional', color: 'orange',
        blocks: [
            { kind: 'text', text: 'After reading today’s passage, please read the devotional below.' },
            { kind: 'text', text: '', perDay: true, placeholder: 'Devotional text (one paragraph per line)…' },
        ],
    },
    {
        id: 'draw', label: 'Draw', color: 'pink',
        blocks: [
            { kind: 'text', text: 'Read {scripture}. Using this portion of scripture, illustrate the imagery of the passage.' },
            { kind: 'text', text: 'Upload a photo of your drawing!' },
            { kind: 'image_input' },
        ],
    },
    {
        id: 'scribe', label: 'Scribe', color: 'teal',
        blocks: [
            { kind: 'text', text: 'Write out {scripture} by hand, then upload a photo of your page.' },
            { kind: 'scripture', source: 'reading' },
            { kind: 'image_input' },
        ],
    },
    {
        id: 'pray', label: 'Pray', color: 'purple',
        blocks: [
            { kind: 'text', text: 'After reading {scripture}, spend some time in prayer.' },
            { kind: 'text', text: '', perDay: true, placeholder: '- Pray that…' },
        ],
    },
];

export const TYPE_BY_ID = Object.fromEntries(ENGAGEMENT_TYPES.map((t) => [t.id, t]));

export function typeLabel(typeId) {
    return TYPE_BY_ID[typeId]?.label ?? typeId;
}

// Static class names so Tailwind can see them.
const COLOR_CLASSES = {
    emerald: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', ring: 'ring-emerald-500', bar: 'border-l-emerald-500' },
    amber: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 ring-amber-200', ring: 'ring-amber-500', bar: 'border-l-amber-500' },
    violet: { dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 ring-violet-200', ring: 'ring-violet-500', bar: 'border-l-violet-500' },
    sky: { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 ring-sky-200', ring: 'ring-sky-500', bar: 'border-l-sky-500' },
    rose: { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 ring-rose-200', ring: 'ring-rose-500', bar: 'border-l-rose-500' },
    blue: { dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 ring-blue-200', ring: 'ring-blue-500', bar: 'border-l-blue-500' },
    orange: { dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700 ring-orange-200', ring: 'ring-orange-500', bar: 'border-l-orange-500' },
    pink: { dot: 'bg-pink-500', chip: 'bg-pink-50 text-pink-700 ring-pink-200', ring: 'ring-pink-500', bar: 'border-l-pink-500' },
    teal: { dot: 'bg-teal-500', chip: 'bg-teal-50 text-teal-700 ring-teal-200', ring: 'ring-teal-500', bar: 'border-l-teal-500' },
    purple: { dot: 'bg-purple-500', chip: 'bg-purple-50 text-purple-700 ring-purple-200', ring: 'ring-purple-500', bar: 'border-l-purple-500' },
    gray: { dot: 'bg-gray-400', chip: 'bg-gray-50 text-gray-700 ring-gray-200', ring: 'ring-gray-400', bar: 'border-l-gray-400' },
};

export function typeColors(typeId) {
    return COLOR_CLASSES[TYPE_BY_ID[typeId]?.color ?? 'gray'];
}
