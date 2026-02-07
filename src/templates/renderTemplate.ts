export type TimelineEvent = {
  state: string;
  at: string | null;
};

/**
 * Strict, client-side rendering context for inbox templates.
 * Paths outside this shape are rejected by the renderer.
 */
export type TemplateRenderContext = {
  lead: {
    first_name: string;
    full_name: string;
  };
  conversation: {
    id: string;
    platform: string;
    channel: string;
    state: string;
    timeline: TimelineEvent[];
  };
  asset: {
    id: string;
    name: string;
  };
  business: {
    display_name: string;
  };
  user: {
    display_name: string;
  };
};

export type RenderTemplateResult = {
  text: string;
  missingVars: string[];
  errors: string[];
};

type AstNode =
  | { type: 'text'; value: string }
  | { type: 'var'; path: string }
  | { type: 'if'; expr: string; thenNodes: AstNode[]; elseNodes: AstNode[] };

const MAX_TEMPLATE_LENGTH = 10_000;
const MAX_BLOCK_DEPTH = 1;

const ALLOWED_PATHS = new Set([
  'lead.first_name',
  'lead.full_name',
  'conversation.id',
  'conversation.platform',
  'conversation.channel',
  'conversation.state',
  'asset.id',
  'asset.name',
  'business.display_name',
  'user.display_name',
]);

const normalizeState = (value: string) => value.trim().toUpperCase();

const isTruthy = (value: unknown) => {
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value);
};

const resolvePath = (
  path: string,
  context: TemplateRenderContext,
): {
  value: string;
  missing: string[];
  errors: string[];
} => {
  if (!ALLOWED_PATHS.has(path)) {
    return {
      value: '',
      missing: [],
      errors: [`Unsupported path "${path}"`],
    };
  }
  const parts = path.split('.');
  let current: unknown = context;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) {
      return {
        value: '',
        missing: [path],
        errors: [],
      };
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== 'string') {
    return {
      value: '',
      missing: [path],
      errors: [],
    };
  }
  if (!current.trim()) {
    return {
      value: '',
      missing: [path],
      errors: [],
    };
  }
  return { value: current, missing: [], errors: [] };
};

const evaluateExpr = (
  expr: string,
  context: TemplateRenderContext,
): {
  value: boolean;
  missing: string[];
  errors: string[];
} => {
  const trimmed = expr.trim();
  if (!trimmed) {
    return { value: false, missing: [], errors: ['Empty if expression'] };
  }

  if (trimmed.includes(':')) {
    const [rawOp = '', rawArg = ''] = trimmed.split(':', 2);
    const op = rawOp.trim();
    const arg = rawArg.trim();
    if (!arg) {
      return {
        value: false,
        missing: [],
        errors: [`Missing argument for "${op}"`],
      };
    }
    if (op === 'stateIs' || op === 'hasState') {
      return {
        value:
          normalizeState(context.conversation.state) === normalizeState(arg),
        missing: [],
        errors: [],
      };
    }
    if (op === 'hadState') {
      const target = normalizeState(arg);
      const inTimeline = context.conversation.timeline.some(
        (event) => normalizeState(event.state) === target,
      );
      const currentMatch =
        normalizeState(context.conversation.state) === target;
      return {
        value: inTimeline || currentMatch,
        missing: [],
        errors: [],
      };
    }
    if (op === 'isIn') {
      const current = normalizeState(context.conversation.state);
      const states = arg
        .split(',')
        .map((state) => normalizeState(state))
        .filter(Boolean);
      return {
        value: states.includes(current),
        missing: [],
        errors: [],
      };
    }
    return {
      value: false,
      missing: [],
      errors: [`Unsupported expression "${trimmed}"`],
    };
  }

  const resolved = resolvePath(trimmed, context);
  return {
    value: isTruthy(resolved.value),
    missing: resolved.missing,
    errors: resolved.errors,
  };
};

const parseTemplate = (
  source: string,
): {
  nodes: AstNode[];
  errors: string[];
} => {
  const errors: string[] = [];
  let index = 0;

  const parseNodes = (
    depth: number,
    stopTokens: Array<'else' | '/if'> = [],
  ): {
    nodes: AstNode[];
    stop?: 'else' | '/if';
  } => {
    const nodes: AstNode[] = [];
    while (index < source.length) {
      const start = source.indexOf('{{', index);
      if (start === -1) {
        nodes.push({ type: 'text', value: source.slice(index) });
        index = source.length;
        break;
      }
      if (start > index) {
        nodes.push({ type: 'text', value: source.slice(index, start) });
      }
      const close = source.indexOf('}}', start + 2);
      if (close === -1) {
        errors.push('Unclosed "{{" token');
        nodes.push({ type: 'text', value: source.slice(start) });
        index = source.length;
        break;
      }
      const token = source.slice(start + 2, close).trim();
      index = close + 2;

      if (stopTokens.includes('else') && token === 'else') {
        return { nodes, stop: 'else' };
      }
      if (stopTokens.includes('/if') && token === '/if') {
        return { nodes, stop: '/if' };
      }

      if (token.startsWith('#if ')) {
        if (depth >= MAX_BLOCK_DEPTH) {
          errors.push('Template nesting exceeds supported depth (1).');
          continue;
        }
        const expr = token.slice(4).trim();
        const thenBranch = parseNodes(depth + 1, ['else', '/if']);
        let elseNodes: AstNode[] = [];
        if (thenBranch.stop === 'else') {
          const elseBranch = parseNodes(depth + 1, ['/if']);
          if (elseBranch.stop !== '/if') {
            errors.push('Missing {{/if}} after {{else}} block');
          }
          elseNodes = elseBranch.nodes;
        } else if (thenBranch.stop !== '/if') {
          errors.push('Missing {{/if}} for if block');
        }
        nodes.push({
          type: 'if',
          expr,
          thenNodes: thenBranch.nodes,
          elseNodes,
        });
        continue;
      }

      if (token === 'else' || token === '/if') {
        errors.push(`Unexpected token "{{${token}}}"`);
        continue;
      }

      nodes.push({ type: 'var', path: token });
    }
    return { nodes };
  };

  const root = parseNodes(0, []);
  return { nodes: root.nodes, errors };
};

const renderNodes = (
  nodes: AstNode[],
  context: TemplateRenderContext,
): {
  text: string;
  missing: Set<string>;
  errors: string[];
} => {
  const missing = new Set<string>();
  const errors: string[] = [];
  let text = '';

  const addMissing = (values: string[]) => {
    for (const value of values) {
      missing.add(value);
    }
  };

  for (const node of nodes) {
    if (node.type === 'text') {
      text += node.value;
      continue;
    }
    if (node.type === 'var') {
      const resolved = resolvePath(node.path, context);
      text += resolved.value;
      addMissing(resolved.missing);
      errors.push(...resolved.errors);
      continue;
    }
    const exprResult = evaluateExpr(node.expr, context);
    addMissing(exprResult.missing);
    errors.push(...exprResult.errors);
    const selected = exprResult.value ? node.thenNodes : node.elseNodes;
    const nested = renderNodes(selected, context);
    text += nested.text;
    nested.missing.forEach((value) => missing.add(value));
    errors.push(...nested.errors);
  }

  return { text, missing, errors };
};

export const renderTemplate = (
  templateText: string,
  context: TemplateRenderContext,
): RenderTemplateResult => {
  if (templateText.length > MAX_TEMPLATE_LENGTH) {
    return {
      text: '',
      missingVars: [],
      errors: [`Template exceeds ${MAX_TEMPLATE_LENGTH} characters.`],
    };
  }
  const parsed = parseTemplate(templateText);
  const rendered = renderNodes(parsed.nodes, context);
  const errors = [...parsed.errors, ...rendered.errors];
  return {
    text: rendered.text,
    missingVars: [...rendered.missing],
    errors,
  };
};
