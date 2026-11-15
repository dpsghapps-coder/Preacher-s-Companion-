# Preacher's Companion – hymnal database

`hymnal.db` (SQLite) holds the Presbyterian Church of Ghana hymnal in **English** and **Twi**
(850 hymns each; numbers are synchronised between the two books), extracted from the two PDFs in this repo.
For personal use only – the English book is © Registered Trustees of the Presbyterian Church of Ghana.

## Schema

| table | purpose |
|---|---|
| `hymn(number)` | 1..850, the identity shared by both languages |
| `hymn_text` | one row per hymn per language (`en`/`tw`): `scripture_raw`, **`theme`**, **`subtheme`**, `first_line`, `author_line`, `source_page`, `needs_review`, `review_notes` |
| `stanza` | ordered stanzas of a hymn text: `seq`, `kind` (`verse`/`refrain`), `verse_number` |
| `line` | ordered lines of a stanza |
| `scripture_ref` | parsed references (`book`, `chapter`, `verse_start`, `verse_end`), per hymn number |
| `stanza_text` (view) | stanza with its lines joined by newline |
| `stanza_fts` | FTS5 full-text index over stanzas, both languages |

```sql
-- hymn 79 in both languages, verse by verse
SELECT ht.language, st.verse_number, st.kind, st.body
FROM hymn_text ht JOIN stanza_text st ON st.hymn_text_id = ht.id
WHERE ht.hymn_number = 79 ORDER BY ht.language, st.seq;

-- hymns for a theme
SELECT hymn_number, first_line FROM hymn_text WHERE language='en' AND subtheme='Christmas';

-- hymns on a Bible passage
SELECT DISTINCT hymn_number FROM scripture_ref WHERE book='Psalms' AND chapter=23;

-- full-text search
SELECT hymn_number, language, verse_number FROM stanza_fts WHERE stanza_fts MATCH 'redeemer';

-- hymns whose extraction should be eyeballed against the PDF
SELECT hymn_number, language, review_notes FROM hymn_text WHERE needs_review;
```

## Rebuilding

```
python3 tools/lines.py  "PRESBY HYMN ENGLISH.pdf" build/en_lines.json   # layout-aware line extraction
python3 tools/lines.py  "PRESBY HYMN - TWI.pdf"   build/tw_lines.json
python3 tools/parse.py  en build/en_lines.json build/en_hymns.json        # hymns / stanzas / lines
python3 tools/parse.py  tw build/tw_lines.json build/tw_hymns.json
python3 tools/build_db.py hymnal.db
```
Needs `pdfplumber` and `pdftotext` (poppler).

## Notes on the Twi text
The Twi PDF uses a legacy font that stores ɔ ɛ Ɔ Ɛ as `4 1 $ !`; `tools/parse.py` decodes them.
Themes: English from the printed contents list; Twi from the section headings printed on each page.

## Web app (offline)
`app/` is a static, installable web app that reads `app/hymnal.db` in the browser (sql.js). Search by hymn number, words
(English or Twi, `ɔ`/`ɛ` optional), or Bible passage (e.g. `Psalm 23`); browse by theme; English / Twi / both; save hymns; text size; keep-screen-on.
Works offline after the first visit (service worker).

```
python3 tools/build_app_db.py        # refresh app/hymnal.db from hymnal.db
cd app && python3 -m http.server 8000   # then open http://localhost:8000
```
Host the `app/` folder on any static host (Cloudflare Pages, Netlify, GitHub Pages). Bump `V` in `app/sw.js` when the database changes.

## Library: The Shepherd's Staff
`The_Shepherds_Staff_Corrected.pdf` (Ralph Mahoney, World MAP, 1993/1999, corrected edition, 1302 pages) is converted page by page into `app/staff.db` by
`python3 tools/build_staff_db.py The_Shepherds_Staff_Corrected.pdf app/staff.db` (also builds the section index used for cross-reference links and the printed page numbers). The app's **Library** tab searches the whole book
(all words, "exact phrase", or a Bible reference like `Ps 37:5`), highlights matches, and opens any page; the book's 11 main
divisions come from the PDF's own bookmarks. It downloads once and then works offline.

Bible references and "Section C5"-style cross-references in the book are links; contents lists link to their sections.

## Gospel songs
`tools/build_gospel.py <gospel_lyrics.sqlite>` turns the blog archive (939 posts) into `tools/gospel_songs.json` — 825 songs (667 English, 158 Akan/Twi) with title, language and a link to the original post; duplicates are merged, and the two non-song posts are skipped. The source file has no lyric text, so only titles and links are kept. `build_db.py` loads them into `gospel_song`; the app's **Gospel** tab searches titles and filters by language.

### Gospel lyrics (public-domain hymns only)
Full lyrics are stored only for songs listed in `tools/gospel_pd.json` (old hymns whose authors died long ago — Ghana's copyright term is life + 70 years)
**and** whose text on the blog really is that hymn (`tools/fetch_gospel_pd.py` checks the opening and a second phrase of the real hymn, so modern songs that share a
title, such as "Holy, Holy, Holy" or "Oh Happy Day", are rejected). Result: `tools/gospel_lyrics.json` → `gospel_song.lyrics`. Every other song stays title + link.
To add a song, add a rule with its author/death year and opening words; to remove one, delete its rule and re-run both scripts.
