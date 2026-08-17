-- =====================================================================
-- Full-text + fuzzy search over the master catalog
--
-- Every catalog record gets one row in catalog_search holding:
--   document — a weighted tsvector for ranked full-text search
--   haystack — the same text flattened, with a trigram index, so that
--              misspellings and partial words still find the record
--
-- The document mixes an 'english' vector (stemming: "sings" finds "singing")
-- with a 'simple' vector (raw tokens, so prefix search finds proper nouns
-- like "Brunt" that the stemmer would mangle). Queries are built as 'simple'
-- prefix queries, which then hit both halves.
--
-- Weights:
--   A  title, subtitle, catalog and matrix numbers
--   B  performer and composer names, aliases, the printed credit line
--   C  series, maker, genre, work type, place, description
--   D  notes, lyrics, trivia, provenance, link labels
-- =====================================================================

CREATE TABLE catalog_search (
  record_id  bigint PRIMARY KEY REFERENCES catalog_records(id) ON DELETE CASCADE,
  document   tsvector NOT NULL,
  haystack   text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX catalog_search_document_idx ON catalog_search USING gin (document);
CREATE INDEX catalog_search_haystack_idx ON catalog_search USING gin (haystack gin_trgm_ops);

-- Builds the two-configuration vector for one weight band.
CREATE OR REPLACE FUNCTION weighted_vector(body text, label "char")
RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$
  SELECT setweight(to_tsvector('english', coalesce(body, '')), label)
      || setweight(to_tsvector('simple',  immutable_unaccent(coalesce(body, ''))), label)
$$;

CREATE OR REPLACE FUNCTION rebuild_catalog_search(p_record_id bigint)
RETURNS void LANGUAGE plpgsql AS
$$
DECLARE
  band_a text;
  band_b text;
  band_c text;
  band_d text;
BEGIN
  SELECT
    concat_ws(' ', r.title, r.subtitle, r.catalog_number, r.matrix_number, r.take),
    concat_ws(' ', r.credit_line,
      (SELECT string_agg(concat_ws(' ', p.name, p.full_name, c.detail,
                                   array_to_string(p.aliases, ' ')), ' ')
         FROM record_credits c JOIN people p ON p.id = c.person_id
        WHERE c.record_id = r.id)),
    concat_ws(' ', s.name, m.name, m.short_name, r.genre, r.work_type,
                   r.language, r.recorded_place, r.release_supplement, r.description),
    concat_ws(' ', r.notes, r.lyrics, r.trivia, r.provenance,
      (SELECT string_agg(concat_ws(' ', l.label, l.source_name), ' ')
         FROM record_links l WHERE l.record_id = r.id))
  INTO band_a, band_b, band_c, band_d
  FROM catalog_records r
  JOIN series s ON s.id = r.series_id
  JOIN makers m ON m.id = r.maker_id
  WHERE r.id = p_record_id;

  IF NOT FOUND THEN
    DELETE FROM catalog_search WHERE record_id = p_record_id;
    RETURN;
  END IF;

  INSERT INTO catalog_search (record_id, document, haystack, updated_at)
  VALUES (
    p_record_id,
    weighted_vector(band_a, 'A') || weighted_vector(band_b, 'B')
      || weighted_vector(band_c, 'C') || weighted_vector(band_d, 'D'),
    lower(immutable_unaccent(concat_ws(' ', band_a, band_b, band_c, band_d))),
    now()
  )
  ON CONFLICT (record_id) DO UPDATE
    SET document = EXCLUDED.document,
        haystack = EXCLUDED.haystack,
        updated_at = now();
END
$$;

-- Turns whatever the collector typed into a prefix-matching tsquery.
-- Returns NULL for an empty or punctuation-only search, which callers treat
-- as "no text filter" rather than "match nothing".
CREATE OR REPLACE FUNCTION amberola_tsquery(q text)
RETURNS tsquery LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS
$$
DECLARE
  terms text[];
  parts text[] := '{}';
  t text;
BEGIN
  terms := regexp_split_to_array(
    trim(regexp_replace(lower(immutable_unaccent(coalesce(q, ''))), '[^a-z0-9]+', ' ', 'g')),
    '\s+');

  IF terms IS NULL THEN RETURN NULL; END IF;

  FOREACH t IN ARRAY terms LOOP
    IF length(t) > 0 THEN
      parts := parts || (t || ':*');
    END IF;
  END LOOP;

  IF array_length(parts, 1) IS NULL THEN RETURN NULL; END IF;
  RETURN to_tsquery('simple', array_to_string(parts, ' & '));
END
$$;

-- ---------------------------------------------------------------------
-- Triggers keeping catalog_search in step with everything it draws on
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_catalog_search_self()
RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN PERFORM rebuild_catalog_search(NEW.id); RETURN NULL; END $$;

CREATE OR REPLACE FUNCTION trg_catalog_search_child()
RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM rebuild_catalog_search(OLD.record_id);
  ELSE
    PERFORM rebuild_catalog_search(NEW.record_id);
    IF TG_OP = 'UPDATE' AND OLD.record_id IS DISTINCT FROM NEW.record_id THEN
      PERFORM rebuild_catalog_search(OLD.record_id);
    END IF;
  END IF;
  RETURN NULL;
END
$$;

-- A person's name appears in every record they are credited on, so an edit
-- there fans out. Same for a series or maker being renamed.
CREATE OR REPLACE FUNCTION trg_catalog_search_person()
RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE r bigint;
BEGIN
  FOR r IN SELECT record_id FROM record_credits WHERE person_id = NEW.id LOOP
    PERFORM rebuild_catalog_search(r);
  END LOOP;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION trg_catalog_search_series()
RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE r bigint;
BEGIN
  FOR r IN SELECT id FROM catalog_records WHERE series_id = NEW.id LOOP
    PERFORM rebuild_catalog_search(r);
  END LOOP;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION trg_catalog_search_maker()
RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE r bigint;
BEGIN
  FOR r IN SELECT id FROM catalog_records WHERE maker_id = NEW.id LOOP
    PERFORM rebuild_catalog_search(r);
  END LOOP;
  RETURN NULL;
END
$$;

CREATE TRIGGER catalog_records_search_sync
  AFTER INSERT OR UPDATE ON catalog_records
  FOR EACH ROW EXECUTE FUNCTION trg_catalog_search_self();

CREATE TRIGGER record_credits_search_sync
  AFTER INSERT OR UPDATE OR DELETE ON record_credits
  FOR EACH ROW EXECUTE FUNCTION trg_catalog_search_child();

CREATE TRIGGER record_links_search_sync
  AFTER INSERT OR UPDATE OR DELETE ON record_links
  FOR EACH ROW EXECUTE FUNCTION trg_catalog_search_child();

CREATE TRIGGER people_search_sync
  AFTER UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION trg_catalog_search_person();

CREATE TRIGGER series_search_sync
  AFTER UPDATE ON series
  FOR EACH ROW EXECUTE FUNCTION trg_catalog_search_series();

CREATE TRIGGER makers_search_sync
  AFTER UPDATE ON makers
  FOR EACH ROW EXECUTE FUNCTION trg_catalog_search_maker();

-- Bulk rebuild, used after seeding and available from the API as a repair.
CREATE OR REPLACE FUNCTION rebuild_all_catalog_search()
RETURNS bigint LANGUAGE plpgsql AS
$$
DECLARE n bigint := 0; r bigint;
BEGIN
  FOR r IN SELECT id FROM catalog_records LOOP
    PERFORM rebuild_catalog_search(r);
    n := n + 1;
  END LOOP;
  RETURN n;
END
$$;

-- ---------------------------------------------------------------------
-- Personal notes are searched too, but stay out of the shared index
-- ---------------------------------------------------------------------

CREATE INDEX collection_items_notes_trgm
  ON collection_items USING gin (
    lower(immutable_unaccent(coalesce(personal_notes, '') || ' ' ||
                             coalesce(condition_notes, '') || ' ' ||
                             coalesce(storage_location, '') || ' ' ||
                             coalesce(unmatched_title, ''))) gin_trgm_ops
  );

CREATE INDEX cleaning_events_notes_trgm
  ON cleaning_events USING gin (
    lower(immutable_unaccent(coalesce(notes, '') || ' ' ||
                             coalesce(products_used, '') || ' ' ||
                             coalesce(method_other, ''))) gin_trgm_ops
  );

-- ---------------------------------------------------------------------
-- The list view the master list and the shelf are both rendered from
-- ---------------------------------------------------------------------

CREATE VIEW catalog_record_summary AS
SELECT
  r.id,
  r.slug,
  r.catalog_number,
  r.catalog_sort,
  r.title,
  r.subtitle,
  r.genre,
  r.work_type,
  r.credit_line,
  r.released_on,
  r.release_supplement,
  r.recorded_on,
  r.description,
  r.confidence,
  r.is_stub,
  r.primary_image_id,
  s.id    AS series_id,
  s.slug  AS series_slug,
  s.name  AS series_name,
  s.material,
  s.play_minutes,
  s.colour AS series_colour,
  m.id    AS maker_id,
  m.slug  AS maker_slug,
  m.name  AS maker_name,
  (SELECT string_agg(p.name, ', ' ORDER BY c.billing_order, p.name)
     FROM record_credits c JOIN people p ON p.id = c.person_id
    WHERE c.record_id = r.id
      AND c.role IN ('performer','vocalist','instrumentalist','ensemble',
                     'orchestra','band','speaker','comedian','whistler'))
    AS performers,
  (SELECT string_agg(p.name, ', ' ORDER BY c.billing_order, p.name)
     FROM record_credits c JOIN people p ON p.id = c.person_id
    WHERE c.record_id = r.id AND c.role IN ('composer','lyricist','arranger'))
    AS authors,
  (SELECT count(*) FROM record_links l WHERE l.record_id = r.id) AS link_count,
  (SELECT count(*) FROM collection_items ci WHERE ci.record_id = r.id) AS owned_count
FROM catalog_records r
JOIN series s ON s.id = r.series_id
JOIN makers m ON m.id = r.maker_id;
