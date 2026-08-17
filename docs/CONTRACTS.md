# The contracts

The register was built by ten contractors working in parallel. That only works
if the seams between them are fixed before any of them starts, so the interfaces
below were written first and treated as binding. A contractor that found a
contract wrong was required to change the contract and say so, never to quietly
diverge from it.

Three documents carry the whole agreement:

| contract | what it fixes | who depends on it |
|---|---|---|
| `db/migrations/*.sql` | the schema, the search index, the vocabularies | everyone |
| `docs/API.md` | every route, parameter, envelope and field name | the API and the browser |
| `db/seed/SEED_FORMAT.md` | the seed JSON shape and the accuracy rules | the five data contractors |

Two more fix the appearance, so that three people building screens
independently produce one object rather than three:

- `web/src/styles/tokens.css` — palette, typefaces, ornament, both themes
- `web/src/components/ui.tsx` and `Markdown.tsx` — the shared component kit

## Division of work

Nothing is co-owned. Every file has exactly one author, which is what let all
ten run at once without stepping on each other.

### Data — the master catalog

The seed files are loaded in filename order and reference each other by slug,
so the numbering matters. The slug vocabulary for makers and series was fixed
in advance and handed to every data contractor, which is what allowed the
catalog contractors to reference series they were not writing.

| file | scope |
|---|---|
| `db/seed/00-foundations.json` | every maker and every series, with their long-form articles |
| `db/seed/10-people.json` | the artist roster: performers, ensembles, composers, and their pseudonyms |
| `db/seed/20-edison-blue-amberol.json` | Edison Blue Amberol, the four-minute celluloid series |
| `db/seed/21-edison-amberol-wax.json` | Edison Amberol in wax, and the Royal Purple issues |
| `db/seed/22-independents.json` | Indestructible, U-S Everlasting, Columbia Indestructible, and the rest |

People are the one entity several files may describe. The loader merges them by
slug, keeping the richest value for each field and unioning the alias lists, so
a record file mentioning a singer in passing never overwrites the roster's
biography — whatever order the files load in.

### The API

| files | scope |
|---|---|
| `server/src/routes/catalog.js`, `wiki.js`, `lookups.js` | the master list, search and facets, the revision history, the maker/series/person pages |
| `server/src/routes/collection.js`, `images.js` | the shelf, condition and defects, the cleaning log, uploads, statistics |

### The browser

| files | scope |
|---|---|
| `components/Layout.tsx`, `pages/Home.tsx`, `pages/NotFound.tsx`, `styles/app.css` | the shell, the navigation, and the art direction everything else matches |
| `pages/CatalogList`, `RecordDetail`, `RecordEdit`, `BrowseIndex`, `MakerDetail`, `SeriesDetail`, `PersonDetail` | the encyclopedia half |
| `pages/CollectionList`, `CollectionItemDetail`, `CollectionItemEdit`, `Dashboard` | the personal half |

Held centrally, and not editable by any contractor: `App.tsx` (the route
table), `main.tsx`, `lib/api.ts`, `styles/tokens.css`, `components/ui.tsx`,
`components/Markdown.tsx`.

## Standing terms

These applied to every contractor.

**Accuracy over volume, in the data.** A plausible invention is worse than an
honest gap, because it cannot be told apart from a fact. Catalog numbers,
dates, performers and URLs were never to be guessed. Where something was
supported but unconfirmed it had to be flagged `probable` or `uncertain`, with
the doubtful fact named in the notes — and the interface shows that flag, since
a reference work that hides its uncertainty is worse than one that admits it.

**No fabricated links.** A URL that looks authoritative and does not resolve is
the most damaging single error available, so deep links were to be verified
before inclusion, and an honest link to an archive's search page was preferred
to a plausible guess at a permalink.

**Parameterised queries only, on the server.** No value is ever interpolated
into SQL; sort keys and filter columns are checked against an allowlist before
they reach a query.

**The collection is the irreplaceable half.** A catalog entry can be
re-derived from a reference book; a cleaning log cannot. No catalog operation
may destroy collection data, and deleting a catalog entry someone owns a copy
of is refused outright.

**Verify before reporting done.** Data contractors ran the seed validator until
it passed clean. API contractors exercised every route they wrote and saw
correct output. Interface contractors drove a real browser, screenshotted their
screens at 375px and 1280px in both themes, and iterated on what they saw.
"It should work" was not an acceptable report.

**Build from the tokens.** No screen hard-codes a colour or a typeface. That
single rule is most of why the three interface contractors produced one
coherent object.
