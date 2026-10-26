/** WCAG relative luminance of a #rrggbb color. */
export function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map(at => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio between two #rrggbb colors, from 1 to 21. */
export function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
/** Black or white text, whichever reads better on `fill`. */
export const inkOn = (fill: string) => (contrast(fill, '#000000') >= contrast(fill, '#ffffff') ? '#000000' : '#ffffff');
