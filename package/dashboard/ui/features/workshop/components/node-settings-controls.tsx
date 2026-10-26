import { useState } from 'react';
import { Check, ChevronRight, Search } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import type { NodeSettingsOption } from '../models/workflowInferencemodel';

export function SettingsRow({
  label,
  value,
  onClick,
  disabled = false,
}: {
  label: string;
  value: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button variant="ghost" className="wk-settings-row" data-settings-row={label} disabled={disabled} onClick={onClick}>
      <span>
        <span className="wk-settings-label">{label}</span> <span className="wk-settings-value">{value}</span>
      </span>
      <ChevronRight aria-hidden="true" />
    </Button>
  );
}

/** A contained page of choices. It never creates a portal or a second floating surface. */
export function SettingsChoices({
  label,
  options,
  value,
  onChoose,
  searchable = false,
  empty = 'No choices available.',
}: {
  label: string;
  options: NodeSettingsOption[];
  value: string;
  onChoose: (value: string) => void;
  searchable?: boolean;
  empty?: string;
}) {
  const [query, setQuery] = useState('');
  const matches = options.filter(option =>
    `${option.label} ${option.description ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div className="wk-settings-choices">
      {searchable && (
        <label className="wk-choice-search">
          <Search aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            aria-label={`Search ${label.toLocaleLowerCase()}`}
            placeholder="Search models"
          />
        </label>
      )}
      <ul aria-label={label}>
        {matches.map(option => (
          <li key={option.value}>
            <Button
              variant="ghost"
              className="wk-choice"
              aria-pressed={option.value === value}
              onClick={() => onChoose(option.value)}
            >
              <span>
                <span>{option.label}</span>
                {option.description && (
                  <>
                    {' '}
                    <small>{option.description}</small>
                  </>
                )}
              </span>
              {option.value === value && <Check aria-hidden="true" />}
            </Button>
          </li>
        ))}
      </ul>
      {!matches.length && <p className="wk-hint">{query ? 'No matching models.' : empty}</p>}
    </div>
  );
}
