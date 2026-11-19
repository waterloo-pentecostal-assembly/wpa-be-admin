// The 66 books of the Protestant canon in order, with the names stored in
// series content (e.g. "Psalms", "Song of Solomon"), their USFM book IDs (the
// IDs API.Bible uses: "GEN", "1SA", "SNG"...) and common abbreviations
// accepted in typed references ("Rom 4:1-6").
//
// Ambiguous short forms are deliberately omitted or pinned to the most common
// convention (e.g. "Phil" = Philippians, "Phlm" = Philemon; "Jud" = Jude,
// "Judg"/"Jdg" = Judges).

export const BOOKS = [
    { name: 'Genesis', id: 'GEN', aliases: ['Gen', 'Ge', 'Gn'] },
    { name: 'Exodus', id: 'EXO', aliases: ['Exod', 'Exo', 'Ex'] },
    { name: 'Leviticus', id: 'LEV', aliases: ['Lev', 'Le', 'Lv'] },
    { name: 'Numbers', id: 'NUM', aliases: ['Num', 'Nu', 'Nm'] },
    { name: 'Deuteronomy', id: 'DEU', aliases: ['Deut', 'Dt', 'De'] },
    { name: 'Joshua', id: 'JOS', aliases: ['Josh', 'Jos'] },
    { name: 'Judges', id: 'JDG', aliases: ['Judg', 'Jdg', 'Jgs'] },
    { name: 'Ruth', id: 'RUT', aliases: ['Rth', 'Ru'] },
    { name: '1 Samuel', id: '1SA', aliases: ['1 Sam', '1 Sa'] },
    { name: '2 Samuel', id: '2SA', aliases: ['2 Sam', '2 Sa'] },
    { name: '1 Kings', id: '1KI', aliases: ['1 Kgs', '1 Ki'] },
    { name: '2 Kings', id: '2KI', aliases: ['2 Kgs', '2 Ki'] },
    { name: '1 Chronicles', id: '1CH', aliases: ['1 Chron', '1 Chr', '1 Ch'] },
    { name: '2 Chronicles', id: '2CH', aliases: ['2 Chron', '2 Chr', '2 Ch'] },
    { name: 'Ezra', id: 'EZR', aliases: ['Ezr'] },
    { name: 'Nehemiah', id: 'NEH', aliases: ['Neh', 'Ne'] },
    { name: 'Esther', id: 'EST', aliases: ['Esth', 'Est'] },
    { name: 'Job', id: 'JOB', aliases: ['Jb'] },
    { name: 'Psalms', id: 'PSA', aliases: ['Psalm', 'Psa', 'Ps', 'Psm'] },
    { name: 'Proverbs', id: 'PRO', aliases: ['Prov', 'Pro', 'Prv'] },
    { name: 'Ecclesiastes', id: 'ECC', aliases: ['Eccl', 'Ecc', 'Ec'] },
    { name: 'Song of Solomon', id: 'SNG', aliases: ['Song of Songs', 'Song', 'Canticles', 'Cant', 'SOS'] },
    { name: 'Isaiah', id: 'ISA', aliases: ['Isa', 'Is'] },
    { name: 'Jeremiah', id: 'JER', aliases: ['Jer', 'Je'] },
    { name: 'Lamentations', id: 'LAM', aliases: ['Lam', 'La'] },
    { name: 'Ezekiel', id: 'EZK', aliases: ['Ezek', 'Eze', 'Ezk'] },
    { name: 'Daniel', id: 'DAN', aliases: ['Dan', 'Da'] },
    { name: 'Hosea', id: 'HOS', aliases: ['Hos', 'Ho'] },
    { name: 'Joel', id: 'JOL', aliases: ['Joe', 'Jl'] },
    { name: 'Amos', id: 'AMO', aliases: ['Am'] },
    { name: 'Obadiah', id: 'OBA', aliases: ['Obad', 'Ob'] },
    { name: 'Jonah', id: 'JON', aliases: ['Jon', 'Jnh'] },
    { name: 'Micah', id: 'MIC', aliases: ['Mic', 'Mc'] },
    { name: 'Nahum', id: 'NAM', aliases: ['Nah', 'Na'] },
    { name: 'Habakkuk', id: 'HAB', aliases: ['Hab'] },
    { name: 'Zephaniah', id: 'ZEP', aliases: ['Zeph', 'Zep'] },
    { name: 'Haggai', id: 'HAG', aliases: ['Hag', 'Hg'] },
    { name: 'Zechariah', id: 'ZEC', aliases: ['Zech', 'Zec'] },
    { name: 'Malachi', id: 'MAL', aliases: ['Mal', 'Ml'] },
    { name: 'Matthew', id: 'MAT', aliases: ['Matt', 'Mt'] },
    { name: 'Mark', id: 'MRK', aliases: ['Mk', 'Mrk'] },
    { name: 'Luke', id: 'LUK', aliases: ['Lk', 'Luk'] },
    { name: 'John', id: 'JHN', aliases: ['Jn', 'Jhn'] },
    { name: 'Acts', id: 'ACT', aliases: ['Act', 'Ac'] },
    { name: 'Romans', id: 'ROM', aliases: ['Rom', 'Ro', 'Rm'] },
    { name: '1 Corinthians', id: '1CO', aliases: ['1 Cor', '1 Co'] },
    { name: '2 Corinthians', id: '2CO', aliases: ['2 Cor', '2 Co'] },
    { name: 'Galatians', id: 'GAL', aliases: ['Gal', 'Ga'] },
    { name: 'Ephesians', id: 'EPH', aliases: ['Eph', 'Ep'] },
    { name: 'Philippians', id: 'PHP', aliases: ['Phil', 'Php'] },
    { name: 'Colossians', id: 'COL', aliases: ['Col'] },
    { name: '1 Thessalonians', id: '1TH', aliases: ['1 Thess', '1 Thes', '1 Th'] },
    { name: '2 Thessalonians', id: '2TH', aliases: ['2 Thess', '2 Thes', '2 Th'] },
    { name: '1 Timothy', id: '1TI', aliases: ['1 Tim', '1 Ti'] },
    { name: '2 Timothy', id: '2TI', aliases: ['2 Tim', '2 Ti'] },
    { name: 'Titus', id: 'TIT', aliases: ['Tit'] },
    { name: 'Philemon', id: 'PHM', aliases: ['Philem', 'Phlm', 'Phm'] },
    { name: 'Hebrews', id: 'HEB', aliases: ['Heb', 'He'] },
    { name: 'James', id: 'JAS', aliases: ['Jas', 'Jam'] },
    { name: '1 Peter', id: '1PE', aliases: ['1 Pet', '1 Pe', '1 Pt'] },
    { name: '2 Peter', id: '2PE', aliases: ['2 Pet', '2 Pe', '2 Pt'] },
    { name: '1 John', id: '1JN', aliases: ['1 Jn', '1 Jhn'] },
    { name: '2 John', id: '2JN', aliases: ['2 Jn', '2 Jhn'] },
    { name: '3 John', id: '3JN', aliases: ['3 Jn', '3 Jhn'] },
    { name: 'Jude', id: 'JUD', aliases: ['Jud'] },
    { name: 'Revelation', id: 'REV', aliases: ['Rev', 'Re', 'Rv'] },
];

export const BOOK_BY_NAME = new Map(BOOKS.map((b) => [b.name, b]));
export const BOOK_BY_ID = new Map(BOOKS.map((b) => [b.id, b]));

/** Abbreviations per canonical book name, e.g. { Matthew: ['Matt', 'Mt'] }. */
export const BOOK_ABBREVIATIONS = Object.fromEntries(BOOKS.map((b) => [b.name, b.aliases]));

/** USFM book ID for a canonical book name ("1 Samuel" -> "1SA"), or null. */
export function bookIdFor(name) {
    return BOOK_BY_NAME.get(name)?.id ?? null;
}
