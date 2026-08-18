# The Amberola Cylinder Register

A browser-based register of four-minute phonograph cylinders, built for an
Edison Amberola. It is two things joined together:

- **The master list** — a shared, editable, wiki-style catalog of the cylinders
  themselves. Every maker that issued four-minute records, every series they
  issued them in, the artists who made them, and a full article for each title.
  It ships populated, so it is useful the moment it is installed.
- **The collection** — the collector's own shelf. Which copies they hold, what
  condition each one is in, what is wrong with it, photographs of it, and a log
  of every time it has been cleaned: when, by what method, and to what effect.

It runs on a phone, a tablet or a desktop, because the cataloguing happens
standing at a shelf and the reading happens in a chair.

## Getting started

Requires PostgreSQL 14 or newer and Node 20 or newer. Works on Windows, macOS
and Linux — `npm run setup` is a Node script, not a shell script.

```bash
git clone <this repository>
cd Amberol
npm run setup      # installs dependencies, creates the database, loads the catalog
npm start          # builds the front end and serves everything on :4310
```

Then open <http://localhost:4310>.

Setup may ask for your PostgreSQL **superuser password** — the one chosen when
PostgreSQL was installed — so that it can create the `amberola` role and
database. To avoid the prompt, set `PGPASSWORD` first. It is safe to re-run.

### On Windows

Setup does not need `psql` on your `PATH` — it creates the role and database
through the same PostgreSQL driver the server uses, because the Windows
installer routinely leaves `psql` unavailable. Installing PostgreSQL and
having its service running is enough.

Check the service is running with:

```powershell
Get-Service -Name "postgresql*"
```

If it is missing entirely, no PostgreSQL **server** is installed — only the
client tools. If it is listed but stopped, start it from an Administrator
PowerShell with `Start-Service -Name "postgresql*"`.

If the database still cannot be created automatically, setup prints the two
SQL statements to run by hand and stops; run them in pgAdmin, then run
`npm run setup` again.

### A note on install scripts

npm 12 blocks package install scripts unless a project approves them. Two
dependencies genuinely need theirs — `esbuild`, which places the compiler
binary Vite builds with, and `sharp`, which does the same for image
processing. Both are approved in the `allowScripts` field of the respective
`package.json`, so installing works without any prompt. Nothing else in the
tree is allowed to run an install script.

## Development

For hot reloading, with the API on a separate port:

```bash
npm run dev        # API on :4310, front end on :5310
```

The Vite dev server binds to all interfaces, so a phone or tablet on the same
network can reach it at `http://<your-machine>:5310` — which is the sensible way
to try the mobile screens.

### If something is wrong

```bash
npm run doctor
```

It walks the chain from configuration to seeded data, stops at the first thing
that is broken, and prints the command that fixes it. The commonest case is a
database that was created but never migrated — the register loads, and then
every page reports that it cannot read anything:

```bash
npm run migrate    # create the tables
npm run seed       # load the master catalog
```

### Configuration

`server/.env`, written by the setup script:

| variable | default | meaning |
|---|---|---|
| `DATABASE_URL` | `postgres://amberola:amberola@127.0.0.1:5432/amberola` | connection string |
| `PORT` | `4310` | API port |
| `UPLOAD_DIR` | `./uploads` | where uploaded photographs are written |
| `MAX_UPLOAD_MB` | `25` | per-file upload limit |

## Layout

```
db/migrations/   schema, search index, and the default vocabularies
db/seed/         the master catalog, as JSON — see SEED_FORMAT.md
server/          Express API over PostgreSQL
web/             React front end
docs/            the API contract and design notes
```

## How it is put together

### The database

PostgreSQL, with the master catalog and the personal collection kept firmly
apart. `catalog_records`, `makers`, `series` and `people` are communal and
versioned; `collection_items`, `cleaning_events`, `item_defects` and the
uploaded images belong to the collector alone. **A catalog edit can never
damage collection data** — deleting a catalog entry that someone owns a copy of
is refused outright.

Every edit to the master list writes a `catalog_revisions` row holding the
before and after state and which fields changed, so the catalog has a history
in the way a wiki does, and any revision can be restored.

### Searching

The brief was to search by every kind of data, including description and notes,
and that is what `catalog_search` does. Each record carries a weighted
`tsvector` built from four bands — title and catalog number weigh most,
performers and credits next, then series, maker, genre and description, then
notes, lyrics and provenance. The vector is built under both the `english` and
`simple` configurations at once, so stemming works (`sings` finds `singing`)
without the stemmer mangling proper nouns.

Queries run as prefix matches, so `bru` finds *Van Brunt* while you are still
typing. When a query finds nothing at all, the server falls back to trigram
word-similarity, so `feding` still finds *Feeding*, and tells the browser which
path produced the results so it can say so.

Triggers keep the index in step: editing a person's name reindexes every record
they are credited on.

### Cleaning, and why the app has opinions

The cleaned flag is **derived from the cleaning log**, never stored alongside
it, so the two can never disagree. Each entry records the date and time, the
method, the products used, who did it, how long it took, and whether the record
sounded better afterwards.

The app knows which methods suit which materials, because this is the mistake
that destroys cylinders: **wax is ruined by water and alcohol, while celluloid
tolerates a careful wash.** Logging a wash against a black wax Amberol raises a
warning — but never blocks the entry, since a collector may be recording
something they already did, and an accurate history is worth more than a tidy
one.

### The look

The interface is drawn from the object it serves: the quarter-sawn oak of the
Amberola cabinet, the gold decal on its lid, the cream letterpress stock of an
Edison monthly supplement, and the blue and purple celluloid of the cylinders.
It has a daylight and a lamplight theme, and it is built mobile-first.

## The master catalog

The catalog that ships is seeded from `db/seed/*.json`. Entries carry a
`confidence` flag — `verified`, `probable` or `uncertain` — and the interface
shows it, because a reference work that hides its uncertainty is worse than one
that admits it. Where a fact could not be confirmed, the entry says so rather
than guessing.

### A caveat about the external links, worth reading once

The catalog was assembled in a sandbox whose network policy blocked outbound
connections to the very archives it cites — Wikipedia, the UCSB Cylinder Audio
Archive, DAHR and the Internet Archive all refused at the gateway. Links were
therefore sourced from search results and from stable, well-known archive roots,
but **none could be confirmed by actually fetching it.** Some deep links may
have drifted or may never have been right.

There is a checker for exactly this. Run it once on an ordinary internet
connection:

```bash
npm run verify-links                 # report anything that does not resolve
npm run verify-links -- --fix        # also delete citations that return 404
```

It checks each distinct URL once, follows redirects, falls back from HEAD to
GET for the archives that refuse HEAD, and — with `--fix` — removes only links
the server actually answered 404 or 410 for, leaving timeouts alone on the
assumption that the fault is more often the connection than the link.

To add to it, write another JSON file following `db/seed/SEED_FORMAT.md` and:

```bash
npm run seed --prefix server -- --check db/seed/yourfile.json   # validate
npm run seed                                                     # load
```

Seeding is idempotent: slugs are the identity, so re-running updates in place
rather than duplicating.

## Documentation

- `docs/API.md` — the HTTP contract, binding on both the server and the browser
- `db/seed/SEED_FORMAT.md` — the seed file format and its accuracy rules
- `db/migrations/*.sql` — the schema, commented

## Licence and provenance

The recordings this catalogs are of the acoustic era and long out of copyright.
Catalog text is original prose. External links point to the UCSB Cylinder Audio
Archive, the Discography of American Historical Recordings, and Wikipedia, none
of which are affiliated with this project.
