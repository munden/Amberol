-- =====================================================================
-- Amberola Cylinder Register — core schema
-- PostgreSQL 16
--
-- Domain model in brief:
--   makers            manufacturers who issued cylinder records
--   series            named product lines (Edison Blue Amberol, Royal Purple, ...)
--   people            performers, composers, lyricists, conductors, ensembles
--   catalog_records   the master, shared, wiki-style catalog of issued titles
--   collections       a collector's shelf; collection_items are owned copies
--
-- The master catalog is communal and versioned (catalog_revisions).
-- Everything under collections/ is personal to the owner and never
-- overwritten by catalog updates.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- An immutable wrapper so unaccent() can be used inside index expressions
-- and generated columns, which require immutability.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE OR REPLACE FUNCTION slugify(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$
  SELECT trim(both '-' from
    regexp_replace(
      regexp_replace(lower(immutable_unaccent(coalesce($1, ''))), '[^a-z0-9]+', '-', 'g'),
      '-{2,}', '-', 'g'
    )
  )
$$;

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- =====================================================================
-- Enumerated vocabularies
-- =====================================================================

-- How a cylinder was physically made. Drives the care advice shown in the UI:
-- wax is brittle and mould-prone, celluloid splits and shrinks onto its core.
CREATE TYPE cylinder_material AS ENUM (
  'brown_wax', 'black_wax', 'metallic_soap', 'celluloid', 'condensite', 'unknown'
);

CREATE TYPE credit_role AS ENUM (
  'performer', 'vocalist', 'instrumentalist', 'ensemble', 'orchestra', 'band',
  'conductor', 'composer', 'lyricist', 'arranger', 'speaker', 'comedian',
  'whistler', 'accompanist', 'announcer', 'other'
);

CREATE TYPE data_confidence AS ENUM ('verified', 'probable', 'uncertain');

CREATE TYPE link_kind AS ENUM (
  'audio', 'discography', 'encyclopedia', 'catalog_scan', 'sheet_music',
  'image', 'article', 'video', 'other'
);

-- =====================================================================
-- Makers — the companies that issued 4-minute cylinders
-- =====================================================================

CREATE TABLE makers (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  short_name      text,
  country         text,
  city            text,
  founded_year    smallint,
  dissolved_year  smallint,
  -- Long-form, wiki-style prose. Markdown.
  summary         text,
  history         text,
  notes           text,
  logo_image_id   bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT makers_years_ordered CHECK (
    dissolved_year IS NULL OR founded_year IS NULL OR dissolved_year >= founded_year
  )
);

CREATE TRIGGER makers_touch BEFORE UPDATE ON makers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- =====================================================================
-- Series — named product lines, e.g. Edison Blue Amberol, Royal Purple
-- =====================================================================

CREATE TABLE series (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug              text NOT NULL UNIQUE,
  maker_id          bigint NOT NULL REFERENCES makers(id) ON DELETE RESTRICT,
  name              text NOT NULL,
  -- Nominal playing time in minutes: 2 or 4. The collection is about the
  -- 4-minute cylinders the Amberola plays, but 2-minute lines are carried
  -- so that a maker's full output is representable.
  play_minutes      numeric(3,1),
  material          cylinder_material NOT NULL DEFAULT 'unknown',
  -- Grooves per inch: 100 for two-minute, 200 for four-minute Amberol cut.
  threads_per_inch  smallint,
  colour            text,
  introduced_year   smallint,
  discontinued_year smallint,
  summary           text,
  description       text,
  notes             text,
  UNIQUE (maker_id, name),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX series_maker_idx ON series(maker_id);
CREATE TRIGGER series_touch BEFORE UPDATE ON series
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- =====================================================================
-- People — performers and authors
-- =====================================================================

CREATE TABLE people (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  -- Display form as printed on the cylinder, e.g. 'W. Van Brunt'.
  name          text NOT NULL,
  -- Canonical/full form, e.g. 'Walter Van Brunt'. Used to merge the many
  -- pseudonyms the acoustic-era labels used for the same singer.
  full_name     text,
  sort_name     text,
  -- Alternate spellings and stage names; searched alongside name.
  aliases       text[] NOT NULL DEFAULT '{}',
  is_group      boolean NOT NULL DEFAULT false,
  birth_year    smallint,
  death_year    smallint,
  nationality   text,
  voice_or_instrument text,
  summary       text,
  biography     text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_years_ordered CHECK (
    death_year IS NULL OR birth_year IS NULL OR death_year >= birth_year
  )
);

CREATE INDEX people_name_trgm ON people USING gin (immutable_unaccent(name) gin_trgm_ops);
CREATE INDEX people_aliases_idx ON people USING gin (aliases);
CREATE TRIGGER people_touch BEFORE UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- =====================================================================
-- Catalog records — the master list
-- =====================================================================

CREATE TABLE catalog_records (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug              text NOT NULL UNIQUE,
  series_id         bigint NOT NULL REFERENCES series(id) ON DELETE RESTRICT,
  maker_id          bigint NOT NULL REFERENCES makers(id) ON DELETE RESTRICT,

  -- Catalog number as printed, e.g. '2848'. Kept as text because many
  -- issues carry letters or hyphens ('B-1234', '28503-R').
  catalog_number    text NOT NULL,
  -- Zero-padded/normalised form used for correct numeric ordering.
  catalog_sort      text GENERATED ALWAYS AS (
                      lpad(regexp_replace(catalog_number, '\D', '', 'g'), 9, '0')
                      || '-' || catalog_number
                    ) STORED,
  matrix_number     text,
  take              text,

  title             text NOT NULL,
  subtitle          text,
  -- 'Fox Trot', 'Descriptive Specialty', 'Sacred', etc. as printed.
  work_type         text,
  genre             text,
  language          text,

  -- The primary credit line as printed on the label, kept verbatim so the
  -- page can reproduce the cylinder's own wording. Structured credits live
  -- in record_credits.
  credit_line       text,

  recorded_on       date,
  -- Set when only the month or year is known; recorded_on then holds the
  -- first of the period.
  recorded_precision text CHECK (recorded_precision IN ('day','month','year','decade')),
  recorded_place    text,
  released_on       date,
  released_precision text CHECK (released_precision IN ('day','month','year','decade')),
  -- Issue month as printed in the supplements, e.g. 'November 1915'.
  release_supplement text,
  withdrawn_on      date,

  duration_seconds  smallint,
  -- Prose sections that make up the wiki-style article.
  description       text,
  notes             text,
  lyrics            text,
  trivia            text,

  -- Where this cylinder came from: a re-recording of a disc, a dubbing of an
  -- earlier wax Amberol, an original recording.
  provenance        text,
  original_issue_id bigint REFERENCES catalog_records(id) ON DELETE SET NULL,

  confidence        data_confidence NOT NULL DEFAULT 'verified',
  is_stub           boolean NOT NULL DEFAULT false,
  primary_image_id  bigint,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One row per issued number per series; a distinct take gets its own row.
CREATE UNIQUE INDEX catalog_records_issue_key
  ON catalog_records (series_id, catalog_number, coalesce(take, ''));

CREATE INDEX catalog_records_series_idx  ON catalog_records(series_id, catalog_sort);
CREATE INDEX catalog_records_maker_idx   ON catalog_records(maker_id);
CREATE INDEX catalog_records_number_idx  ON catalog_records(catalog_number);
CREATE INDEX catalog_records_title_trgm  ON catalog_records USING gin (immutable_unaccent(title) gin_trgm_ops);
CREATE INDEX catalog_records_released_idx ON catalog_records(released_on);
CREATE TRIGGER catalog_records_touch BEFORE UPDATE ON catalog_records
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Structured credits: who did what on this title.
CREATE TABLE record_credits (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id   bigint NOT NULL REFERENCES catalog_records(id) ON DELETE CASCADE,
  person_id   bigint NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role        credit_role NOT NULL DEFAULT 'performer',
  -- Free-text refinement, e.g. 'tenor', 'cornet solo', 'with orchestra'.
  detail      text,
  billing_order smallint NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX record_credits_key
  ON record_credits (record_id, person_id, role, coalesce(detail, ''));

CREATE INDEX record_credits_record_idx ON record_credits(record_id, billing_order);
CREATE INDEX record_credits_person_idx ON record_credits(person_id);

-- Outbound references: UCSB Cylinder Audio Archive, DAHR, Wikipedia, scans.
CREATE TABLE record_links (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id   bigint NOT NULL REFERENCES catalog_records(id) ON DELETE CASCADE,
  kind        link_kind NOT NULL DEFAULT 'other',
  label       text NOT NULL,
  url         text NOT NULL,
  source_name text,
  sort_order  smallint NOT NULL DEFAULT 1,
  CONSTRAINT record_links_url_http CHECK (url ~* '^https?://'),
  UNIQUE (record_id, url)
);

CREATE INDEX record_links_record_idx ON record_links(record_id, sort_order);

-- The same outbound-reference idea for makers, series and people, so every
-- wiki-style page can cite its sources.
CREATE TABLE entity_links (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('maker','series','person')),
  entity_id   bigint NOT NULL,
  kind        link_kind NOT NULL DEFAULT 'other',
  label       text NOT NULL,
  url         text NOT NULL,
  sort_order  smallint NOT NULL DEFAULT 1,
  CONSTRAINT entity_links_url_http CHECK (url ~* '^https?://'),
  UNIQUE (entity_type, entity_id, url)
);

CREATE INDEX entity_links_entity_idx ON entity_links(entity_type, entity_id, sort_order);

-- =====================================================================
-- Catalog revision history — every edit to the master list is recorded
-- =====================================================================

CREATE TABLE catalog_revisions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id    bigint REFERENCES catalog_records(id) ON DELETE SET NULL,
  entity_type  text NOT NULL DEFAULT 'catalog_record'
                 CHECK (entity_type IN ('catalog_record','maker','series','person')),
  entity_id    bigint NOT NULL,
  action       text NOT NULL CHECK (action IN ('create','update','delete','restore')),
  -- Full row snapshots; the UI diffs them to render a wiki-style history.
  before_data  jsonb,
  after_data   jsonb,
  changed_fields text[] NOT NULL DEFAULT '{}',
  editor       text NOT NULL DEFAULT 'collector',
  edit_summary text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX catalog_revisions_entity_idx ON catalog_revisions(entity_type, entity_id, created_at DESC);
CREATE INDEX catalog_revisions_record_idx ON catalog_revisions(record_id, created_at DESC);

-- =====================================================================
-- Images
-- =====================================================================

CREATE TABLE images (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Path relative to the configured upload root.
  storage_path  text NOT NULL UNIQUE,
  original_name text,
  mime_type     text NOT NULL,
  byte_size     bigint NOT NULL CHECK (byte_size > 0),
  width         integer,
  height        integer,
  -- Content hash, so re-uploading the same photo is caught.
  sha256        text UNIQUE,
  caption       text,
  alt_text      text,
  credit        text,
  taken_at      timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE makers
  ADD CONSTRAINT makers_logo_fk
  FOREIGN KEY (logo_image_id) REFERENCES images(id) ON DELETE SET NULL;

ALTER TABLE catalog_records
  ADD CONSTRAINT catalog_records_primary_image_fk
  FOREIGN KEY (primary_image_id) REFERENCES images(id) ON DELETE SET NULL;

-- Photos attached to the shared catalog entry (label scans, box art).
CREATE TABLE record_images (
  record_id  bigint NOT NULL REFERENCES catalog_records(id) ON DELETE CASCADE,
  image_id   bigint NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  sort_order smallint NOT NULL DEFAULT 1,
  PRIMARY KEY (record_id, image_id)
);

-- =====================================================================
-- Collections — the collector's own shelf
-- =====================================================================

CREATE TABLE collections (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  owner_name  text,
  description text,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- At most one default collection.
CREATE UNIQUE INDEX collections_single_default ON collections(is_default) WHERE is_default;
CREATE TRIGGER collections_touch BEFORE UPDATE ON collections
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Collector's grading scale. Seeded in 0003 but editable.
CREATE TABLE condition_grades (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  label         text NOT NULL,
  -- 0 = unplayable ruin, 100 = as it left Orange, New Jersey.
  score         smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  description   text,
  sort_order    smallint NOT NULL DEFAULT 1
);

-- The catalogue of things that go wrong with a cylinder.
CREATE TABLE defect_types (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  label         text NOT NULL,
  category      text NOT NULL CHECK (category IN
                  ('structural','surface','audio','core','packaging','contamination')),
  description   text,
  -- Guidance shown when the defect is ticked: what it means for playability
  -- and whether it is likely to worsen.
  care_advice   text,
  is_terminal   boolean NOT NULL DEFAULT false,
  sort_order    smallint NOT NULL DEFAULT 1
);

CREATE TABLE collection_items (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  collection_id     bigint NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  -- Null while an unidentified cylinder is being researched; the item still
  -- carries its own title/maker text below.
  record_id         bigint REFERENCES catalog_records(id) ON DELETE SET NULL,

  -- Fallback identity for a copy not yet matched to the master list.
  unmatched_title   text,
  unmatched_maker   text,
  unmatched_number  text,

  -- One physical copy per row; duplicates get their own rows so each can
  -- carry its own condition and cleaning history.
  copy_label        text,

  acquired_on       date,
  acquired_from     text,
  acquired_price    numeric(10,2),
  acquired_currency text NOT NULL DEFAULT 'USD',
  estimated_value   numeric(10,2),

  condition_grade_id bigint REFERENCES condition_grades(id) ON DELETE SET NULL,
  -- Separate grade for the box/lid, which often survives worse than the record.
  box_grade_id       bigint REFERENCES condition_grades(id) ON DELETE SET NULL,
  has_original_box   boolean,
  has_original_lid   boolean,

  -- Subjective playback judgement, 1–5 stars, independent of physical grade:
  -- a scuffed cylinder can still sound wonderful.
  playback_rating    smallint CHECK (playback_rating BETWEEN 1 AND 5),
  surface_noise      text CHECK (surface_noise IN ('none','light','moderate','heavy','severe')),
  is_playable        boolean NOT NULL DEFAULT true,

  storage_location   text,
  personal_notes     text,
  condition_notes    text,
  is_favourite       boolean NOT NULL DEFAULT false,
  is_for_trade       boolean NOT NULL DEFAULT false,

  primary_image_id   bigint REFERENCES images(id) ON DELETE SET NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- An item must be identifiable one way or the other.
  CONSTRAINT collection_items_identified CHECK (
    record_id IS NOT NULL OR unmatched_title IS NOT NULL
  )
);

CREATE INDEX collection_items_collection_idx ON collection_items(collection_id);
CREATE INDEX collection_items_record_idx     ON collection_items(record_id);
CREATE TRIGGER collection_items_touch BEFORE UPDATE ON collection_items
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE item_defects (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id        bigint NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
  defect_type_id bigint NOT NULL REFERENCES defect_types(id) ON DELETE CASCADE,
  severity       smallint NOT NULL DEFAULT 2 CHECK (severity BETWEEN 1 AND 5),
  -- Where on the cylinder, e.g. 'starting groove', 'last 30 seconds'.
  location       text,
  notes          text,
  noted_on       date NOT NULL DEFAULT current_date,
  is_resolved    boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX item_defects_key
  ON item_defects (item_id, defect_type_id, coalesce(location, ''));

CREATE INDEX item_defects_item_idx ON item_defects(item_id);

CREATE TABLE item_images (
  item_id    bigint NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
  image_id   bigint NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  -- Lets the gallery group shots sensibly on a phone screen.
  view       text CHECK (view IN ('label','surface','box','lid','end','damage','other')),
  sort_order smallint NOT NULL DEFAULT 1,
  PRIMARY KEY (item_id, image_id)
);

-- =====================================================================
-- Cleaning log
-- =====================================================================

CREATE TABLE cleaning_methods (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  label        text NOT NULL,
  description  text,
  -- Which materials this method is safe for; wax and celluloid want very
  -- different treatment and the UI warns on a mismatch.
  safe_for     cylinder_material[] NOT NULL DEFAULT '{}',
  is_risky     boolean NOT NULL DEFAULT false,
  sort_order   smallint NOT NULL DEFAULT 1
);

CREATE TABLE cleaning_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id        bigint NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
  -- Date *and* time, as requested; defaults to the moment of logging.
  cleaned_at     timestamptz NOT NULL DEFAULT now(),
  method_id      bigint REFERENCES cleaning_methods(id) ON DELETE SET NULL,
  -- Free-text method for anything not in the lookup table.
  method_other   text,
  products_used  text,
  performed_by   text,
  duration_minutes smallint,
  -- Judgement of the result, so repeat cleanings can be compared.
  outcome        text CHECK (outcome IN ('improved','no_change','worsened','unknown')),
  notes          text,
  before_image_id bigint REFERENCES images(id) ON DELETE SET NULL,
  after_image_id  bigint REFERENCES images(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cleaning_events_method_present CHECK (
    method_id IS NOT NULL OR method_other IS NOT NULL
  )
);

CREATE INDEX cleaning_events_item_idx ON cleaning_events(item_id, cleaned_at DESC);

-- The "cleaned" flag the collector sees on the shelf list is derived from the
-- log rather than stored, so it can never drift out of step with it.
CREATE VIEW collection_item_cleaning AS
SELECT
  ci.id                                            AS item_id,
  count(ce.id) > 0                                 AS is_cleaned,
  count(ce.id)                                     AS cleaning_count,
  max(ce.cleaned_at)                               AS last_cleaned_at,
  (array_agg(coalesce(cm.label, ce.method_other)
     ORDER BY ce.cleaned_at DESC))[1]              AS last_cleaning_method,
  (array_agg(ce.notes ORDER BY ce.cleaned_at DESC))[1] AS last_cleaning_notes
FROM collection_items ci
LEFT JOIN cleaning_events ce ON ce.item_id = ci.id
LEFT JOIN cleaning_methods cm ON cm.id = ce.method_id
GROUP BY ci.id;

-- Optional playback log: which cylinders have been on the Amberola lately.
CREATE TABLE play_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id    bigint NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
  played_at  timestamptz NOT NULL DEFAULT now(),
  machine    text,
  stylus     text,
  notes      text
);

CREATE INDEX play_events_item_idx ON play_events(item_id, played_at DESC);

-- Titles the collector is hunting for.
CREATE TABLE wishlist_items (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  collection_id bigint NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  record_id     bigint REFERENCES catalog_records(id) ON DELETE CASCADE,
  free_text     text,
  priority      smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  max_price     numeric(10,2),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wishlist_identified CHECK (record_id IS NOT NULL OR free_text IS NOT NULL)
);

CREATE INDEX wishlist_collection_idx ON wishlist_items(collection_id);
