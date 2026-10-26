import { CalendarDays, Clock3, Gauge, Hash, ListChecks, ListFilter, Route, Tag } from 'lucide-react';
import type { ConditionPreset } from '../models/conditionInferencemodel';

export function ConditionIcon({ kind }: { kind: ConditionPreset }) {
  const Icon = {
    time: Clock3,
    weekday: CalendarDays,
    confidence: Gauge,
    count: Hash,
    motion: Route,
    class: Tag,
    all: ListChecks,
    any: ListFilter,
  }[kind];
  return <Icon aria-hidden="true" />;
}
