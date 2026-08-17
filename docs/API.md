# API contract

Base URL `/api`. JSON in, JSON out, UTF-8. Uploaded images are served as static
files from `/uploads/...`.

This document is binding on both sides: the server implements exactly these
shapes, and the front end may assume exactly these shapes. If something here
is wrong or missing, change this file first and say so, rather than diverging.

## Envelopes

Every successful response carries its payload under `data`.

```jsonc
// single resource
{ "data": { … } }

// collection
{ "data": [ … ], "page": 1, "pageSize": 50, "total": 412, "totalPages": 9 }
```

Errors use the matching HTTP status and this body:

```jsonc
{ "error": { "message": "Human-readable sentence.", "code": "not_found",
             "details": { "field": "why" } } }
```

Codes: `bad_request` (400), `not_found` (404), `conflict` (409),
`unprocessable` (422), `payload_too_large` (413), `server_error` (500).
`details` is present only for validation failures, keyed by field path.

## Conventions

- Dates are `YYYY-MM-DD`; timestamps are ISO 8601 with offset.
- A date field is always paired with its `*_precision` (`day`/`month`/`year`/`decade`).
  Render accordingly: precision `year` means show `1916`, not `1 January 1916`.
- `page` is 1-based. `pageSize` defaults to 50, maximum 200.
- Anything addressable by `:id` also accepts its `slug`.
- Omitted optional fields on `PATCH` are left unchanged. Sending `null`
  explicitly clears a field.

---

# Catalog — the master list

### `GET /api/catalog`

The searchable master list. Every parameter is optional and they combine with AND.

| param | type | meaning |
|---|---|---|
| `q` | string | Free text across **all** indexed fields: title, subtitle, catalog and matrix numbers, performer and composer names and their aliases, credit line, series, maker, genre, place, description, notes, lyrics, trivia, provenance, link labels. |
| `maker` | slug or id | Restrict to one maker. Repeatable. |
| `series` | slug or id | Restrict to one series. Repeatable. |
| `person` | slug or id | Credited person. Repeatable. |
| `genre` | string | Exact match. Repeatable. |
| `material` | enum | `celluloid`, `black_wax`, … |
| `playMinutes` | `2` \| `4` | Series playing time. |
| `yearFrom`, `yearTo` | integer | Release year range; falls back to recording year where release is unknown. |
| `confidence` | enum | `verified` \| `probable` \| `uncertain`. Repeatable. |
| `owned` | `true` \| `false` | Only titles the collector owns, or only ones they do not. |
| `hasAudio` | `true` | Only records carrying a link of kind `audio`. |
| `sort` | enum | `relevance` (default when `q` present), `catalog` (default otherwise), `title`, `year`, `newest`, `maker`. Prefix `-` to reverse, e.g. `-year`. |
| `page`, `pageSize` | integer | Pagination. |

**Search behaviour.** `q` runs as a weighted full-text query with prefix
matching, so `bru` finds *Van Brunt* and `feed` finds *Feeding*. When full-text
returns nothing, the server retries with trigram word-similarity so
misspellings still land — `feding` finds *Feeding*. The response reports which
path produced the results.

```jsonc
{
  "data": [ /* CatalogSummary */ ],
  "page": 1, "pageSize": 50, "total": 412, "totalPages": 9,
  "matchMode": "fulltext",     // "fulltext" | "fuzzy" | "none"
  "facets": {                   // counts across the whole filtered set, not the page
    "makers":  [ { "slug": "edison", "name": "Thomas A. Edison, Inc.", "count": 300 } ],
    "series":  [ { "slug": "edison-blue-amberol", "name": "Edison Blue Amberol", "count": 240 } ],
    "genres":  [ { "value": "Popular song", "count": 96 } ],
    "decades": [ { "value": 1910, "count": 180 } ]
  }
}
```

**CatalogSummary** — the list row:

```jsonc
{
  "id": 128, "slug": "edison-blue-amberol-2848",
  "catalogNumber": "2848", "title": "Don't Bite the Hand That's Feeding You",
  "subtitle": null, "genre": "Popular song", "workType": "Song",
  "creditLine": "Tenor solo with orchestra",
  "performers": "W. Van Brunt", "authors": "Jimmie Morgan, Thomas Hoier",
  "releasedOn": "1916-03-01", "releasedPrecision": "month",
  "releaseSupplement": "March 1916",
  "recordedOn": null, "recordedPrecision": null,
  "description": "…",             // full text; the list shows an excerpt
  "confidence": "verified", "isStub": false,
  "maker":  { "id": 1, "slug": "edison", "name": "Thomas A. Edison, Inc." },
  "series": { "id": 3, "slug": "edison-blue-amberol", "name": "Edison Blue Amberol",
              "material": "celluloid", "playMinutes": 4, "colour": "Blue" },
  "primaryImageUrl": "/uploads/…",  // or null
  "linkCount": 3,
  "ownedCount": 1,                  // copies of this title in the collection
  "rank": 0.83                      // present when sorted by relevance
}
```

### `GET /api/catalog/:idOrSlug`

The full record page.

```jsonc
{ "data": {
  /* every CatalogSummary field, plus: */
  "matrixNumber": null, "take": null, "language": "English",
  "recordedPlace": "New York", "durationSeconds": null,
  "notes": "…", "lyrics": null, "trivia": null, "provenance": "…",
  "withdrawnOn": null,
  "credits": [
    { "id": 9, "role": "vocalist", "detail": "tenor", "billingOrder": 1,
      "person": { "id": 4, "slug": "walter-van-brunt", "name": "W. Van Brunt",
                  "fullName": "Walter Van Brunt", "isGroup": false,
                  "voiceOrInstrument": "tenor", "summary": "…" } }
  ],
  "links": [ { "id": 3, "kind": "audio", "label": "Listen at the Cylinder Audio Archive",
               "url": "https://…", "sourceName": "UCSB Cylinder Audio Archive" } ],
  "images": [ { "id": 7, "url": "/uploads/…", "thumbUrl": "/uploads/…",
                "caption": "Title band", "altText": "…", "width": 1600, "height": 1200 } ],
  "seriesDetail": { /* full Series object — description included */ },
  "makerDetail":  { /* full Maker object */ },
  "originalIssue": { "id": 44, "slug": "…", "catalogNumber": "…", "title": "…" },
  "reissues":     [ /* records whose originalIssueId is this one */ ],
  "alsoOnOtherSeries": [ /* same title, other series — the cross-reference collectors want */ ],
  "otherByPerformers": [ /* up to 12 CatalogSummary, sharing a credited performer */ ],
  "myCopies": [ /* CollectionItemSummary for copies the collector owns */ ],
  "revisionCount": 2,
  "createdAt": "…", "updatedAt": "…"
} }
```

### `POST /api/catalog`

Create a record. Body uses the same camelCase field names. Required:
`seriesId` (or `seriesSlug`), `catalogNumber`, `title`. `slug` is derived when
omitted. `credits` and `links` may be supplied inline as arrays and are created
with the record. Returns 201 and the full record.

### `PATCH /api/catalog/:idOrSlug`

Edit any field. Two extra body keys control the audit trail:

```jsonc
{ "title": "…", "editSummary": "Corrected the release month", "editor": "Andrew" }
```

`editSummary` is optional but encouraged; `editor` defaults to `"collector"`.
Supplying `credits` or `links` replaces that collection wholesale. Every
successful edit writes a `catalog_revisions` row recording before, after, and
which fields changed. Returns the full record.

### `DELETE /api/catalog/:idOrSlug`

Deletes the record and writes a `delete` revision. Refuses with 409 if any
collection item still references it — collection data is never destroyed by a
catalog edit. The error `details` names the blocking items.

### `GET /api/catalog/:idOrSlug/revisions`

```jsonc
{ "data": [ { "id": 12, "action": "update", "editor": "Andrew",
              "editSummary": "Corrected the release month",
              "changedFields": ["releasedOn", "releasedPrecision"],
              "beforeData": { … }, "afterData": { … },
              "createdAt": "…" } ] }
```

### `POST /api/catalog/:idOrSlug/revisions/:revisionId/restore`

Restores the `beforeData` of that revision and writes a `restore` revision.

---

# Makers, series, people

Each is a wiki-style page with the same shape of routes.

- `GET /api/makers` · `GET /api/makers/:idOrSlug` · `POST /api/makers` · `PATCH /api/makers/:idOrSlug`
- `GET /api/series` · `GET /api/series/:idOrSlug` · `POST /api/series` · `PATCH /api/series/:idOrSlug`
- `GET /api/people` · `GET /api/people/:idOrSlug` · `POST /api/people` · `PATCH /api/people/:idOrSlug`

List routes accept `q`, `page`, `pageSize`, and `sort` (`name` default,
`records` for most-recorded first). Detail routes include the entity's
long-form prose, its `links`, its `recordCount`, and a `records` array of up to
50 CatalogSummary rows, plus for people a `roles` breakdown. `PATCH` writes a
`catalog_revisions` row against the appropriate `entity_type`, exactly as
catalog edits do.

### `GET /api/lookups`

Everything the UI needs to render its dropdowns, in one call.

```jsonc
{ "data": {
  "conditionGrades":  [ { "id":1, "code":"M", "label":"Mint", "score":100,
                          "description":"…", "sortOrder":1 } ],
  "defectTypes":      [ { "id":1, "code":"crack", "label":"Crack", "category":"structural",
                          "description":"…", "careAdvice":"…", "isTerminal":false,
                          "sortOrder":1 } ],
  "cleaningMethods":  [ { "id":2, "code":"dry_brush", "label":"Soft dry brush",
                          "description":"…", "safeFor":["brown_wax","celluloid"],
                          "isRisky":false, "sortOrder":2 } ],
  "makers":  [ { "id":1, "slug":"edison", "name":"…", "recordCount":300 } ],
  "series":  [ { "id":3, "slug":"…", "name":"…", "makerSlug":"edison",
                 "material":"celluloid", "playMinutes":4, "recordCount":240 } ],
  "genres":  ["Popular song", "March", … ],
  "collections": [ { "id":1, "slug":"my-amberola", "name":"My Amberola", "isDefault":true } ]
} }
```

---

# Collection — the collector's own shelf

The default collection is used when no `collectionId` is given.

### `GET /api/collection`

| param | meaning |
|---|---|
| `q` | Free text across the catalog fields **and** the collector's own personal notes, condition notes, storage location and cleaning-log notes. |
| `collection` | slug or id; defaults to the default collection |
| `grade` | condition grade code. Repeatable. |
| `defect` | defect type code. Repeatable. |
| `cleaned` | `true` \| `false` — has a cleaning-log entry or does not |
| `needsCleaning` | `true` — never cleaned, or last cleaned over a year ago |
| `playable` | `true` \| `false` |
| `favourite` | `true` |
| `forTrade` | `true` |
| `series`, `maker`, `material` | as on the catalog list |
| `sort` | `acquired` (default), `title`, `catalog`, `grade`, `cleaned`, `rating`, `value`; `-` reverses |
| `page`, `pageSize` | pagination |

**CollectionItemSummary**:

```jsonc
{
  "id": 5, "collectionId": 1, "copyLabel": null,
  "record": { /* CatalogSummary, or null when unmatched */ },
  "unmatchedTitle": null, "unmatchedMaker": null, "unmatchedNumber": null,
  "displayTitle": "Don't Bite the Hand That's Feeding You",   // record title, else unmatchedTitle
  "acquiredOn": "2024-06-02", "acquiredFrom": "Estate sale, Lancaster PA",
  "acquiredPrice": 12.00, "acquiredCurrency": "USD", "estimatedValue": 25.00,
  "conditionGrade": { "id":4, "code":"EX", "label":"Excellent", "score":78 },
  "boxGrade": { "id":6, "code":"VG", "label":"Very Good", "score":62 },
  "hasOriginalBox": true, "hasOriginalLid": false,
  "playbackRating": 4, "surfaceNoise": "light", "isPlayable": true,
  "storageLocation": "Cabinet 2, drawer B",
  "personalNotes": "…", "conditionNotes": "…",
  "isFavourite": false, "isForTrade": false,
  "defects": [ { "id":2, "severity":2, "location":"rim", "notes":"…",
                 "isResolved": false, "notedOn": "2024-06-02",
                 "defectType": { "id":2, "code":"chip", "label":"Chip",
                                 "category":"structural", "careAdvice":"…",
                                 "isTerminal": false } } ],
  "cleaning": {                       // derived from the log; never stored directly
    "isCleaned": true,
    "cleaningCount": 2,
    "lastCleanedAt": "2024-06-10T15:20:00-04:00",
    "lastMethod": "Soft dry brush",
    "lastNotes": "…"
  },
  "primaryImageUrl": "/uploads/…",
  "imageCount": 4,
  "createdAt": "…", "updatedAt": "…"
}
```

### `GET /api/collection/:id`

The full item: every summary field plus `images` (full array), `cleanings`
(full log, newest first), and `playEvents`.

### `POST /api/collection`

```jsonc
{ "recordId": 128,            // or "recordSlug"; omit both for an unidentified copy
  "unmatchedTitle": "…",      // required when there is no recordId
  "unmatchedMaker": "…", "unmatchedNumber": "…",
  "acquiredOn": "2024-06-02", "conditionGradeId": 4, "playbackRating": 4,
  "personalNotes": "…", "defects": [ { "defectTypeId": 2, "severity": 2, "location": "rim" } ] }
```

Returns 201 and the full item. `PATCH /api/collection/:id` edits, `DELETE`
removes it along with its images, defects and cleaning log.

### Defects

- `PUT /api/collection/:id/defects` — replaces the whole set. Body: `{ "defects": [ … ] }`.
- `POST /api/collection/:id/defects` — adds one.
- `PATCH /api/defects/:defectId` · `DELETE /api/defects/:defectId`

### Cleaning log

- `GET  /api/collection/:id/cleanings`
- `POST /api/collection/:id/cleanings`

```jsonc
{ "cleanedAt": "2024-06-10T15:20:00-04:00",   // defaults to now
  "methodId": 2,                               // or "methodOther": "…" — one is required
  "productsUsed": "Distilled water, sable brush",
  "performedBy": "Andrew", "durationMinutes": 20,
  "outcome": "improved",                       // improved | no_change | worsened | unknown
  "notes": "…" }
```

The response includes a `warnings` array when the chosen method is not listed
as safe for that cylinder's material — the wax-versus-celluloid mistake this
app exists partly to prevent:

```jsonc
{ "data": { … }, "warnings": [
  { "code": "method_unsafe_for_material",
    "message": "Distilled water is not a safe treatment for a black wax cylinder." } ] }
```

The warning does not block the write; the collector may have done it already
and be recording history.

- `PATCH /api/cleanings/:cleaningId` · `DELETE /api/cleanings/:cleaningId`

### Images

- `POST /api/collection/:id/images` — `multipart/form-data`.
  Fields: `files` (one or more; JPEG, PNG, WebP, HEIC, GIF; 25 MB each),
  and optional `view` (`label`|`surface`|`box`|`lid`|`end`|`damage`|`other`),
  `caption`, `altText`. The server strips EXIF, derives width and height,
  writes a thumbnail, and de-duplicates by SHA-256. Returns 201 with the
  created image objects. On a duplicate it returns the existing image and sets
  `"duplicate": true` on it rather than erroring.
- `POST /api/catalog/:idOrSlug/images` — the same, for shared catalog imagery.
- `PATCH /api/images/:imageId` — `caption`, `altText`, `view`, `sortOrder`, `isPrimary`.
- `DELETE /api/images/:imageId` — removes the row and the file.

Image objects:

```jsonc
{ "id": 7, "url": "/uploads/2024/06/abc123.jpg",
  "thumbUrl": "/uploads/2024/06/abc123_thumb.jpg",
  "view": "label", "caption": "Title band", "altText": "…",
  "width": 1600, "height": 1200, "byteSize": 482113,
  "mimeType": "image/jpeg", "sortOrder": 1, "isPrimary": true,
  "createdAt": "…" }
```

### Play log

`GET`/`POST /api/collection/:id/plays`, `DELETE /api/plays/:playId`.
Body: `playedAt`, `machine`, `stylus`, `notes`.

### `GET /api/collection/stats`

Powers the dashboard.

```jsonc
{ "data": {
  "totalItems": 96, "matchedItems": 91, "unmatchedItems": 5,
  "distinctTitles": 88, "duplicates": 8,
  "totalSpend": 1240.50, "estimatedValue": 2810.00,
  "cleaned": 61, "neverCleaned": 35, "cleanedThisYear": 22,
  "needsAttention": 7,                  // terminal or severe unresolved defects
  "playableCount": 89,
  "averageGradeScore": 68.4,
  "byGrade":    [ { "code":"EX", "label":"Excellent", "count":21 } ],
  "bySeries":   [ { "slug":"edison-blue-amberol", "name":"…", "count":54 } ],
  "byMaker":    [ { "slug":"edison", "name":"…", "count":78 } ],
  "byDecade":   [ { "decade":1910, "count":61 } ],
  "topDefects": [ { "code":"grime", "label":"Dirt / grime", "count":18 } ],
  "recentlyAcquired": [ /* 5 CollectionItemSummary */ ],
  "recentlyCleaned":  [ /* 5, with the cleaning event attached */ ],
  "catalogCoverage": { "catalogTotal": 412, "owned": 88, "percent": 21.4 }
} }
```

### Wishlist

`GET`/`POST /api/wishlist`, `PATCH`/`DELETE /api/wishlist/:id`.
Body: `recordId` or `freeText`, `priority` 1–5, `maxPrice`, `notes`.

---

# Utility

- `GET /api/health` → `{ "data": { "status": "ok", "database": "ok", "records": 412 } }`
- `POST /api/admin/reindex` → rebuilds the search index; `{ "data": { "reindexed": 412 } }`
- `GET /api/export/collection?format=json|csv` → downloadable export of the shelf.
