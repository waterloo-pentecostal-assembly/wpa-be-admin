const fs = require('fs');

const formattedBible = {};
const data = fs.readFileSync('data/nivUnformatted.json');
const bibleData = JSON.parse(data);

const booksInOrder = [
    "Genesis",
    "Exodus",
    "Leviticus",
    "Numbers",
    "Deuteronomy",
    "Joshua",
    "Judges",
    "Ruth",
    "1 Samuel",
    "2 Samuel",
    "1 Kings",
    "2 Kings",
    "1 Chronicles",
    "2 Chronicles",
    "Ezra",
    "Nehemiah",
    "Esther",
    "Job",
    "Psalms",
    "Proverbs",
    "Ecclesiastes",
    "Song of Solomon",
    "Isaiah",
    "Jeremiah",
    "Lamentations",
    "Ezekiel",
    "Daniel",
    "Hosea",
    "Joel",
    "Amos",
    "Obadiah",
    "Jonah",
    "Micah",
    "Nahum",
    "Habakkuk",
    "Zephaniah",
    "Haggai",
    "Zechariah",
    "Malachi",
    "Matthew",
    "Mark",
    "Luke",
    "John",
    "Acts",
    "Romans",
    "1 Corinthians",
    "2 Corinthians",
    "Galatians",
    "Ephesians",
    "Philippians",
    "Colossians",
    "1 Thessalonians",
    "2 Thessalonians",
    "1 Timothy",
    "2 Timothy",
    "Titus",
    "Philemon",
    "Hebrews",
    "James",
    "1 Peter",
    "2 Peter",
    "1 John",
    "2 John",
    "3 John",
    "Jude",
    "Revelation",
];

// console.log(bibleData);

const books = bibleData.bible.b;

books.forEach((book, bindex) => {
    const b = booksInOrder[bindex];
    formattedBible[b] = {};
    let chapters = book.c;

    if (!Array.isArray(chapters)) {
        chapters = [chapters];
    }

    chapters.forEach((chapter, cindex) => {
        const verses = chapter.v;
        formattedBible[b][cindex + 1] = {};
        verses.forEach((verse, vindex) => {
            formattedBible[b][cindex + 1][vindex + 1] = verse;
        });
    });
});

fs.writeFileSync('data/niv.json', JSON.stringify(formattedBible));