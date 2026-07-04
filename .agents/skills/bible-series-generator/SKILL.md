---
name: bible-series-generator
description: Converts a plain text or markdown outline of a Bible reading series into a structured JSON representation matching the WPA Bible engagement app schema.
---

# Bible Series Generator Skill

Use this skill when converting plain text/markdown Bible engagement outlines (such as `/src/data/bible_series/plain/*.md`) into structured JSON files.

## Input Format

The input is typically a markdown or plain text file outlining:
1. **Series Metadata**: Title, dates, methods, coordinators, etc.
2. **Standard Templates**: E.g., the standard reflection questions for the `reflect` content type.
3. **Daily Schedule**: A list of dates with:
   - `Read`: Scripture reference (e.g., `Num. 1:1-19`, `Ps. 119:1-8`)
   - `Listen`: (sometimes empty, indicating standard listening message for the day's scripture)
   - `Reflect`: (often pointing to the standard template)
   - `Prayer`: Bullet points containing specific prayer requests.

## Output Schema

The output must be a JSON object containing:
- `bible_series`: Object containing metadata:
  - `title` (string)
  - `sub_title` (string, optional)
  - `image_gs_location` (string: `"gs://wpa-be-app.appspot.com/bible_series/<clean_title>/<clean_title>.jpg"`)
  - `is_active` (boolean, default `false`)
  - `is_visible` (boolean, default `true` or `false`)
- `series_content`: Array of engagement objects. Each day has up to 4 engagements (typically `read`, `listen`, `reflect`, `prayer`):
  - `title` (string, typically empty `""` unless specified)
  - `date` (string, `"YYYY-MM-DD"`)
  - `content_type` (string: one of `read`, `listen`, `reflect`, `prayer`, `devotional`, `draw`, `scribe`, `memorize`)
  - `body` (array of blocks):
    - **Scripture Block**:
      ```json
      {
        "body_type": "scripture",
        "attribution": "Copyright © 1973 1978 1984 2011 by Biblica, Inc. TM\nUsed by permission. All rights reserved worldwide",
        "bible_version": "Scripture quotations taken from The Holy Bible, New International Version® NIV®",
        "scriptures": [
          {
            "book": "Exact Book Name (e.g. Numbers, Psalms)",
            "chapter": "Chapter Number (string)",
            "title": "",
            "verseRange": "Verse range string (e.g., '1-19', '20-54', '1-5, 8-12')"
          }
        ]
      }
      ```
    - **Text Block**:
      ```json
      {
        "body_type": "text",
        "paragraphs": [
          "Paragraph text..."
        ]
      }
      ```
    - **Link Block**:
      ```json
      {
        "body_type": "link",
        "text": "Link text...",
        "link": "URL..."
      }
      ```
    - **Question Block**:
      ```json
      {
        "body_type": "question",
        "questions": [
          "Question 1?",
          "Question 2?"
        ]
      }
      ```

## Rules & Best Practices

1. **Date Parsing**: 
   - The outline specifies dates (e.g. "Oct 6", "Oct 7") and a start year provided by the user. Generate the date for each day in the format "YYYY-MM-DD". Pay close attention to skipping weekend gaps or other days if they are skipped in the outline. For example, if the outline has "Oct 17 (Friday)" and then "Oct 20 (Monday)", make sure the dates correspond exactly to those calendar dates.
2. **Book Normalization**:
   - Translate all abbreviated Bible book names to their standard, exact full names matching standard spelling (e.g., "Num." -> "Numbers", "Psa." / "Pslam" -> "Psalms", "1 Ki." -> "1 Kings", "Matt." -> "Matthew").
3. **Multiple Engagements**:
   - IMPORTANT: For each day in the outline, you MUST generate multiple separate entries in the "series_content" array (typically up to 4 items: one with content_type="read", one with content_type="listen", one with content_type="reflect", and one with content_type="prayer") sharing the SAME "date". Do NOT group them together into a single "daily_plan" content_type.
4. **Content Generation Details**:
   - "read": The "body" array must contain a single block of body_type="scripture".
     - Inside this block, the "scriptures" array should list the readings.
     - If the reading specifies a chapter range (e.g. "Psalms 1-6"), the "scriptures" array MUST contain multiple objects: one for chapter "1", one for chapter "2", etc., up to chapter "6". For each chapter, set "verseRange" to "".
     - If the reading specifies a single chapter (e.g. "Psalms 1" or "Psalms 2:1-12"), the scriptures array contains one object with the correct book and chapter. If a verse range is given (e.g. "1-12"), set "verseRange" to "1-12". If no verse range is given, set "verseRange" to "".
   - "listen": The "body" array must contain:
     1. A block of body_type="text" with "paragraphs" containing: ["Tap below to listen to [Book] [Chapter/Chapters]"]
     2. ONE SINGLE block of body_type="link" containing BOTH the "text" and "link" properties in the same object. Set "text" to the title of the song/video or "[Book] [Chapter/Chapters]". Set "link" to the URL (e.g., YouTube link) provided in the outline. If no URL is provided, set "link" to "". Example structure for this ONE block: { "body_type": "link", "text": "Psalms 1-6", "link": "https://youtube.com/..." }. Do NOT split this into two separate blocks.
   - "reflect": The "body" array must contain:
     1. A block of body_type="text" with "paragraphs" containing: ["Read through [Book] [Chapter/Chapters] and reflect on the questions below."]
     2. A block of body_type="question" with "questions" containing these exact four standard WPA reflection questions:
        - "Scripture: Read [Book] [Chapter/Chapters]. Look for a verse that was meaningful to you and write it down."
        - "Observation: What is God saying to you in this scripture? Ask the Holy Spirit to teach you and reveal Jesus to you. Paraphrase and write this scripture down in your own words."
        - "Application: Personalize what you have read by asking yourself how it applies to your life right now. Perhaps it is instruction, encouragement, revelation, a new promise or corrections for an area of your life. Write down how this passage applies to you today."
        - "Prayer: This can be as simple as asking God to help you live out the truth from this passage, or it may be seeking God for a greater understanding of what He may reveal to you. Remember, prayer is a two-way conversation, so be sure to listen to what God has to say! Now write it down."
   - "prayer": The "body" array must contain:
     1. A block of body_type="text" with "paragraphs" containing: ["After reading through [Book] [Chapter/Chapters], please pray the following prayer points."]
     2. A block of body_type="text" with "paragraphs" containing the list of prayer points from the outline.
5. **Series Metadata**:
   - title: The title of the series (e.g. "Psalms").
   - sub_title: Any subtitle, or empty string.
   - image_gs_location: "gs://wpa-be-app.appspot.com/bible_series/[clean_title]/[clean_title].jpg" where [clean_title] is the title in lowercase and clean (alphanumeric and underscores).
   - is_active: false.
   - is_visible: false.
