// One shared tooltip. The value leads, the label follows; content is always set with textContent.

const tooltip = /** @type {HTMLElement} */ (document.getElementById('tooltip'));

/**
 * @typedef {{ value: string, label: string, detail?: string }} TooltipContent
 */

/**
 * Shows the tooltip next to a point on screen (client coordinates).
 * @param {TooltipContent} content
 * @param {number} x
 * @param {number} y
 */
export function showTooltip(content, x, y) {
  const value = document.createElement('span');
  value.className = 'tooltip__value';
  value.textContent = content.value;

  const label = document.createElement('span');
  label.className = 'tooltip__label';
  label.textContent = content.label;

  tooltip.replaceChildren(value, label);
  if (content.detail) {
    const detail = document.createElement('span');
    detail.className = 'tooltip__detail';
    detail.textContent = content.detail;
    tooltip.append(detail);
  }

  tooltip.hidden = false;
  const { width, height } = tooltip.getBoundingClientRect();
  const left = Math.min(x + 14, window.innerWidth - width - 8);
  const top = y - height - 12 < 8 ? y + 16 : y - height - 12;
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${top}px`;
}

/** Shows the tooltip above an element, for keyboard focus. @param {TooltipContent} content @param {Element} element */
export function showTooltipFor(content, element) {
  const box = element.getBoundingClientRect();
  showTooltip(content, box.left + box.width / 2, box.top);
}

export function hideTooltip() {
  tooltip.hidden = true;
}
