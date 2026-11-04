/**
 * Dynamic Variable Binding Engine for ClozFlow Voice Prompts
 * 
 * Supports:
 * - Standard syntax: {{variable_name}}
 * - Double-quote fallback: {{variable_name | "Fallback Value"}}
 * - Single-quote fallback: {{variable_name | 'Fallback Value'}}
 * - Unquoted fallback: {{variable_name | Fallback Value}}
 * - Whitespace tolerance: {{ borrower_name }}
 */

export const VARIABLE_REGEX = /\{\{\s*([a-zA-Z0-9_]+)(?:\s*\|\s*(?:"([^"]*)"|'([^']*)'|([^}]+?)))?\s*\}\}/g;

/**
 * Helper to resolve fallback across double-quote, single-quote, and unquoted capture groups.
 */
const resolveFallback = (dq, sq, unq) => {
  if (dq !== undefined) return dq;
  if (sq !== undefined) return sq;
  if (unq !== undefined) return unq.trim();
  return '';
};

/**
 * Extract all unique variables and their fallbacks from a prompt string.
 * @param {string} text - System prompt or greeting text
 * @returns {Array<{ name: string, fallback: string, raw: string }>}
 */
export const extractVariables = (text) => {
  if (!text || typeof text !== 'string') return [];

  const found = new Map();
  const matches = text.matchAll(new RegExp(VARIABLE_REGEX.source, 'g'));

  for (const match of matches) {
    const raw = match[0];
    const name = match[1];
    const fallback = resolveFallback(match[2], match[3], match[4]);

    if (!found.has(name)) {
      found.set(name, { name, fallback, raw });
    } else {
      // If earlier match had no fallback but this one has, keep the fallback
      const existing = found.get(name);
      if (!existing.fallback && fallback) {
        found.set(name, { name, fallback, raw });
      }
    }
  }

  return Array.from(found.values());
};

/**
 * Substitute variables in a template with values from valuesMap.
 * Falls back to inline fallback value if present, or empty string.
 * 
 * @param {string} template - Text containing {{variables}}
 * @param {Record<string, string>} valuesMap - Object containing variable key/value pairs
 * @param {Object} [options]
 * @param {boolean} [options.useFallback=true] - Whether to use fallback if value missing
 * @param {boolean} [options.preserveUnmatched=false] - Keep {{var}} token if no value/fallback
 * @returns {string} Substituted string
 */
export const substituteVariables = (template, valuesMap = {}, options = {}) => {
  if (!template || typeof template !== 'string') return '';
  const { useFallback = true, preserveUnmatched = false } = options;

  return template.replace(new RegExp(VARIABLE_REGEX.source, 'g'), (match, name, dqFallback, sqFallback, unqFallback) => {
    const fallback = resolveFallback(dqFallback, sqFallback, unqFallback);
    const val = valuesMap ? valuesMap[name] : undefined;

    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val);
    }

    if (useFallback && fallback) {
      return fallback;
    }

    if (preserveUnmatched) {
      return match;
    }

    return '';
  });
};

/**
 * Humanize variable identifier (e.g. `borrower_name` -> `Borrower Name`)
 * @param {string} name
 * @returns {string}
 */
export const formatVariableLabel = (name) => {
  if (!name) return '';
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
};

/**
 * Merge detected variables with existing user-defined values and archetype defaults.
 * Preserves user edits while providing realistic default testing data.
 * 
 * @param {Array<{ name: string, fallback?: string }>} detectedVars
 * @param {Record<string, any>} existingValues
 * @param {Array<{ name: string, sampleValue?: string, sample_value?: string, fallback?: string }>} [supportedVars=[]]
 * @returns {Record<string, string>}
 */
export const mergeVariablesWithDefaults = (detectedVars = [], existingValues = {}, supportedVars = []) => {
  const result = { ...(existingValues || {}) };
  const supportedMap = new Map((supportedVars || []).map(v => [v.name, v]));

  for (const v of detectedVars) {
    if (result[v.name] === undefined || result[v.name] === null || result[v.name] === '') {
      const sup = supportedMap.get(v.name);
      const sampleVal = sup ? (sup.sampleValue || sup.sample_value) : undefined;
      const supFallback = sup ? sup.fallback : undefined;

      if (sampleVal) {
        result[v.name] = sampleVal;
      } else if (v.fallback) {
        result[v.name] = v.fallback;
      } else if (supFallback) {
        result[v.name] = supFallback;
      } else {
        result[v.name] = '';
      }
    }
  }

  return result;
};

/**
 * Parse text into segments for syntax highlighting / chip preview
 * @param {string} text
 * @returns {Array<{ type: 'text' | 'variable', content: string, name?: string, fallback?: string }>}
 */
export const parseVariableSegments = (text) => {
  if (!text || typeof text !== 'string') return [];

  const segments = [];
  let lastIndex = 0;
  const regex = new RegExp(VARIABLE_REGEX.source, 'g');
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, match.index)
      });
    }

    const fallback = resolveFallback(match[2], match[3], match[4]);
    segments.push({
      type: 'variable',
      content: match[0],
      name: match[1],
      fallback
    });

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      content: text.slice(lastIndex)
    });
  }

  return segments;
};
