// Sostituzione dei segnaposto {nome} nei testi di it.js.

/**
 * @param {string} template
 * @param {Record<string, string | number>} values
 * @returns {string}
 */
export function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
}
