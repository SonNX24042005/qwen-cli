'use strict';

const { Marked } = require('marked');
const { markedTerminal } = require('marked-terminal');
const Renderer = require('marked-terminal').default || require('marked-terminal');
const supportsHyperlinks = require('supports-hyperlinks');
const ansiEscapes = require('ansi-escapes');

const chalkInstance = require('chalk').default || require('chalk');

function wrapAnsiText(text, width) {
  const lines = text.split('\n');
  const reflowed = [];
  const ansiRegex = /\u001b\[[0-9;]*m|\u001b\]8;[^;]*;[^\u0007]*\u0007|\u001b\]8;;\u0007/g;
  
  lines.forEach((line) => {
    const cleanLine = line.replace(ansiRegex, '');
    if (cleanLine.length <= width) {
      reflowed.push(line);
      return;
    }
    
    const tokens = line.split(/([ \t]+)/);
    let currentLine = '';
    let currentLength = 0;
    
    for (const token of tokens) {
      if (!token) continue;
      
      const cleanToken = token.replace(ansiRegex, '');
      const cleanLen = cleanToken.length;
      
      if (currentLength + cleanLen > width) {
        if (currentLength === 0) {
          currentLine += token;
          currentLength += cleanLen;
        } else {
          reflowed.push(currentLine.trimEnd());
          const trimmedToken = token.trimStart();
          const trimmedClean = trimmedToken.replace(ansiRegex, '');
          currentLine = trimmedToken;
          currentLength = trimmedClean.length;
        }
      } else {
        currentLine += token;
        currentLength += cleanLen;
      }
    }
    
    if (currentLine) {
      reflowed.push(currentLine.trimEnd());
    }
  });
  
  return reflowed.join('\n');
}

// Theo dõi độ sâu lồng nhau của list để tính toán thụt lề chính xác khi wrap
let listDepth = 0;
const originalList = Renderer.prototype.list;
Renderer.prototype.list = function(body, ordered) {
  listDepth++;
  try {
    return originalList.call(this, body, ordered);
  } finally {
    listDepth--;
  }
};

const BULLET_POINT = '* ';

// Ghi đè Renderer.prototype.listitem để tự động wrap text cho list item theo chiều ngang terminal
Renderer.prototype.listitem = function(item) {
  if (typeof item !== 'object') {
    return '\n' + BULLET_POINT + item;
  }
  
  let itemText = '';
  let nestedBlocksHtml = '';
  
  if (item.tokens && item.tokens.length > 0) {
    const firstToken = item.tokens[0];
    const otherTokens = item.tokens.slice(1);
    
    if (firstToken.tokens) {
      itemText = this.parser.parseInline(firstToken.tokens);
    } else {
      itemText = firstToken.text || '';
    }
    
    if (otherTokens.length > 0) {
      nestedBlocksHtml = this.parser.parse(otherTokens);
    }
  } else {
    itemText = item.text || '';
  }
  
  if (item.task) {
    const checkbox = this.checkbox({ checked: !!item.checked });
    itemText = checkbox + itemText;
  }
  
  const width = this.o.width || 80;
  const tabLen = this.tab ? this.tab.length : 4;
  const prefix = '* ';
  const prefixLen = prefix.length;
  
  const depth = Math.max(1, listDepth);
  const targetWrapWidth = Math.max(30, width - (depth * tabLen) - ((depth - 1) * 2) - prefixLen);
  const wrappedContent = wrapAnsiText(itemText, targetWrapWidth);
  
  const wrappedLines = wrappedContent.split('\n');
  const indentedContent = wrappedLines.map((wl, idx) => {
    if (idx === 0) return wl;
    return ' '.repeat(prefixLen) + wl;
  }).join('\n');
  
  let finalContent = indentedContent;
  if (nestedBlocksHtml) {
    finalContent += '\n' + nestedBlocksHtml.trimEnd();
  }
  
  const transform = (txt) => this.o.listitem(this.transform(txt));
  return '\n' + BULLET_POINT + transform(finalContent);
};

// Ghi đè Renderer.prototype.link
Renderer.prototype.link = function(href, title, text) {
  if (typeof href === 'object') {
    title = href.title;
    text = this.parser.parseInline(href.tokens);
    href = href.href;
  }
  
  if (supportsHyperlinks.stdout) {
    const linkText = text ? this.o.href(this.emoji(text)) : this.o.href(href);
    return this.o.link(ansiEscapes.link(linkText, href.replace(/\+/g, '%20')));
  } else {
    return this.o.link(this.o.href(this.emoji(text || href)));
  }
};

function renderMarkdown(text, cols) {
  const extension = markedTerminal({
    reflowText: true,
    width: Math.max(40, cols - 4),
    showSectionPrefix: false,
    firstHeading: chalkInstance.white.bold.underline,
    heading: chalkInstance.white.bold,
    code: chalkInstance.hex('#c9d1d9'),
    codespan: chalkInstance.cyan,
    link: chalkInstance.hex('#58a6ff'),
    href: chalkInstance.hex('#58a6ff').underline,
    blockquote: chalkInstance.gray.italic,
    tableOptions: {
      chars: {
        'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
        'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
        'left': '│', 'left-mid': '├',
        'mid': '─', 'mid-mid': '┼',
        'right': '│', 'right-mid': '┤',
        'middle': '│'
      },
      style: {
        head: ['white', 'bold'],
        border: ['gray']
      }
    }
  });

  const originalText = extension.renderer.text;
  extension.renderer.text = function(token) {
    if (token && typeof token === 'object' && token.tokens) {
      return this.parser.parseInline(token.tokens);
    }
    return originalText.call(this, token);
  };

  const markedInstance = new Marked(extension);
  try {
    return markedInstance.parse(text).trimEnd();
  } catch (err) {
    return text;
  }
}

function replaceCitations(text, docs) {
  if (!text) return text;

  const bibMap = {};
  const bibLineRegex = /^\s*\[(\d+)\]\s+(.+)$/gm;
  let match;
  bibLineRegex.lastIndex = 0;
  while ((match = bibLineRegex.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    const content = match[2];
    const urlMatch = content.match(/(https?:\/\/[^\s\)\],"`]+)/);
    if (urlMatch) {
      let url = urlMatch[1];
      if (url.endsWith('.') || url.endsWith(',')) {
        url = url.slice(0, -1);
      }
      let domain = '';
      try {
        domain = new URL(url).hostname;
      } catch (e) {
        const m = url.match(/https?:\/\/([^\/]+)/);
        domain = m ? m[1] : 'link';
      }
      if (domain.startsWith('www.')) domain = domain.slice(4);
      bibMap[num] = { url, domain };
    }
  }

  // Replace [[N]]
  text = text.replace(/\[\[(\d+)\]\]/g, (match, numStr) => {
    const num = parseInt(numStr, 10);
    if (bibMap[num]) {
      return `[[${numStr}]](${bibMap[num].url})`;
    }
    const idx = num - 1;
    if (docs && Array.isArray(docs) && docs[idx]) {
      const doc = docs[idx];
      return `[[${numStr}]](${doc.url})`;
    }
    return `[${numStr}]`;
  });

  // Replace [N]
  text = text.replace(/(?<!\w|\[)\[(\d+)\](?!\(|\[)/g, (match, numStr) => {
    const num = parseInt(numStr, 10);
    if (bibMap[num]) {
      return `[[${numStr}]](${bibMap[num].url})`;
    }
    const idx = num - 1;
    if (docs && Array.isArray(docs) && docs[idx]) {
      const doc = docs[idx];
      return `[[${numStr}]](${doc.url})`;
    }
    return match;
  });

  // Replace raw URLs
  text = text.replace(/(?<!\(|\[)https?:\/\/[^\s\)\],"`]+/g, (url) => {
    let cleanUrl = url;
    if (cleanUrl.endsWith('.') || cleanUrl.endsWith(',')) {
      cleanUrl = cleanUrl.slice(0, -1);
    }
    let domain = '';
    try {
      domain = new URL(cleanUrl).hostname;
    } catch (e) {
      const m = cleanUrl.match(/https?:\/\/([^\/]+)/);
      domain = m ? m[1] : 'link';
    }
    if (domain.startsWith('www.')) domain = domain.slice(4);
    return `[${domain}](${cleanUrl})`;
  });

  return text;
}

module.exports = {
  wrapAnsiText,
  renderMarkdown,
  replaceCitations
};
