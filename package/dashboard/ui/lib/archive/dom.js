// Tiny element builders. Text always goes in as text nodes, never parsed as HTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @typedef {string | number | Node | null | undefined | false} Child
 */

/**
 * Creates an HTML element.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string | number | boolean | undefined>} [attributes]
 * @param {...Child} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  setAttributes(element, attributes);
  append(element, children);
  return element;
}

/**
 * Creates an SVG element.
 * @param {string} tag
 * @param {Record<string, string | number | boolean | undefined>} [attributes]
 * @param {...Child} children
 * @returns {SVGElement}
 */
export function s(tag, attributes = {}, ...children) {
  const element = /** @type {SVGElement} */ (document.createElementNS(SVG_NS, tag));
  setAttributes(element, attributes);
  append(element, children);
  return element;
}

/** @param {Element} element @param {Record<string, string | number | boolean | undefined>} attributes */
function setAttributes(element, attributes) {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
}

/** @param {Element} element @param {Child[]} children */
function append(element, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}
