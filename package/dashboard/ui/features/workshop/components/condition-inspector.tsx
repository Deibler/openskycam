import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { ModelVersion } from '../../../../src/models/modelInferencemodel';
import type { ConditionRuleKind, ConditionSettingsScreen, ConditionStep } from '../models/conditionInferencemodel';
import { conditionIssues, newConditionRule, ruleChoices, ruleIssues } from '../service/conditionInferenceService';
import {
  conditionTitle,
  conditionTitles,
  requiresPredictions,
  ruleContext,
  ruleSummary,
} from '../utils/conditionInferenceUtil';
import { ConditionIcon } from './condition-icon';
import { ConditionRuleFields } from './condition-rule-fields';

export function ConditionInspector({
  data,
  model,
  onChange,
  onClose,
  onRemove,
}: {
  data: ConditionStep;
  model?: ModelVersion;
  onChange: (data: ConditionStep) => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  const [screen, setScreen] = useState<ConditionSettingsScreen>({ page: 'overview' });
  const body = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef(''),
    navigating = useRef(false);
  const rule = screen.page === 'rule' ? data.rules.find(rule => rule.id === screen.id) : undefined;
  const issues = rule ? ruleIssues(rule) : conditionIssues(data, model);
  const pageKey = screen.page === 'rule' ? screen.id : screen.page;
  function navigate(next: ConditionSettingsScreen) {
    navigating.current = true;
    setScreen(next);
  }
  function change(next: ConditionStep) {
    onChange({ ...next, label: conditionTitle(next) });
  }
  function add(kind: ConditionRuleKind) {
    if (data.rules.length >= 8) return;
    const rule = newConditionRule(kind);
    change({ ...data, rules: [...data.rules, rule] });
    returnTo.current = rule.id;
    navigate({ page: 'rule', id: rule.id });
  }
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = 0;
    if (!navigating.current) return;
    navigating.current = false;
    const origin =
      screen.page === 'overview'
        ? Array.from(body.current?.querySelectorAll<HTMLElement>('[data-rule]') ?? []).find(
            item => item.dataset.rule === returnTo.current,
          )
        : undefined;
    (origin ?? heading.current)?.focus({ preventScroll: true });
  }, [pageKey, screen.page]);
  return (
    <section
      className="wk-inspector wk-condition-inspector"
      aria-label="Configure condition"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (screen.page === 'overview') onClose();
          else navigate({ page: 'overview' });
        }
      }}
    >
      <header>
        {screen.page !== 'overview' && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to condition"
            onClick={() => navigate({ page: 'overview' })}
          >
            <ArrowLeft />
          </Button>
        )}
        <h2 ref={heading} tabIndex={-1}>
          {screen.page === 'add' ? 'Add a check' : rule ? conditionTitles[rule.kind] : conditionTitle(data)}
        </h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close step settings" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div ref={body} className="wk-inspector-body">
        {screen.page === 'overview' && (
          <>
            <p className="wk-condition-intro">
              Send matching input to <strong>Then</strong>. Send everything else to <strong>Otherwise</strong>.
            </p>
            {data.rules.length > 1 && (
              <fieldset className="wk-condition-fieldset">
                <legend>Continue to Then when</legend>
                <div className="wk-segmented">
                  <Button
                    variant="ghost"
                    aria-pressed={data.match === 'all'}
                    onClick={() => change({ ...data, match: 'all' })}
                  >
                    All checks match
                  </Button>
                  <Button
                    variant="ghost"
                    aria-pressed={data.match === 'any'}
                    onClick={() => change({ ...data, match: 'any' })}
                  >
                    Any check matches
                  </Button>
                </div>
              </fieldset>
            )}
            <div className="wk-rule-stack">
              {data.rules.map((rule, index) => (
                <div key={rule.id}>
                  <span className="wk-rule-join">{index === 0 ? 'If' : data.match === 'all' ? 'And' : 'Or'}</span>
                  <Button
                    variant="outline"
                    className="wk-rule-button"
                    aria-label={`${ruleSummary(rule)} ${ruleContext(rule)}`}
                    data-rule={rule.id}
                    onClick={() => {
                      returnTo.current = rule.id;
                      navigate({ page: 'rule', id: rule.id });
                    }}
                  >
                    <ConditionIcon kind={rule.kind} />
                    <span>
                      <strong>{ruleSummary(rule)}</strong>
                      <small>{ruleContext(rule)}</small>
                    </span>
                    <ChevronRight />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              className="wk-add-check"
              data-rule="add"
              disabled={data.rules.length >= 8}
              onClick={() => {
                returnTo.current = 'add';
                navigate({ page: 'add' });
              }}
            >
              <Plus />
              Add check{data.rules.length >= 8 ? ' · 8 maximum' : ''}
            </Button>
            <div className="wk-condition-routing">
              <div>
                <strong>
                  Then <ArrowRight />
                </strong>
                <span>{data.match === 'all' && data.rules.length > 1 ? 'Every check matches' : 'A check matches'}</span>
              </div>
              <div>
                <strong>
                  Otherwise <ArrowRight />
                </strong>
                <span>{data.match === 'all' ? 'A check does not match' : 'No checks match'}</span>
              </div>
            </div>
            {requiresPredictions(data) && (
              <p className="wk-condition-help">
                {model
                  ? `Checks the labels from ${model.name}.`
                  : 'Connect a model or a labeled bucket to check its predictions.'}
              </p>
            )}
          </>
        )}
        {screen.page === 'add' && (
          <>
            <p className="wk-condition-intro">Add another check to this block.</p>
            {ruleChoices.map(choice => (
              <Button
                key={choice.kind}
                variant="ghost"
                className="wk-block-choice"
                aria-label={choice.title}
                aria-description={choice.description}
                onClick={() => add(choice.kind as ConditionRuleKind)}
              >
                <ConditionIcon kind={choice.kind} />
                <span>
                  <strong>{choice.title}</strong>
                  <small>{choice.description}</small>
                </span>
                <ChevronRight />
              </Button>
            ))}
          </>
        )}
        {rule && (
          <>
            <ConditionRuleFields
              rule={rule}
              classes={model?.classes.map(item => item.name) ?? []}
              onChange={next => change({ ...data, rules: data.rules.map(item => (item.id === next.id ? next : item)) })}
            />
            {['class', 'confidence', 'count'].includes(rule.kind) && (
              <p className="wk-condition-help">
                {rule.kind === 'count'
                  ? 'Requires object detection labels.'
                  : 'Checks predictions passed on by the connected model or bucket.'}
              </p>
            )}
            {data.rules.length > 1 && (
              <Button
                variant="ghost"
                className="wk-remove-check"
                onClick={() => {
                  change({ ...data, rules: data.rules.filter(item => item.id !== rule.id) });
                  returnTo.current = 'add';
                  navigate({ page: 'overview' });
                }}
              >
                <Trash2 />
                Remove check
              </Button>
            )}
          </>
        )}
        {screen.page !== 'add' && issues.length > 0 && (
          <ul className="wk-rule-issues" aria-live="polite">
            {issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        )}
      </div>
      {screen.page === 'overview' && (
        <footer>
          <Button variant="ghost" size="sm" onClick={onRemove}>
            <Trash2 />
            Remove step
          </Button>
        </footer>
      )}
    </section>
  );
}
