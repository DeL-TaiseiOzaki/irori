import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { t } from '../domain/i18n';
import { errorText } from './ErrorMessage';
import {
  isEmptyValue,
  localTimestamp,
  parseProperties,
  requiredKeys,
  setProperty,
  tidyYaml,
  type PageProperties as Declared,
  type PropertyDeclaration,
  type PropertyDefinition,
  type YamlValue,
} from '../domain/properties';
import { relationTarget, relationsFrom } from '../domain/ontology';
import { linkTo } from '../domain/note-links';
import { choosePropertiesFolded, currentPropertiesFolded } from './device-settings';
import { Icon } from './Icon';
import { useResource } from './useResource';
import './page-properties.css';

/** Labels for the keys the Open Knowledge Format and irori-templete use. */
const knownLabels: Record<string, [string, string]> = {
  type: ['種類', 'Type'],
  status: ['状態', 'Status'],
  generated: ['最終更新', 'Last changed'],
  resource: ['ファイル', 'File'],
  sources: ['出典', 'Sources'],
  verified: ['確認', 'Verified'],
  stale_after: ['見直し期限', 'Review by'],
  tags: ['タグ', 'Tags'],
  sensitivity: ['公開範囲', 'Sensitivity'],
  relations: ['関係', 'Relations'],
};
const heading = new Set(['title', 'description']);

function label(key: string) {
  const known = knownLabels[key];
  return known ? t(known[0], known[1]) : key;
}

type Kind = PropertyDefinition['kind'] | 'yaml';

/** The kind a key is shown as: declared, or read from its value. */
function kindOf(definition: PropertyDefinition | undefined, value: YamlValue | undefined): Kind {
  if (definition) return definition.kind;
  if (typeof value === 'string')
    return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(value)
      ? 'datetime'
      : 'text';
  if (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    return 'multi-select';
  if (value === undefined) return 'text';
  return 'yaml';
}

/** An empty value of the shape a kind writes. */
function emptyOf(kind: Kind): YamlValue {
  return kind === 'multi-select' ||
    kind === 'sources' ||
    kind === 'relations' ||
    kind === 'actor-time-list'
    ? []
    : '';
}

const two = (value: number) => String(value).padStart(2, '0');
/** `datetime-local` wants local time without an offset. */
function toLocalInput(value: YamlValue | undefined) {
  if (typeof value !== 'string' || !value) return '';
  const moment = new Date(value);
  if (Number.isNaN(moment.getTime())) return '';
  return `${moment.getFullYear()}-${two(moment.getMonth() + 1)}-${two(moment.getDate())}T${two(moment.getHours())}:${two(moment.getMinutes())}`;
}

function display(value: YamlValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(display).join(', ');
  const entry = value as Record<string, YamlValue>;
  if ('by' in entry || 'at' in entry)
    return [entry.by, entry.at]
      .filter((part) => part !== undefined)
      .map(display)
      .join(' · ');
  const named = entry.title ?? entry.target ?? entry.resource ?? entry.id;
  if (named !== undefined) return [entry.rel, named].filter(Boolean).map(display).join(' → ');
  return JSON.stringify(value);
}

/**
 * A knowledge page's properties, shown above its body instead of the literal
 * YAML block (ADR 015). The frontmatter stays the storage: every change is one
 * value rewritten in place, and the raw YAML is one toggle away.
 */
export function PageProperties({
  yaml,
  declared,
  readOnly,
  fileName,
  scopeId,
  path,
  onChange,
}: {
  /** The YAML between the delimiters; undefined when the page has no frontmatter. */
  yaml: string | undefined;
  declared: Declared | null | undefined;
  readOnly: boolean;
  fileName: string;
  /** The knowledge base and the page's path in it, for picking a relation's target. */
  scopeId?: string;
  path?: string;
  onChange: (yaml: string) => void;
}) {
  const [raw, setRaw] = useState(false);
  // Folded under the title on every page, until the reader opens them again.
  const [folded, setFolded] = useState(currentPropertiesFolded);
  const [problem, setProblem] = useState('');
  const [adding, setAdding] = useState('');
  const declaration = declared?.declaration ?? null;
  const parsed = useMemo(() => parseProperties(yaml), [yaml]);
  const values = parsed.values;

  function set(path: string[], value: YamlValue | undefined) {
    try {
      let next = setProperty(yaml ?? '', path, value);
      // A new type brings the keys it requires, and takes nothing away.
      if (path.length === 1 && path[0] === 'type' && declaration) {
        const present = parseProperties(next).values;
        for (const key of requiredKeys(declaration, value))
          if (!(key in present) && declaration.properties[key]?.auto !== 'last-change')
            next = setProperty(
              next,
              [key],
              emptyOf(kindOf(declaration.properties[key], undefined)),
            );
      }
      setProblem('');
      onChange(tidyYaml(next));
    } catch (error) {
      setProblem(errorText(error));
    }
  }

  if (yaml === undefined)
    return (
      <section className="page-properties empty" aria-label={t('プロパティ', 'Properties')}>
        {declared?.problem && <p className="properties-hint">{declared.problem}</p>}
        {!readOnly && (
          <button
            type="button"
            className="properties-add-first"
            onClick={() => {
              let next = '';
              const title = fileName.replace(/\.md$/i, '');
              const keys = declaration ? requiredKeys(declaration, undefined) : ['title'];
              for (const key of keys) {
                if (declaration?.properties[key]?.auto === 'last-change') continue;
                next = setProperty(
                  next,
                  [key],
                  key === 'title'
                    ? title
                    : emptyOf(kindOf(declaration?.properties[key], undefined)),
                );
              }
              onChange(tidyYaml(next));
            }}
          >
            {t('＋ プロパティを追加', '+ Add properties')}
          </button>
        )}
      </section>
    );

  const showRaw = raw || !!parsed.error;
  // Frontmatter that does not parse stays open, with the reason beside it.
  const shut = folded && !parsed.error;
  const required = new Set(requiredKeys(declaration, values.type));
  const definitions = declaration?.properties ?? {};
  const rowKeys = [
    ...new Set([
      ...Object.keys(definitions).filter((key) => key in values || required.has(key)),
      ...parsed.keys,
      ...required,
    ]),
  ]
    .filter((key) => !heading.has(key))
    .sort((a, b) => (a === 'type' ? -1 : b === 'type' ? 1 : 0));
  const addable = Object.keys(definitions).filter(
    (key) => !(key in values) && !required.has(key) && !heading.has(key),
  );
  const auto = Object.entries(definitions).filter(([, item]) => item.auto === 'last-change');
  const titled = 'title' in values || 'title' in definitions || required.has('title');
  const described =
    'description' in values || 'description' in definitions || required.has('description');

  return (
    <section className="page-properties" aria-label={t('プロパティ', 'Properties')}>
      {declared?.problem && <p className="properties-hint">{declared.problem}</p>}
      {auto.length > 0 && !declared?.actor && !readOnly && (
        <p className="properties-hint">
          {t('Git user.email が未設定です。', 'Git user.email is not set.')}
        </p>
      )}
      {parsed.error && (
        <p className="properties-hint" role="alert">
          {t('frontmatter を読めません: ', 'Could not read the frontmatter: ')}
          {parsed.error}
        </p>
      )}
      {problem && (
        <p className="properties-hint" role="alert">
          {problem}
        </p>
      )}
      {!showRaw && (
        <>
          {titled && (
            <TextField
              className="properties-title"
              label={t('タイトル', 'Title')}
              value={values.title}
              readOnly={readOnly}
              missing={required.has('title') && isEmptyValue(values.title)}
              placeholder={t('無題', 'Untitled')}
              onCommit={(value) => set(['title'], value)}
            />
          )}
          {described && (
            <TextField
              className="properties-description"
              label={t('説明', 'Description')}
              value={values.description}
              readOnly={readOnly}
              missing={required.has('description') && isEmptyValue(values.description)}
              placeholder={t('一文で', 'One sentence')}
              onCommit={(value) => set(['description'], value)}
            />
          )}
        </>
      )}
      <button
        type="button"
        className="properties-fold"
        aria-expanded={!shut}
        onClick={() => {
          setFolded(!folded);
          void choosePropertiesFolded(!folded).catch(() => {});
        }}
      >
        <Icon name={shut ? 'chevron' : 'chevronDown'} size={12} />
        {t('プロパティ', 'Properties')}
        {shut && rowKeys.length > 0 && <span className="properties-count">{rowKeys.length}</span>}
      </button>
      {!shut && (
        <>
          {showRaw ? (
            <textarea
              className="properties-raw"
              aria-label={t('frontmatter（YAML）', 'Frontmatter (YAML)')}
              spellCheck={false}
              readOnly={readOnly}
              value={yaml}
              rows={Math.min(24, Math.max(4, yaml.split('\n').length + 1))}
              onChange={(event) => onChange(event.target.value)}
            />
          ) : (
            <dl className="properties-rows">
              {rowKeys.map((key) => {
                const definition = definitions[key];
                const value = values[key];
                const kind = kindOf(definition, value);
                const missing =
                  required.has(key) && isEmptyValue(value) && definition?.auto !== 'last-change';
                return (
                  <div key={key} className="properties-row" data-missing={missing || undefined}>
                    <dt>
                      {label(key)}
                      {missing && (
                        <span className="properties-required">{t('必須', 'Required')}</span>
                      )}
                    </dt>
                    <dd>
                      {kind === 'relations' && declaration && scopeId && path ? (
                        <Relations
                          value={value}
                          declaration={declaration}
                          type={typeof values.type === 'string' ? values.type : undefined}
                          scopeId={scopeId}
                          path={path}
                          readOnly={readOnly}
                          onSet={(next) => set([key], next)}
                        />
                      ) : (
                        <Value
                          name={label(key)}
                          kind={kind}
                          value={value}
                          definition={definition}
                          options={
                            kind === 'type'
                              ? Object.keys(declaration?.types ?? {})
                              : definition?.options
                          }
                          readOnly={readOnly}
                          onSet={(next) => set([key], next)}
                        />
                      )}
                    </dd>
                    {!readOnly && !required.has(key) && key in values && (
                      <button
                        type="button"
                        className="properties-remove"
                        aria-label={t(`${label(key)} を削除`, `Remove ${label(key)}`)}
                        onClick={() => set([key], undefined)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </dl>
          )}
          <div className="properties-actions">
            {!readOnly && !showRaw && (
              <select
                aria-label={t('プロパティを追加', 'Add a property')}
                value={adding}
                onChange={(event) => {
                  const key = event.target.value;
                  setAdding('');
                  if (key === '\u0000other') {
                    const name = window.prompt(t('プロパティ名', 'Property name'))?.trim();
                    if (name && !(name in values)) set([name], '');
                  } else if (key) set([key], emptyOf(kindOf(definitions[key], undefined)));
                }}
              >
                <option value="">{t('＋ プロパティを追加', '+ Add a property')}</option>
                {addable.map((key) => (
                  <option key={key} value={key}>
                    {label(key)}
                  </option>
                ))}
                <option value={'\u0000other'}>{t('その他の名前…', 'Another name…')}</option>
              </select>
            )}
            {!parsed.error && (
              <button type="button" className="properties-toggle" onClick={() => setRaw(!raw)}>
                {raw
                  ? t('プロパティで編集', 'Edit as properties')
                  : t('YAML で編集', 'Edit as YAML')}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** One line of text, committed as it is typed. */
function TextField({
  className,
  label: name,
  value,
  readOnly,
  missing,
  placeholder,
  onCommit,
}: {
  className: string;
  label: string;
  value: YamlValue | undefined;
  readOnly: boolean;
  missing: boolean;
  placeholder: string;
  onCommit: (value: string) => void;
}) {
  return (
    <input
      className={className}
      aria-label={name}
      data-missing={missing || undefined}
      value={display(value)}
      placeholder={placeholder}
      readOnly={readOnly}
      onChange={(event) => onCommit(event.target.value)}
    />
  );
}

function Value({
  name,
  kind,
  value,
  definition,
  options,
  readOnly,
  onSet,
}: {
  name: string;
  kind: Kind;
  value: YamlValue | undefined;
  definition: PropertyDefinition | undefined;
  options: string[] | undefined;
  readOnly: boolean;
  onSet: (value: YamlValue) => void;
}): ReactNode {
  const listId = useId();
  if ((kind === 'select' || kind === 'type') && options?.length) {
    const current = typeof value === 'string' ? value : display(value);
    const known = options.includes(current);
    return (
      <select
        aria-label={name}
        value={current}
        disabled={readOnly}
        onChange={(event) => onSet(event.target.value)}
      >
        {!current && <option value="">{t('選択してください', 'Choose')}</option>}
        {current && !known && (
          <option value={current}>
            {t(`${current}（宣言にない値）`, `${current} (not declared)`)}
          </option>
        )}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (kind === 'multi-select')
    return (
      <Chips
        name={name}
        value={
          Array.isArray(value) ? value.map(display) : isEmptyValue(value) ? [] : [display(value)]
        }
        suggestions={definition?.options}
        listId={listId}
        readOnly={readOnly}
        onSet={onSet}
      />
    );
  if (kind === 'datetime')
    return (
      <input
        type="datetime-local"
        aria-label={name}
        value={toLocalInput(value)}
        readOnly={readOnly}
        onChange={(event) =>
          onSet(event.target.value ? localTimestamp(new Date(event.target.value)) : '')
        }
      />
    );
  if (kind === 'actor-time')
    return (
      <span className="properties-static">
        {isEmptyValue(value) && definition?.auto === 'last-change'
          ? t('未記録', 'Not recorded')
          : display(value)}
      </span>
    );
  if (
    kind === 'text' ||
    kind === 'link' ||
    (kind === 'select' && !options?.length) ||
    kind === 'type'
  )
    return (
      <input
        aria-label={name}
        value={display(value)}
        readOnly={readOnly}
        onChange={(event) => onSet(event.target.value)}
      />
    );
  // Sources, relations, verification and anything nested: shown here, edited as YAML.
  const items = Array.isArray(value) ? value : isEmptyValue(value) ? [] : [value];
  return items.length ? (
    <ul className="properties-list">
      {items.map((item, index) => (
        <li key={index}>{display(item)}</li>
      ))}
    </ul>
  ) : (
    <span className="properties-static empty">{t('なし', 'None')}</span>
  );
}

/**
 * A page's relations, picked rather than typed (ADR 015 stage 2, ADR 060): the
 * name from the relations the declaration lets a page of this type state, and
 * the target from the pages of the types that relation points at, or a URL. A
 * name or a target the declaration does not allow stays as written and is
 * marked, never dropped.
 */
function Relations({
  value,
  declaration,
  type,
  scopeId,
  path,
  readOnly,
  onSet,
}: {
  value: YamlValue | undefined;
  declaration: PropertyDeclaration;
  type: string | undefined;
  scopeId: string;
  path: string;
  readOnly: boolean;
  onSet: (value: YamlValue) => void;
}) {
  const listId = useId();
  const entries: YamlValue[] = Array.isArray(value)
    ? value
    : value === undefined || isEmptyValue(value)
      ? []
      : [value];
  const allowed = relationsFrom(declaration, type);
  // A relation being added is kept here until it has a name and a target.
  const [draft, setDraft] = useState<{ rel: string; target: string }>();
  // The pages are read when the field is first used, not for every page opened.
  const [wanted, setWanted] = useState(false);
  const pages = useResource(() => window.irori.ontologyPages(scopeId), [scopeId], {
    enabled: wanted && !readOnly,
  });
  const choices = (rel: string) => {
    const to = relationTarget(declaration.relations[rel]?.to);
    if (to === 'url') return undefined;
    return (pages.data ?? [])
      .filter(
        (page) => page.path !== path && (to === 'page' || (!!page.type && to.includes(page.type))),
      )
      .map((page) => ({
        link: linkTo(path, page.path),
        label: [page.title?.trim() || page.path.split('/').at(-1), page.type]
          .filter(Boolean)
          .join(' · '),
      }));
  };
  const row = (
    key: string,
    entry: { rel: string; target: string },
    change: (next: { rel: string; target: string }) => void,
    remove: () => void,
  ) => {
    const known = allowed.includes(entry.rel);
    const options = choices(entry.rel);
    const url = relationTarget(declaration.relations[entry.rel]?.to) === 'url';
    return (
      <li key={key} className="properties-relation">
        <select
          aria-label={t('関係', 'Relation')}
          value={entry.rel}
          disabled={readOnly}
          onChange={(event) => change({ ...entry, rel: event.target.value })}
        >
          {!entry.rel && <option value="">{t('選択してください', 'Choose')}</option>}
          {entry.rel && !known && (
            <option value={entry.rel}>
              {Object.prototype.hasOwnProperty.call(declaration.relations, entry.rel)
                ? t(`${entry.rel}（この種類からは使えません）`, `${entry.rel} (not from this type)`)
                : t(`${entry.rel}（宣言にない値）`, `${entry.rel} (not declared)`)}
            </option>
          )}
          {allowed.map((name) => (
            <option key={name} value={name} title={declaration.relations[name]?.description}>
              {name}
            </option>
          ))}
        </select>
        <input
          aria-label={t('関係の相手', 'Relation target')}
          type={url ? 'url' : 'text'}
          value={entry.target}
          readOnly={readOnly}
          list={options?.length ? `${listId}-${key}` : undefined}
          placeholder={url ? 'https://' : t('ページを選ぶ', 'Choose a page')}
          onFocus={() => setWanted(true)}
          onChange={(event) => change({ ...entry, target: event.target.value })}
        />
        {options?.length ? (
          <datalist id={`${listId}-${key}`}>
            {options.map((option) => (
              <option key={option.link} value={option.link} label={option.label} />
            ))}
          </datalist>
        ) : null}
        {!readOnly && (
          <button
            type="button"
            className="properties-remove"
            aria-label={t('この関係を削除', 'Remove this relation')}
            onClick={remove}
          >
            ×
          </button>
        )}
      </li>
    );
  };
  const text = (item: YamlValue, key: string) =>
    isRecord(item) && typeof item[key] === 'string' ? (item[key] as string) : '';
  return (
    <ul className="properties-relations">
      {entries.map((item, index) =>
        isRecord(item) ? (
          row(
            String(index),
            { rel: text(item, 'rel'), target: text(item, 'target') },
            // Keys the entry carries besides these two stay with it.
            (next) =>
              onSet(entries.map((other, at) => (at === index ? { ...item, ...next } : other))),
            () => onSet(entries.filter((_, at) => at !== index)),
          )
        ) : (
          <li key={index} className="properties-static">
            {display(item)}
          </li>
        ),
      )}
      {draft &&
        row(
          'new',
          draft,
          (next) => {
            // Written once it says something: a name and a target.
            if (next.rel && next.target.trim()) {
              setDraft(undefined);
              onSet([...entries, { rel: next.rel, target: next.target.trim() }]);
            } else setDraft(next);
          },
          () => setDraft(undefined),
        )}
      {!readOnly && !draft && (
        <li>
          <button
            type="button"
            className="properties-add-relation"
            disabled={!allowed.length}
            title={
              allowed.length
                ? undefined
                : t(
                    'この種類のページから使える関係は宣言されていません。',
                    'No relation is declared for a page of this type.',
                  )
            }
            onClick={() => {
              setWanted(true);
              setDraft({ rel: allowed[0] ?? '', target: '' });
            }}
          >
            {t('＋ 関係を追加', '+ Add a relation')}
          </button>
        </li>
      )}
    </ul>
  );
}

const isRecord = (value: unknown): value is Record<string, YamlValue> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function Chips({
  name,
  value,
  suggestions,
  listId,
  readOnly,
  onSet,
}: {
  name: string;
  value: string[];
  suggestions: string[] | undefined;
  listId: string;
  readOnly: boolean;
  onSet: (value: YamlValue) => void;
}) {
  const [draft, setDraft] = useState('');
  function add() {
    const item = draft.trim();
    setDraft('');
    if (item && !value.includes(item)) onSet([...value, item]);
  }
  function key(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && !draft && value.length) onSet(value.slice(0, -1));
  }
  return (
    <span className="properties-chips">
      {value.map((item) => (
        <span key={item} className="properties-chip">
          {item}
          {!readOnly && (
            <button
              type="button"
              aria-label={t(`${item} を外す`, `Remove ${item}`)}
              onClick={() => onSet(value.filter((other) => other !== item))}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          aria-label={name}
          value={draft}
          list={suggestions?.length ? listId : undefined}
          placeholder={value.length ? '' : t('入力して Enter', 'Type and press Enter')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={key}
          onBlur={add}
        />
      )}
      {suggestions?.length ? (
        <datalist id={listId}>
          {suggestions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
    </span>
  );
}
