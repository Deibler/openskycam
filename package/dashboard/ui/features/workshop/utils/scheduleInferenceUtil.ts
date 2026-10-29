import type { ScheduleStep, WorkflowDraft } from '../models/workflowInferencemodel';

/** Recorded days that move with each run, in days from the run's UTC date. Mirrors the server. */
export const relativeDays: Record<string, { offset: number; label: string }> = {
  'run-day': { offset: 0, label: 'Day of each run' },
  'previous-day': { offset: -1, label: 'Day before each run' },
};
export const isRelativeDay = (day: string) => Object.hasOwn(relativeDays, day);
export const resolveDay = (day: string, now = new Date()) =>
  isRelativeDay(day) ? new Date(+now + relativeDays[day].offset * 86400000).toISOString().slice(0, 10) : day;
// Matches the server's grace for the relay to upload a window's last clips.
export const uploadGraceMinutes = 10;
// Matches the server: new-footage runs check every 15 minutes.
export const arrivalMinutes = 15;
export const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function scheduleSummary(data: ScheduleStep, workflows: WorkflowDraft[]) {
  if (data.trigger === 'arrival') return 'When new footage arrives';
  if (data.trigger === 'workflow')
    return `After ${workflows.find(w => w.id === data.workflowId)?.name ?? 'another workflow'}`;
  if (!data.at || !data.days.length) return 'Choose days and a time';
  const days =
    data.days.length === 7
      ? 'Every day'
      : [...data.days]
          .sort()
          .map(day => dayNames[day])
          .join(', ');
  return `${days} at ${data.at} UTC`;
}

/** The next set-time slot after now, or null when the schedule is incomplete. */
export function nextSlot(data: ScheduleStep, now = new Date()) {
  if (data.trigger !== 'time' || !/^\d\d:\d\d$/.test(data.at) || !data.days.length) return null;
  for (let ahead = 0; ahead <= 7; ahead++) {
    const slot = new Date(`${new Date(+now + ahead * 86400000).toISOString().slice(0, 10)}T${data.at}:00Z`);
    if (slot > now && data.days.includes(slot.getUTCDay())) return slot;
  }
  return null;
}

/** True when following `target` from `workflow` would lead back to `workflow`. */
export function followLoop(workflow: string, target: string, workflows: WorkflowDraft[]) {
  const seen = new Set<string>();
  for (let id: string | undefined = target; id && !seen.has(id); ) {
    if (id === workflow) return true;
    seen.add(id);
    const next = workflows
      .find(w => w.id === id)
      ?.nodes.find(n => n.data.kind === 'schedule' && n.data.trigger === 'workflow')?.data;
    id = next?.kind === 'schedule' ? next.workflowId : undefined;
  }
  return false;
}

export function workflowSchedule(workflow: WorkflowDraft) {
  const data = workflow.nodes.find(node => node.data.kind === 'schedule')?.data;
  return data?.kind === 'schedule' ? data : undefined;
}
/** Latest HH:MM:SS a Day-of-each-run window may end for a set-time schedule. '' means none fits; null means no limit. */
export function latestUntil(schedule?: ScheduleStep) {
  if (schedule?.trigger !== 'time' || !/^\d\d:\d\d$/.test(schedule.at)) return null;
  const latest = minutesOf(schedule.at) - uploadGraceMinutes;
  return latest < 0 ? '' : `${clock(latest)}:00`;
}
export const fullTime = (time: string) => (time.length === 5 ? `${time}:00` : time);
