/**
 * Parse placeholders like {{name}} from template content
 * @param {string} template
 * @returns {string[]} unique placeholder names
 */
export function parsePlaceholders(template) {
  // Capture names that do not include special chars used by choice syntax (: , |)
  // Capture names that do not include special chars used by choice syntax (: , |)
  // Also exclude 'radio' and 'ai' which are special types
  const re = /\{\{\s*([^{}:|,]+)\s*\}\}/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(template))) {
    // Skip 'radio' and 'ai' as they are special types, not simple placeholders
    if (m[1] !== 'radio' && m[1] !== 'ai') {
      seen.add(m[1]);
    }
  }
  return Array.from(seen);
}

/**
 * Replace placeholders with provided values
 * @param {string} template
 * @param {Record<string,string>} values
 */
export function fillPlaceholders(template, values) {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => {
    return Object.prototype.hasOwnProperty.call(values, k) ? String(values[k]) : "";
  });
}

/**
 * Parse choice placeholders from template content.
 * Supported forms (in order of precedence):
 * - {{name:opt1,opt2,opt3|default}}
 * - {{opt1,opt2,opt3|default}}
 * - {{radio|opt1,opt2,opt3|default}} (radio button selection)
 * - {{ai|textinput}} (AI input with submit)
 * The default part (|default) is optional.
 * @param {string} template
 * @returns {Array<{
 *   raw:string,
 *   name?:string,
 *   options:string[],
 *   default?:string,
 *   type?: 'choice' | 'radio' | 'ai',
 *   aiPrompt?: string
 * }>}
 */
export function parseChoicePlaceholders(template) {
  /** @type {Array<{ raw:string, name?:string, options:string[], default?:string, type?: 'choice' | 'radio' | 'ai', aiPrompt?: string }>} */
  const tokens = [];

  // 1) Named choices: {{name:opt1,opt2|def}}
  const namedRe = /\{\{\s*([\w.-]+)\s*:\s*([^}|]+(?:\s*,\s*[^}|]+)+)\s*(?:\|\s*([^}]+?))?\s*\}\}/g;
  let m;
  while ((m = namedRe.exec(template))) {
    const [, name, opts, def] = m;
    const options = opts.split(',').map((s) => s.trim());
    tokens.push({ raw: m[0], name, options, default: def?.trim(), type: 'choice' });
  }

  // 2) Anonymous choices: {{opt1,opt2|def}}
  const anonRe = /\{\{\s*([^{}:|]+(?:\s*,\s*[^{}:|]+)+)\s*(?:\|\s*([^}]+?))?\s*\}\}/g;
  while ((m = anonRe.exec(template))) {
    // Skip if this match overlaps any named token we already captured (to avoid double-counting)
    const raw = m[0];
    const start = m.index;
    const end = m.index + raw.length;
    const overlaps = tokens.some((t) => {
      const i = template.indexOf(t.raw);
      return i !== -1 && !(end <= i || start >= i + t.raw.length);
    });
    if (overlaps) continue;

    const [, opts, def] = m;
    const options = opts.split(',').map((s) => s.trim());
    tokens.push({ raw, options, default: def?.trim(), type: 'choice' });
  }

  // 3) Radio button choices: {{radio|opt1,opt2,opt3|default}}
  const radioRe = /\{\{\s*radio\s*\|\s*([^}|]+(?:\s*,\s*[^}|]+)+)\s*(?:\|\s*([^}]+?))?\s*\}\}/g;
  while ((m = radioRe.exec(template))) {
    const raw = m[0];
    const start = m.index;
    const end = m.index + raw.length;
    const overlaps = tokens.some((t) => {
      const i = template.indexOf(t.raw);
      return i !== -1 && !(end <= i || start >= i + t.raw.length);
    });
    if (overlaps) continue;

    const [, opts, def] = m;
    const options = opts.split(',').map((s) => s.trim());
    tokens.push({ raw, options, default: def?.trim(), type: 'radio' });
  }

  // 4) AI input: {{ai|textinput}}
  const aiRe = /\{\{\s*ai\s*\|\s*([^}|]+)\s*(?:\|\s*([^}]+?))?\s*\}\}/g;
  while ((m = aiRe.exec(template))) {
    const raw = m[0];
    const start = m.index;
    const end = m.index + raw.length;
    const overlaps = tokens.some((t) => {
      const i = template.indexOf(t.raw);
      return i !== -1 && !(end <= i || start >= i + t.raw.length);
    });
    if (overlaps) continue;

    const [, prompt, def] = m;
    tokens.push({
      raw,
      options: [prompt.trim()],
      default: def?.trim(),
      type: 'ai',
      aiPrompt: prompt.trim()
    });
  }

  // Preserve encounter order based on first index in the template
  tokens.sort((a, b) => template.indexOf(a.raw) - template.indexOf(b.raw));
  return tokens;
}

/**
 * Replace choice placeholders sequentially with provided selected values.
 * The number of values must equal the number of tokens parsed by parseChoicePlaceholders.
 * @param {string} template
 * @param {string[]} selectedValues
 */
export function fillChoicePlaceholders(template, selectedValues) {
  if (!selectedValues || !selectedValues.length) return template;
  let i = 0;
  // Replace named and anonymous choice tokens in one pass (order matters)
  // Also handle radio and ai tokens
  const re = /\{\{\s*(?:[\w.-]+\s*:\s*([^}|]+(?:\s*,\s*[^}|]+)+)|([^{}:|]+(?:\s*,\s*[^{}:|]+)+)|radio\s*\|\s*([^}|]+(?:\s*,\s*[^}|]+)+)|ai\s*\|\s*([^}|]+))\s*(?:\|\s*[^}]+?)?\s*\}\}/g;
  return template.replace(re, () => {
    const v = selectedValues[i++];
    return v == null ? '' : String(v);
  });
}
