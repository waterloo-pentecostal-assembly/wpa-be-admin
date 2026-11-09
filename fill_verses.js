import fs from 'fs';

const gptPath = 'src/data/bible_series/psalms-gpt.json';
const psalmsPath = 'src/data/psalms.json';

const gptData = JSON.parse(fs.readFileSync(gptPath, 'utf8'));
const psalmsData = JSON.parse(fs.readFileSync(psalmsPath, 'utf8'));

let filledCount = 0;

gptData.series_content.forEach(day => {
    if (day.body) {
        day.body.forEach(block => {
            if (block.body_type === 'scripture' && block.scriptures) {
                block.scriptures.forEach(sc => {
                    if (sc.book === 'Psalms' && sc.chapter && sc.verses && Object.keys(sc.verses).length === 0) {
                        const chapterData = psalmsData['Psalms'][sc.chapter];
                        if (chapterData) {
                            sc.verses = chapterData;
                            filledCount++;
                        }
                    }
                });
            }
        });
    }
});

fs.writeFileSync(gptPath, JSON.stringify(gptData, null, 4));
console.log(`Filled verses for ${filledCount} scripture blocks.`);
