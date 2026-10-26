import { useEffect, useId, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Switch } from '../../../components/ui/switch';
import { apiRequest } from '../../../lib/api-request';
import { weekdays } from '../utils/conditionInferenceUtil';
import { nextSlot } from '../utils/scheduleInferenceUtil';
import { SettingsChoices, SettingsRow } from './node-settings-controls';
import type {
  NodeSettingsScreen,
  ScheduleOutcome,
  ScheduleStep,
  ScheduleTrigger,
  WorkflowDraft,
} from '../models/workflowInferencemodel';

const triggers: { value: ScheduleTrigger; label: string; description: string }[] = [
  { value: 'time', label: 'At a set time', description: 'Run the footage window on chosen days' },
  {
    value: 'arrival',
    label: 'When new footage arrives',
    description: 'Every 15 minutes, only what was added since the last run',
  },
  { value: 'workflow', label: 'After another workflow', description: 'When a run of that workflow finishes' },
];
const notes: Record<ScheduleTrigger, string> = {
  time: 'Each run processes the footage filter’s window. Set its recorded day to Day of each run or Day before each run.',
  arrival:
    'Only recordings uploaded since the last scheduled run, inside the footage filter’s time range. A labeled bucket input takes only its new images.',
  workflow:
    'Starts after each full run of that workflow finishes. A labeled bucket input takes only images added since this workflow last ran.',
};
const when = (value: string | Date) =>
  new Date(value).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export function ScheduleFields({
  workflowId,
  data,
  workflows,
  onChange,
  screen,
  onNavigate,
}: {
  workflowId: string;
  data: ScheduleStep;
  workflows: WorkflowDraft[];
  onChange: (data: ScheduleStep) => void;
  screen: NodeSettingsScreen;
  onNavigate: (screen: NodeSettingsScreen) => void;
}) {
  const [outcome, setOutcome] = useState<ScheduleOutcome | null>(null);
  const switchId = useId();
  useEffect(() => {
    const abort = new AbortController();
    void apiRequest<{ schedules: ScheduleOutcome[] }>('/api/workshop/schedules', 'GET', undefined, abort.signal)
      .then(value => setOutcome(value.schedules.find(item => item.workflow_id === workflowId) ?? null))
      .catch(() => {}); // Status is informational; the schedule works without it.
    return () => abort.abort();
  }, [workflowId]);
  if (screen === 'trigger')
    return (
      <SettingsChoices
        label="Triggers"
        options={triggers}
        value={data.trigger}
        onChoose={trigger => {
          onChange({ ...data, trigger: trigger as ScheduleTrigger });
          onNavigate('overview');
        }}
      />
    );
  if (screen === 'followed')
    return (
      <SettingsChoices
        label="Workflows"
        options={workflows.map(item => ({ value: item.id, label: item.name }))}
        value={data.workflowId}
        onChoose={workflowId => {
          onChange({ ...data, workflowId });
          onNavigate('overview');
        }}
        empty="Create another workflow to follow."
      />
    );
  const next = nextSlot(data);
  return (
    <>
      <SettingsRow
        label="Start"
        value={triggers.find(item => item.value === data.trigger)!.label}
        onClick={() => onNavigate('trigger')}
      />
      {data.trigger === 'time' && (
        <>
          <fieldset className="wk-day-field">
            <legend>Days · UTC</legend>
            <div className="wk-day-options">
              {weekdays.map(day => (
                <Button
                  key={day.value}
                  variant="outline"
                  aria-label={day.name}
                  aria-pressed={data.days.includes(day.value)}
                  onClick={() =>
                    onChange({
                      ...data,
                      days: data.days.includes(day.value)
                        ? data.days.filter(value => value !== day.value)
                        : [...data.days, day.value],
                    })
                  }
                >
                  {day.short}
                </Button>
              ))}
            </div>
          </fieldset>
          <label className="wk-field">
            <span>Time · UTC</span>
            <Input
              type="time"
              value={data.at}
              onChange={event => onChange({ ...data, at: event.target.value.slice(0, 5) })}
            />
          </label>
        </>
      )}
      {data.trigger === 'workflow' && (
        <SettingsRow
          label="Follow"
          value={workflows.find(item => item.id === data.workflowId)?.name ?? 'Choose a workflow'}
          onClick={() => onNavigate('followed')}
        />
      )}
      {data.trigger !== 'arrival' && (
        <div className="wk-switch-field">
          <label htmlFor={switchId}>
            {data.trigger === 'workflow' ? 'Only if it saved images' : 'Only if there is footage to process'}
          </label>
          <Switch id={switchId} checked={data.onlyIf} onCheckedChange={onlyIf => onChange({ ...data, onlyIf })} />
        </div>
      )}
      <p className="wk-hint wk-settings-note">{notes[data.trigger]}</p>
      {next && <p className="wk-hint wk-settings-note">Next run {when(next)}</p>}
      {outcome && (
        <p className="wk-hint wk-settings-note" data-status={outcome.status}>
          Last check {when(outcome.checked_at)} ·{' '}
          {outcome.status === 'started'
            ? 'Started a run'
            : outcome.status === 'skipped'
              ? 'Skipped'
              : 'Could not start'}
          : {outcome.message}
        </p>
      )}
    </>
  );
}
