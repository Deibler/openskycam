import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import type { WorkshopBucket } from '../models/bucketInferencemodel';
import { canConnect, workflowEdge } from '../service/workflowInferenceService';
import type { WorkflowDraft, WorkflowEdge, WorkflowMutation, WorkflowNode } from '../models/workflowInferencemodel';

/** High-frequency canvas state stays here. Persist positions only when a drag ends. */
export function useWorkflowCanvas(
  workflow: WorkflowDraft,
  onUpdate: (mutation: WorkflowMutation) => void,
  buckets: WorkshopBucket[],
) {
  const [nodes, setNodes] = useState(workflow.nodes);
  const [edges, setEdges] = useState(workflow.edges);
  const [selectedId, selectNode] = useState('');
  const [selectedEdge, selectEdge] = useState('');
  const flow = useReactFlow<WorkflowNode, WorkflowEdge>();
  const update = useRef(onUpdate);
  update.current = onUpdate;
  const selected = useRef(selectedId);
  selected.current = selectedId;
  useEffect(() => {
    setNodes(workflow.nodes.map(node => ({ ...node, selected: node.id === selected.current })));
  }, [workflow.nodes]);
  useEffect(() => {
    setEdges(workflow.edges);
  }, [workflow.edges]);
  const nodesChanged = useCallback((changes: NodeChange<WorkflowNode>[]) => {
    setNodes(current => applyNodeChanges(changes, current));
    const selection = changes.find(change => change.type === 'select' && change.selected);
    if (selection?.type === 'select') {
      selectNode(selection.id);
      selectEdge('');
    }
  }, []);
  const edgesChanged = useCallback((changes: EdgeChange[]) => {
    setEdges(current => applyEdgeChanges(changes, current));
  }, []);
  const validConnection = useCallback(
    (connection: Connection | WorkflowEdge) =>
      canConnect(
        {
          ...connection,
          sourceHandle: connection.sourceHandle ?? 'out',
          targetHandle: connection.targetHandle ?? 'in',
        },
        flow.getNodes(),
        flow.getEdges(),
        buckets,
      ),
    [flow, buckets],
  );
  const connect = useCallback(
    (connection: Connection) => {
      if (!validConnection(connection)) return;
      update.current(current => ({
        ...current,
        edges: [...current.edges, workflowEdge(connection.source, connection.target, connection.sourceHandle ?? 'out')],
      }));
    },
    [validConnection],
  );
  const commitPositions = useCallback(() => {
    const positions = new Map(flow.getNodes().map(node => [node.id, node.position]));
    update.current(current => ({
      ...current,
      nodes: current.nodes.map(node => ({ ...node, position: positions.get(node.id) ?? node.position })),
    }));
  }, [flow]);
  const deleteNodes = useCallback((removed: WorkflowNode[]) => {
    const ids = new Set(removed.filter(node => !['input', 'output'].includes(node.data.kind)).map(node => node.id));
    if (!ids.size) return;
    update.current(current => ({
      ...current,
      nodes: current.nodes.filter(node => !ids.has(node.id)),
      edges: current.edges.filter(edge => !ids.has(edge.source) && !ids.has(edge.target)),
    }));
    selectNode('');
  }, []);
  const deleteEdges = useCallback((removed: WorkflowEdge[]) => {
    const ids = new Set(removed.map(edge => edge.id));
    update.current(current => ({ ...current, edges: current.edges.filter(edge => !ids.has(edge.id)) }));
    selectEdge('');
  }, []);
  const moveEnd = useCallback((_: unknown, viewport: { x: number; y: number; zoom: number }) => {
    update.current(current => ({ ...current, viewport }));
  }, []);
  return {
    nodes,
    edges,
    selectedId,
    selectedEdge,
    selectNode,
    selectEdge,
    nodesChanged,
    edgesChanged,
    connect,
    validConnection,
    commitPositions,
    deleteNodes,
    deleteEdges,
    moveEnd,
  };
}
