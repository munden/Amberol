# Seed file contract

Every seed file is a single JSON object written to `db/seed/<name>.json`.
The loader (`server/src/scripts/seed.js`) reads them in filename order, resolves
slug references to database ids, and upserts idempotently — running the seed
twice must not create duplicates or change anything the second time.

Because the loader does the SQL, seed authors never write SQL and never worry
about quoting or escaping. Apostrophes in titles are ordinary JSON characters.

```jsonc
{
  "makers":  [ /* Maker  */ ],
  "series":  [ /* Series */ ],
  "people":  [ /* Person */ ],
  "records": [ /* Record */ ]
}
```

All four keys are optional; include only what the file contributes.

## Slugs are the join keys

Every entity carries a `slug`: lowercase, ASCII, hyphen-separated, globally
unique within its own type. Cross-file references use slugs, so one file may
reference a maker defined in another. Slugs are the stable identity — never
renumber or reuse one.

- makers:  `edison`, `indestructible`, `us-phonograph`
- series:  `edison-blue-amberol`, `edison-amberol-wax`, `indestructible-4-minute`
- people:  `walter-van-brunt`, `ada-jones`, `american-symphony-orchestra`
- records: `<series-slug>-<catalog-number>`, e.g. `edison-blue-amberol-2848`

## Maker

```jsonc
{
  "slug": "edison",
  "name": "Thomas A. Edison, Inc.",          // required, full legal/trading name
  "short_name": "Edison",
  "country": "United States",
  "city": "West Orange, New Jersey",
  "founded_year": 1911,
  "dissolved_year": 1929,
  "summary": "One or two sentences. Plain text, shown under the page title.",
  "history": "Multi-paragraph markdown. This is the body of the wiki page.",
  "notes": "Anything that does not belong in the narrative.",
  "links": [ /* Link */ ]
}
```

## Series

```jsonc
{
  "slug": "edison-blue-amberol",
  "maker_slug": "edison",                     // required, must resolve
  "name": "Edison Blue Amberol",              // required
  "play_minutes": 4,                          // 2 or 4
  "material": "celluloid",                    // see enum below
  "threads_per_inch": 200,                    // 100 = two-minute, 200 = four-minute
  "colour": "Blue",
  "introduced_year": 1912,
  "discontinued_year": 1929,
  "summary": "One or two sentences.",
  "description": "Multi-paragraph markdown: what it is, how it was made, how to tell it apart, what it is worth knowing about.",
  "notes": "",
  "links": [ /* Link */ ]
}
```

`material` is one of: `brown_wax`, `black_wax`, `metallic_soap`, `celluloid`,
`condensite`, `unknown`.

## Person

Covers individuals *and* ensembles; set `is_group` for the latter.

```jsonc
{
  "slug": "walter-van-brunt",
  "name": "W. Van Brunt",                     // required — the form printed on the label
  "full_name": "Walter Van Brunt",            // the canonical person
  "sort_name": "Van Brunt, Walter",
  "aliases": ["Walter Scanlan", "Walter Van Brunt"],  // pseudonyms; all are searchable
  "is_group": false,
  "birth_year": 1892,
  "death_year": 1971,
  "nationality": "American",
  "voice_or_instrument": "tenor",
  "summary": "One or two sentences.",
  "biography": "Multi-paragraph markdown.",
  "notes": "",
  "links": [ /* Link */ ]
}
```

A singer who recorded under several names gets **one** person record with the
alternates in `aliases`, not one record per pseudonym.

## Record

The master catalog entry — one per issued catalog number per series.

```jsonc
{
  "slug": "edison-blue-amberol-2848",
  "series_slug": "edison-blue-amberol",       // required; maker is inherited from it
  "catalog_number": "2848",                   // required, text — keep letters/hyphens as printed
  "matrix_number": null,
  "take": null,                               // only when two takes share a number
  "title": "Don't Bite the Hand That's Feeding You",   // required
  "subtitle": null,
  "work_type": "Song",                        // as printed: 'Fox Trot', 'Descriptive Specialty', 'Sacred'
  "genre": "Popular song",
  "language": "English",
  "credit_line": "Tenor solo with orchestra", // verbatim label wording
  "recorded_on": "1915-11-01",                // ISO date; see precision below
  "recorded_precision": "month",              // 'day' | 'month' | 'year' | 'decade'
  "recorded_place": "New York",
  "released_on": "1916-03-01",
  "released_precision": "month",
  "release_supplement": "March 1916",         // as printed in the monthly supplement
  "duration_seconds": null,
  "description": "The article body. Markdown, multiple paragraphs.",
  "notes": "Pressing variants, label differences, anything a collector should know.",
  "lyrics": null,                             // only where clearly public domain
  "trivia": null,
  "provenance": "Dubbed from the Diamond Disc master.",
  "confidence": "verified",                   // 'verified' | 'probable' | 'uncertain'
  "credits": [ /* Credit */ ],
  "links":   [ /* Link */ ]
}
```

When only the year is known, set the date to 1 January of that year and
`*_precision` to `"year"`; the UI renders "1916", not "1 January 1916".

### Credit

```jsonc
{
  "person_slug": "walter-van-brunt",   // required, must resolve to a Person
  "role": "vocalist",                  // see enum below
  "detail": "tenor",                   // optional refinement
  "billing_order": 1                   // 1 = first billed
}
```

`role` is one of: `performer`, `vocalist`, `instrumentalist`, `ensemble`,
`orchestra`, `band`, `conductor`, `composer`, `lyricist`, `arranger`,
`speaker`, `comedian`, `whistler`, `accompanist`, `announcer`, `other`.

### Link

```jsonc
{
  "kind": "audio",                     // see enum below
  "label": "Listen at the UCSB Cylinder Audio Archive",
  "url": "https://cylinders.library.ucsb.edu/...",   // must start http:// or https://
  "source_name": "UCSB Cylinder Audio Archive"
}
```

`kind` is one of: `audio`, `discography`, `encyclopedia`, `catalog_scan`,
`sheet_music`, `image`, `article`, `video`, `other`.

## Accuracy rules

This is a reference work, and a plausible invention is worse than an honest
gap. These rules are not negotiable.

1. **Never invent a catalog number, a date, or a performer.** If you do not
   know which artist is on Blue Amberol 3011, do not guess a plausible one.
   Leave the record out entirely, or include it with only the fields you are
   sure of.
2. **Mark what you are unsure of.** `confidence` defaults to `verified`. Use
   `"probable"` where a fact is well-supported but unconfirmed, and
   `"uncertain"` where it is a reasonable inference. Say which fact is
   uncertain in `notes`.
3. **Never invent a URL.** A fabricated link is the most damaging kind of
   error because it looks authoritative. Only include a URL you are confident
   resolves. Prefer stable, well-known roots:
   - UCSB Cylinder Audio Archive — `https://cylinders.library.ucsb.edu/`
   - Discography of American Historical Recordings — `https://adp.library.ucsb.edu/`
   - Wikipedia — `https://en.wikipedia.org/wiki/<Article>`
   - Internet Archive — `https://archive.org/`
   If you are not confident of a deep link, link the archive's search or root
   page with an honest label, or omit the link.
4. **Prose must be worth reading.** `description` and `history` are the body
   of an encyclopedia article, not filler. Write what a curious collector
   would want: what the record is, when and how it was made, why it matters,
   what makes a copy desirable. Two to five paragraphs for a substantial
   entry. Do not pad, and do not repeat the structured fields back as prose.
5. **No placeholder text.** Never write "TBD", "lorem ipsum", "Description
   here", or an empty-but-present string. Omit the key instead.
6. **Public domain only** for lyrics. Pre-1930 US publication is safe; when in
   doubt leave `lyrics` null.

## Validating your file

```bash
node server/src/scripts/seed.js --check db/seed/<yourfile>.json
```

This validates structure, enum values, slug resolution and URL shape without
touching the database. It must pass with no errors before the file is done.
