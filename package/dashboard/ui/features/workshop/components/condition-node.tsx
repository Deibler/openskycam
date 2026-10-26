import { useLayoutEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { ArrowRight } from 'lucide-react';
import type { ConditionStep } from '../models/conditionInferencemodel';
import { conditionTitle, ruleContext, ruleSummary } from '../utils/conditionInferenceUtil';
import { ConditionIcon } from './condition-icon';

export function ConditionNode({ id, data, selected }: { id: string; data: ConditionStep; selected?: boolean }) {
  const updateInternals = useUpdateNodeInternals();
  // Rule edits can move the two branch ports without moving the node itself.
  useLayoutEffect(() => {
    updateInternals(id);
  }, [id, data, updateInternals]);
  return (
    <article
      className="wk-node wk-node-condition"
      data-selected={selected || undefined}
      aria-label={`${conditionTitle(data)} condition`}
    >
      <Handle type="target" className="wk-input-port" position={Position.Left} id="in" aria-label="Condition input" />
      <div className="wk-condition-heading">
        <ConditionIcon kind={data.rules.length === 1 ? data.rules[0].kind : data.match} />
        <strong>{conditionTitle(data)}</strong>
      </div>
      <div className="wk-condition-statement">
        {data.rules.slice(0, 2).map((rule, index) => (
          <div className="wk-node-rule" key={rule.id}>
            <span>{index === 0 ? 'If' : data.match === 'all' ? 'and' : 'or'}</span>
            <div>
              <strong>{ruleSummary(rule)}</strong>
              {(rule.kind === 'time' || rule.kind === 'weekday') && <small>{ruleContext(rule)}</small>}
            </div>
          </div>
        ))}
        {data.rules.length > 2 && (
          <span className="wk-more-rules">
            {data.match === 'all' ? 'and' : 'or'} {data.rules.length - 2} more{' '}
            {data.rules.length === 3 ? 'check' : 'checks'}
          </span>
        )}
      </div>
      <div className="wk-condition-path">
        <span>Then</span>
        <small>Match</small>
        <ArrowRight />
        <Handle type="source" position={Position.Right} id="yes" aria-label="Then output" />
      </div>
      <div className="wk-condition-path wk-condition-otherwise">
        <span>Otherwise</span>
        <small>No match</small>
        <ArrowRight />
        <Handle type="source" position={Position.Right} id="no" aria-label="Otherwise output" />
      </div>
    </article>
  );
}
