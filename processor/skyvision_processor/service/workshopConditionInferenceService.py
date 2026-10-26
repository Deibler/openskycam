"""Evaluate image-level conditions using capture time, the current model's predictions, and their tracks."""
from datetime import datetime
from zoneinfo import ZoneInfo


def match_rule(rule, captured_at, annotations, tracks=None):
    kind = rule['kind']
    if kind in ('time', 'weekday'):
        local = datetime.fromisoformat(captured_at.replace('Z', '+00:00')).astimezone(ZoneInfo(rule['timeZone']))
        if kind == 'weekday':
            return (local.weekday() + 1) % 7 in rule['days']
        value = local.strftime('%H:%M:%S')
        start = rule['from'] + ':00' if len(rule['from']) == 5 else rule['from']
        end = rule['until'] + ':00' if len(rule['until']) == 5 else rule['until']
        return start <= value < end if start < end else value >= start or value < end
    selected = [a for a in annotations if not rule['className'] or a['class_name'].casefold() == rule['className'].casefold()]
    if kind == 'class':
        return bool(selected) if rule['operator'] == 'present' else not selected
    if kind == 'confidence':
        return any(a['confidence'] >= rule['threshold'] if rule['operator'] == 'at-least' else a['confidence'] < rule['threshold'] for a in selected)
    if kind == 'motion':
        # A box without a track (a photo, or a classifier) was seen once: too brief to tell.
        return any((tracks or {}).get(a.get('track_id'), {}).get('motion', 'brief') == rule['operator'] for a in selected)
    if kind != 'count':
        raise ValueError(f'Unsupported condition rule: {kind}')
    count = len(selected)
    return count == rule['count'] if rule['operator'] == 'equal' else count >= rule['count'] if rule['operator'] == 'at-least' else count <= rule['count']


def match_condition(data, captured_at, annotations, tracks=None):
    values = [match_rule(r, captured_at, annotations, tracks) for r in data['rules']]
    return all(values) if data['match'] == 'all' else any(values)
