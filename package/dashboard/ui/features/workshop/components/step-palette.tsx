import { CalendarClock, ChevronRight, CircleOff, Cpu, ListFilter, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '../../../components/ui/button';
import { combineChoices, ruleChoices } from '../service/conditionInferenceService';
import type { ConditionPreset } from '../models/conditionInferencemodel';
import type { AddableStep } from '../models/workflowInferencemodel';
import { ConditionIcon } from './condition-icon';

export function StepPalette({
  onAdd,
  onClose,
}: {
  onAdd: (kind: AddableStep, preset?: ConditionPreset) => void;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section
      className="wk-inspector wk-step-palette"
      aria-label="Add a workflow step"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <h2 ref={heading} tabIndex={-1}>
          Add a step
        </h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close step library" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="wk-inspector-body">
        <p className="wk-palette-intro">Choose a block, then connect it on the canvas.</p>
        <Button variant="ghost" className="wk-block-choice" onClick={() => onAdd('model')}>
          <Cpu />
          <span>
            <strong>Run a model</strong>
            <small>Detect objects or classify images</small>
          </span>
          <ChevronRight />
        </Button>
        <Button variant="ghost" className="wk-block-choice" onClick={() => onAdd('footage')}>
          <ListFilter />
          <span>
            <strong>Choose footage</strong>
            <small>Filter raw video and extract frames</small>
          </span>
          <ChevronRight />
        </Button>
        <Button variant="ghost" className="wk-block-choice" onClick={() => onAdd('schedule')}>
          <CalendarClock />
          <span>
            <strong>Schedule runs</strong>
            <small>Start at a set time, on new footage, or after another workflow</small>
          </span>
          <ChevronRight />
        </Button>
        <Button variant="ghost" className="wk-block-choice" onClick={() => onAdd('nothing')}>
          <CircleOff />
          <span>
            <strong>Do nothing</strong>
            <small>End a branch without saving the frame</small>
          </span>
          <ChevronRight />
        </Button>
        <h3>Check a condition</h3>
        <p className="wk-palette-caption">Two paths: Then or Otherwise.</p>
        {ruleChoices.map(choice => (
          <Button
            key={choice.kind}
            variant="ghost"
            className="wk-block-choice"
            aria-label={choice.title}
            aria-description={choice.description}
            onClick={() => onAdd('condition', choice.kind)}
          >
            <ConditionIcon kind={choice.kind} />
            <span>
              <strong>{choice.title}</strong>
              <small>{choice.description}</small>
            </span>
            <ChevronRight />
          </Button>
        ))}
        <h3>Combine checks</h3>
        {combineChoices.map(choice => (
          <Button
            key={choice.kind}
            variant="ghost"
            className="wk-block-choice"
            aria-label={choice.title}
            aria-description={choice.description}
            onClick={() => onAdd('condition', choice.kind)}
          >
            <ConditionIcon kind={choice.kind} />
            <span>
              <strong>{choice.title}</strong>
              <small>{choice.description}</small>
            </span>
            <ChevronRight />
          </Button>
        ))}
      </div>
    </section>
  );
}
