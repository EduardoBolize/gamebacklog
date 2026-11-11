/**
 * Turns the HTML a MediaWiki renders into plain text split by heading.
 *
 * Rendered HTML is used instead of wikitext because templates and tables — where wikis keep
 * their item lists — are already expanded in it. This is a small purpose-built converter, not
 * a general HTML parser: it only needs to keep headings, list items, table rows and prose.
 */

export interface WikiSection {
  /** Heading text; empty for the lead section before the first heading. */
  heading: string;
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const code =
        entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Removes an element and everything inside it, for every element whose opening tag matches. */
function dropElements(html: string, tag: string, attribute?: RegExp): string {
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  let result = '';
  let cursor = 0;
  for (let match = open.exec(html); match; match = open.exec(html)) {
    if (match.index < cursor) continue;
    if (attribute && !attribute.test(match[0])) continue;
    // Walk forward counting nested tags of the same name to find the matching close.
    const inner = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    inner.lastIndex = match.index + match[0].length;
    let depth = 1;
    let end = html.length;
    for (let step = inner.exec(html); step; step = inner.exec(html)) {
      depth += step[1] ? -1 : 1;
      if (depth === 0) {
        end = step.index + step[0].length;
        break;
      }
    }
    result += html.slice(cursor, match.index);
    cursor = end;
    open.lastIndex = end;
  }
  return result + html.slice(cursor);
}

export function htmlToSections(html: string): WikiSection[] {
  let text = html;
  // Things that are not content: scripts, styles, navigation boxes, footnote marks, galleries.
  for (const tag of ['script', 'style', 'noscript', 'figure', 'audio', 'video']) {
    text = dropElements(text, tag);
  }
  text = dropElements(text, 'table', /class="[^"]*\b(navbox|nav-?box|toc|metadata)\b/i);
  text = dropElements(
    text,
    'div',
    /class="[^"]*\b(navbox|nav-?box|toc|reflist|references|gallery|noprint)\b/i,
  );
  text = dropElements(text, 'sup', /class="[^"]*\breference\b/i);
  text = dropElements(text, 'span', /class="[^"]*\bmw-editsection\b/i);

  text = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_match, _level, inner: string) => `\n\n## ${inner.replace(/<[^>]+>/g, '').trim()}\n\n`,
    )
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|ul|ol|dl|dd|dt|table|section|blockquote|aside)>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  text = decodeEntities(text)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\| ?(\n|$)/g, '$1')
    .replace(/\n /g, '\n')
    .replace(/ \n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const sections: WikiSection[] = [];
  let heading = '';
  let lines: string[] = [];
  const flush = () => {
    const body = lines.join('\n').trim();
    if (body) sections.push({ heading, text: body });
    lines = [];
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      flush();
      heading = line.slice(3).trim();
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

/** Sections as one text with headings, for prompts. */
export function sectionsToText(sections: WikiSection[]): string {
  return sections
    .map((section) => (section.heading ? `## ${section.heading}\n${section.text}` : section.text))
    .join('\n\n');
}
