/**
 * The filter apparatus for the master list.
 *
 * Every control here reads from and writes to the URL, so a filtered view can
 * be bookmarked, shared and reached again with the back button. Options come
 * from the facet counts the API returns for the whole filtered set, and a
 * filter with nothing to offer is not drawn at all.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Checkbox } from '../ui';
import { MATERIAL_LABELS, type CylinderMaterial, type Facets, type Lookups } from '../../lib/api';

export interface CatalogFilterValues {
  maker: string[];
  series: string[];
  person: string[];
  genre: string[];
  confidence: string[];
  material: string;
  playMinutes: string;
  yearFrom: string;
  yearTo: string;
  owned: string;
  hasAudio: boolean;
}

export interface CatalogFilterProps {
  values: CatalogFilterValues;
  facets?: Facets;
  lookups?: Lookups | null;
  /** Names for person slugs that are filtered on but have no facet of their own. */
  personLabels?: Record<string, string>;
  onToggle: (key: keyof CatalogFilterValues, value: string) => void;
  onSet: (key: keyof CatalogFilterValues, value: string | boolean) => void;
  /** Sets several filters as one navigation, so neither overwrites the other. */
  onSetMany: (patch: Partial<Record<keyof CatalogFilterValues, string | boolean>>) => void;
  onClear: () => void;
  activeCount: number;
}

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="label-type" style={{ padding: 0, marginBottom: 'var(--space-2)' }}>
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

function CountedList({
  options, selected, onToggle, name,
}: {
  options: { value: string; label: string; count: number }[];
  selected: string[];
  onToggle: (value: string) => void;
  name: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? options : options.slice(0, 6);
  return (
    <div>
      {visible.map((option) => (
        <Checkbox
          key={option.value}
          id={`${name}-${option.value}`}
          checked={selected.includes(option.value)}
          onChange={() => onToggle(option.value)}
          label={
            <span style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline',
                           fontSize: 'var(--text-base)' }}>
              <span>{option.label}</span>
              <span className="stamp-type" style={{ color: 'var(--fg-faint)' }}>
                {option.count}
              </span>
            </span>
          }
        />
      ))}
      {options.length > 6 && (
        <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}>
          {showAll ? 'Fewer' : `All ${options.length}`}
        </Button>
      )}
    </div>
  );
}

export function CatalogFilters({
  values, facets, lookups, personLabels = {}, onToggle, onSet, onSetMany, onClear, activeCount,
}: CatalogFilterProps) {
  const makerOptions = (facets?.makers ?? [])
    .map((m) => ({ value: m.slug, label: m.name, count: m.count }));
  const seriesOptions = (facets?.series ?? [])
    .map((s) => ({ value: s.slug, label: s.name, count: s.count }));
  const genreOptions = (facets?.genres ?? [])
    .filter((g) => g.value)
    .map((g) => ({ value: g.value, label: g.value, count: g.count }));
  const decades = (facets?.decades ?? []).filter((d) => d.value).slice().sort((a, b) => a.value - b.value);

  // Materials and playing times are properties of a series, so the options are
  // whatever the register's series actually use.
  const seriesFromLookups = lookups?.series ?? [];
  const materialOptions = Array.from(
    new Set(seriesFromLookups.map((s) => s.material).filter(Boolean)),
  ) as CylinderMaterial[];
  const playOptions = Array.from(
    new Set(seriesFromLookups.map((s) => s.playMinutes).filter((m): m is number => !!m)),
  ).sort((a, b) => a - b);

  const nothingToFilter =
    !makerOptions.length && !seriesOptions.length && !genreOptions.length &&
    !decades.length && !materialOptions.length;

  if (nothingToFilter && !activeCount) return null;

  return (
    <div className="stack" style={{ display: 'grid', gap: 'var(--space-5)' }}>
      {activeCount > 0 && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label-type">
            {activeCount} filter{activeCount === 1 ? '' : 's'} applied
          </span>
          <Button size="sm" variant="ghost" onClick={onClear}>Clear all</Button>
        </div>
      )}

      {values.person.length > 0 && (
        <Group legend="Credited person">
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            {values.person.map((slug) => (
              <Button key={slug} size="sm" variant="ghost" onClick={() => onToggle('person', slug)}>
                {personLabels[slug] ?? slug} <span aria-hidden="true">✕</span>
                <span className="visually-hidden">Remove this person filter</span>
              </Button>
            ))}
          </div>
        </Group>
      )}

      {makerOptions.length > 0 && (
        <Group legend="Maker">
          <CountedList name="maker" options={makerOptions} selected={values.maker}
                       onToggle={(v) => onToggle('maker', v)} />
        </Group>
      )}

      {seriesOptions.length > 0 && (
        <Group legend="Series">
          <CountedList name="series" options={seriesOptions} selected={values.series}
                       onToggle={(v) => onToggle('series', v)} />
        </Group>
      )}

      {genreOptions.length > 0 && (
        <Group legend="Genre">
          <CountedList name="genre" options={genreOptions} selected={values.genre}
                       onToggle={(v) => onToggle('genre', v)} />
        </Group>
      )}

      {materialOptions.length > 0 && (
        <Group legend="Material">
          <label className="visually-hidden" htmlFor="filter-material">Material</label>
          <select
            id="filter-material"
            className="field"
            value={values.material}
            onChange={(e) => onSet('material', e.target.value)}
          >
            <option value="">Any material</option>
            {materialOptions.map((m) => (
              <option key={m} value={m}>{MATERIAL_LABELS[m] ?? m}</option>
            ))}
          </select>
        </Group>
      )}

      {playOptions.length > 1 && (
        <Group legend="Playing time">
          <label className="visually-hidden" htmlFor="filter-play">Playing time</label>
          <select
            id="filter-play"
            className="field"
            value={values.playMinutes}
            onChange={(e) => onSet('playMinutes', e.target.value)}
          >
            <option value="">Any length</option>
            {playOptions.map((m) => (
              <option key={m} value={String(m)}>{m}-minute</option>
            ))}
          </select>
        </Group>
      )}

      {(decades.length > 0 || values.yearFrom || values.yearTo) && (
        <Group legend="Years">
          {decades.length > 0 && (
            <div className="row" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              {decades.map((d) => {
                const active = values.yearFrom === String(d.value)
                  && values.yearTo === String(d.value + 9);
                return (
                  <Button
                    key={d.value}
                    size="sm"
                    variant={active ? 'brass' : 'ghost'}
                    aria-pressed={active}
                    onClick={() => onSetMany(
                      active
                        ? { yearFrom: '', yearTo: '' }
                        : { yearFrom: String(d.value), yearTo: String(d.value + 9) },
                    )}
                  >
                    {d.value}s <span className="stamp-type">{d.count}</span>
                  </Button>
                );
              })}
            </div>
          )}
          <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'nowrap' }}>
            <div style={{ flex: 1 }}>
              <label className="field-label" htmlFor="filter-year-from">From</label>
              <input
                id="filter-year-from" className="field" type="number" inputMode="numeric"
                min={1877} max={2100} placeholder="1908"
                value={values.yearFrom}
                onChange={(e) => onSet('yearFrom', e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label" htmlFor="filter-year-to">To</label>
              <input
                id="filter-year-to" className="field" type="number" inputMode="numeric"
                min={1877} max={2100} placeholder="1929"
                value={values.yearTo}
                onChange={(e) => onSet('yearTo', e.target.value)}
              />
            </div>
          </div>
        </Group>
      )}

      <Group legend="Certainty">
        {(['verified', 'probable', 'uncertain'] as const).map((c) => (
          <Checkbox
            key={c}
            id={`filter-confidence-${c}`}
            checked={values.confidence.includes(c)}
            onChange={() => onToggle('confidence', c)}
            label={c[0].toUpperCase() + c.slice(1)}
          />
        ))}
      </Group>

      <Group legend="The shelf">
        <Checkbox
          id="filter-owned"
          checked={values.owned === 'true'}
          onChange={(on) => onSet('owned', on ? 'true' : '')}
          label="Only titles I own"
        />
        <Checkbox
          id="filter-not-owned"
          checked={values.owned === 'false'}
          onChange={(on) => onSet('owned', on ? 'false' : '')}
          label="Only titles I do not own"
        />
        <Checkbox
          id="filter-audio"
          checked={values.hasAudio}
          onChange={(on) => onSet('hasAudio', on)}
          label="Has a recording to listen to"
        />
      </Group>
    </div>
  );
}

export default CatalogFilters;
