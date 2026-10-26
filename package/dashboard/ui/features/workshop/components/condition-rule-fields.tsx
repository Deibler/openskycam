import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import type { ConditionRule } from '../models/conditionInferencemodel';
import { motionNames, weekdays } from '../utils/conditionInferenceUtil';

function ClassField({
  value,
  classes,
  optional,
  onChange,
}: {
  value: string;
  classes: string[];
  optional: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="wk-condition-class">
      <label className="wk-field">
        <span>{optional ? 'Limit to a class' : 'Class name'}</span>
        <Input
          value={value}
          placeholder={optional ? 'All classes' : 'e.g. Car'}
          maxLength={100}
          onChange={event => onChange(event.target.value)}
        />
      </label>
      {(classes.length > 0 || optional) && (
        <div className="wk-class-suggestions" aria-label="Classes from the connected model">
          {optional && (
            <Button size="sm" variant="outline" aria-pressed={!value} onClick={() => onChange('')}>
              All classes
            </Button>
          )}
          {classes.map(name => (
            <Button key={name} size="sm" variant="outline" aria-pressed={name === value} onClick={() => onChange(name)}>
              {name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
export function ConditionRuleFields({
  rule,
  classes,
  onChange,
}: {
  rule: ConditionRule;
  classes: string[];
  onChange: (rule: ConditionRule) => void;
}) {
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="wk-rule-fields">
      {rule.kind === 'time' && (
        <>
          <div className="wk-field-pair">
            <label className="wk-field">
              <span>From</span>
              <Input
                type="time"
                value={rule.from}
                onChange={event => onChange({ ...rule, from: event.target.value })}
              />
            </label>
            <label className="wk-field">
              <span>Until</span>
              <Input
                type="time"
                value={rule.until}
                onChange={event => onChange({ ...rule, until: event.target.value })}
              />
            </label>
          </div>
          <p className="wk-condition-help">
            Uses the recording time. Start is included; end is excluded.
            {rule.from > rule.until ? ' This window continues into the next day.' : ''}
          </p>
        </>
      )}
      {rule.kind === 'weekday' && (
        <fieldset className="wk-day-field">
          <legend>Recorded on</legend>
          <div className="wk-day-options">
            {weekdays.map(day => (
              <Button
                key={day.value}
                variant="outline"
                aria-label={day.name}
                aria-pressed={rule.days.includes(day.value)}
                onClick={() =>
                  onChange({
                    ...rule,
                    days: rule.days.includes(day.value)
                      ? rule.days.filter(value => value !== day.value)
                      : [...rule.days, day.value],
                  })
                }
              >
                {day.short}
              </Button>
            ))}
          </div>
        </fieldset>
      )}
      {(rule.kind === 'time' || rule.kind === 'weekday') && (
        <div className="wk-zone-field">
          <label className="wk-field">
            <span>Time zone</span>
            <Input
              value={rule.timeZone}
              maxLength={100}
              placeholder="America/New_York"
              onChange={event => onChange({ ...rule, timeZone: event.target.value })}
            />
          </label>
          <div className="wk-zone-options">
            <Button
              size="sm"
              variant="outline"
              aria-pressed={rule.timeZone === 'UTC'}
              onClick={() => onChange({ ...rule, timeZone: 'UTC' })}
            >
              UTC
            </Button>
            {localZone !== 'UTC' && (
              <Button
                size="sm"
                variant="outline"
                aria-pressed={rule.timeZone === localZone}
                onClick={() => onChange({ ...rule, timeZone: localZone })}
              >
                My time zone
              </Button>
            )}
          </div>
        </div>
      )}
      {rule.kind === 'class' && (
        <>
          <ClassField
            value={rule.className}
            classes={classes}
            optional={false}
            onChange={className => onChange({ ...rule, className })}
          />
          <fieldset className="wk-condition-fieldset">
            <legend>In each image, the class</legend>
            <div className="wk-segmented">
              {(['present', 'absent'] as const).map(operator => (
                <Button
                  key={operator}
                  variant="ghost"
                  aria-pressed={rule.operator === operator}
                  onClick={() => onChange({ ...rule, operator })}
                >
                  Is {operator}
                </Button>
              ))}
            </div>
          </fieldset>
        </>
      )}
      {rule.kind === 'confidence' && (
        <>
          <fieldset className="wk-condition-fieldset">
            <legend>At least one prediction scores</legend>
            <div className="wk-segmented">
              {(['at-least', 'below'] as const).map(operator => (
                <Button
                  key={operator}
                  variant="ghost"
                  aria-pressed={rule.operator === operator}
                  onClick={() => onChange({ ...rule, operator })}
                >
                  {operator === 'at-least' ? 'At least' : 'Below'}
                </Button>
              ))}
            </div>
          </fieldset>
          <label className="wk-field">
            <span>Confidence (%)</span>
            <Input
              type="number"
              min="0"
              max="100"
              step="1"
              value={Math.round(rule.threshold * 100)}
              onChange={event => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 0 && value <= 100) onChange({ ...rule, threshold: value / 100 });
              }}
            />
          </label>
          <ClassField
            value={rule.className}
            classes={classes}
            optional
            onChange={className => onChange({ ...rule, className })}
          />
        </>
      )}
      {rule.kind === 'motion' && (
        <>
          <fieldset className="wk-condition-fieldset">
            <legend>Across the recording, at least one box</legend>
            <div className="wk-segmented">
              {(['moving', 'stationary', 'brief'] as const).map(operator => (
                <Button
                  key={operator}
                  variant="ghost"
                  aria-pressed={rule.operator === operator}
                  onClick={() => onChange({ ...rule, operator })}
                >
                  {motionNames[operator]}
                </Button>
              ))}
            </div>
          </fieldset>
          <p className="wk-condition-help">
            Each box is followed through its recording. Stars and lights stay still; planes and satellites move. A
            box seen once or only briefly, like a meteor, is too brief to tell. To keep planes and set fixed lights
            aside, match any of Is moving and Seen too briefly.
          </p>
          <ClassField
            value={rule.className}
            classes={classes}
            optional
            onChange={className => onChange({ ...rule, className })}
          />
        </>
      )}
      {rule.kind === 'count' && (
        <>
          <fieldset className="wk-condition-fieldset">
            <legend>Number of detections in each image</legend>
            <div className="wk-segmented">
              {(['at-least', 'equal', 'at-most'] as const).map(operator => (
                <Button
                  key={operator}
                  variant="ghost"
                  aria-pressed={rule.operator === operator}
                  onClick={() => onChange({ ...rule, operator })}
                >
                  {operator === 'at-least' ? 'At least' : operator === 'at-most' ? 'At most' : 'Exactly'}
                </Button>
              ))}
            </div>
          </fieldset>
          <label className="wk-field">
            <span>Detections</span>
            <Input
              type="number"
              min="0"
              step="1"
              value={rule.count}
              onChange={event => {
                const value = Number(event.target.value);
                if (Number.isSafeInteger(value) && value >= 0) onChange({ ...rule, count: value });
              }}
            />
          </label>
          <ClassField
            value={rule.className}
            classes={classes}
            optional
            onChange={className => onChange({ ...rule, className })}
          />
        </>
      )}
    </div>
  );
}
