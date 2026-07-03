/**
 * `TemplateEngine` — pure `{{var}}` substitution.
 *
 * Deliberately minimal: no conditionals, no loops, no external engine.
 * Dotted paths (`{{file.basename}}`)
 * are supported; unknown or nullish variables expand to the empty string.
 */

export type TemplateVariables = Record<string, unknown>;

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

function lookup(vars: TemplateVariables, path: string): unknown {
  let value: unknown = vars;
  for (const segment of path.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

export class TemplateEngine {
  expand(template: string, vars: TemplateVariables): string {
    return template.replace(PLACEHOLDER, (_match, path: string) => {
      const value = lookup(vars, path);
      return value === undefined || value === null ? "" : String(value);
    });
  }
}
