import type { WorkflowDraft, WorkflowNode } from '../models/workflowInferencemodel';

function nodeSize(node: WorkflowNode) {
  const condition = node.data.kind === 'condition' ? node.data : undefined;
  return {
    width: Math.max(node.measured?.width ?? 0, condition ? 264 : 232),
    height: Math.max(
      node.measured?.height ?? 0,
      condition ? 218 + (condition.rules.length > 1 ? 70 : 0) + (condition.rules.length > 2 ? 28 : 0) : 180,
    ),
  };
}
export function findOpenPosition(nodes: WorkflowNode[], preferred: WorkflowNode['position']): WorkflowNode['position'] {
  const position = { ...preferred };
  let overlap: WorkflowNode | undefined;
  while (
    (overlap = nodes.find(
      node =>
        position.x < node.position.x + nodeSize(node).width + 48 &&
        position.x + 264 + 48 > node.position.x &&
        position.y < node.position.y + nodeSize(node).height + 48 &&
        position.y + 316 + 48 > node.position.y,
    ))
  )
    position.y = overlap.position.y + nodeSize(overlap).height + 64;
  return position;
}

/** Deterministic left-to-right DAG layout. Disconnected draft nodes remain accessible. */
export function arrangeWorkflow(workflow: WorkflowDraft): WorkflowDraft {
  if (!workflow.edges.length) {
    let y = 100;
    return {
      ...workflow,
      nodes: workflow.nodes.map((node, index) => {
        if (index && index % 4 === 0)
          y += Math.max(...workflow.nodes.slice(index - 4, index).map(item => nodeSize(item).height)) + 72;
        return { ...node, position: { x: (index % 4) * 360, y } };
      }),
    };
  }
  const depth = new Map<string, number>();
  const visit = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = workflow.edges
      .filter(edge => edge.target === id)
      .map(edge => visit(edge.source, new Set(seen)) + 1);
    const value = Math.max(0, ...parents);
    depth.set(id, value);
    return value;
  };
  workflow.nodes.forEach(node => visit(node.id));
  const columns = new Map<number, string[]>();
  workflow.nodes.forEach(node => {
    const column = depth.get(node.id)!;
    columns.set(column, [...(columns.get(column) ?? []), node.id]);
  });
  return {
    ...workflow,
    nodes: workflow.nodes.map(node => {
      const column = depth.get(node.id)!,
        siblings = columns.get(column)!;
      const heights = siblings.map(id => nodeSize(workflow.nodes.find(item => item.id === id)!).height + 72);
      const preceding = heights.slice(0, siblings.indexOf(node.id)).reduce((sum, height) => sum + height, 0);
      return {
        ...node,
        position: {
          x: column * 360,
          y: 100 + preceding - (heights.reduce((sum, height) => sum + height, 0) - heights[0]) / 2,
        },
      };
    }),
  };
}
