import {
  App,
  MarkdownPostProcessorContext,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile
} from 'obsidian';

/**
 * A record representing a single tagged span extracted from a note.
 */
interface SpanRecord {
  /** The file where the span resides. */
  file: string;
  /** The starting line (0‑based) of the span. */
  line: number;
  /** Character index within the file where the span begins. May be 0 if unknown. */
  from: number;
  /** Character index where the span ends. May be 0 if unknown. */
  to: number;
  /** The plain text of the span (without tags). */
  text: string;
  /** An array of tags applied to the span. Each tag omits the leading '#'. */
  tags: string[];
  /** Attributes parsed from the tag sequence, keyed by attribute name. */
  attrs: Record<string, string>;
  /** Kind of span: mark (==) or custom ({{…}}). */
  kind: 'mark' | 'custom';
}

interface MemoirPluginSettings {
  /** Whether to process inner tags inside ==…== spans. */
  enableInner: boolean;
  /** Display tag badges by default. If false, badges remain hidden until the user clicks the tagged span. */
  showBadgesByDefault: boolean;
}

const DEFAULT_SETTINGS: MemoirPluginSettings = {
  enableInner: true,
  showBadgesByDefault: false
};

/**
 * Parses a tag sequence appearing after a colon, such as
 * ": #tag1 #tag2(note=xyz)". Returns tags and parsed attributes.
 * Attributes in parentheses after a tag apply to the span and are merged
 * into a single attrs object.
 */
function parseTagSequence(seq: string): { tags: string[]; attrs: Record<string, string> } {
  const tags: string[] = [];
  const attrs: Record<string, string> = {};
  // Extract hash-tags within the captured sequence. Tag name supports Unicode;
  // it stops at whitespace, colon, or parentheses.
  const tagPattern = /#([^\s:()]+)(?:\(([^)]*)\))?/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(seq)) !== null) {
    const tagName = match[1];
    tags.push(tagName);
    const attrString = match[2];
    if (attrString) {
      const parts = attrString
        .split(/[;,]/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      for (const part of parts) {
        const [key, value] = part.split(/\s*=\s*/);
        if (key && value) attrs[key] = value;
      }
    }
  }
  return { tags, attrs };
}

/**
 * Main plugin class implementing inline tagging for emphasised and custom spans.
 */
export default class MemoirTaggingPlugin extends Plugin {
  settings: MemoirPluginSettings;
  /**
   * In memory index of all spans tagged across the vault. The index is built
   * opportunistically as pages are rendered. In a future version this could be
   * persisted and keyed by file.
   */
  private spanIndex: SpanRecord[] = [];

  async onload() {
    await this.loadSettings();
    // Clear any previous index (if the plugin hot reloads).
    this.spanIndex = [];

    // Register Markdown post processor to handle inline tagging after the note
    // has been converted into HTML. This runs in reading view only.
    this.registerMarkdownPostProcessor((element: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      this.processRenderedMarkdown(element, ctx);
    });

    // Command to export the current span index to a JSON file in the vault.
    this.addCommand({
      id: 'memoir-export-index',
      name: 'Export Memoir Tag Index',
      callback: async () => {
        const adapter = this.app.vault.adapter;
        const metaDir = 'meta';
        try {
          if (!(await adapter.exists(metaDir))) {
            await adapter.mkdir(metaDir);
          }
          const filePath = `${metaDir}/index.json`;
          await adapter.write(filePath, JSON.stringify(this.spanIndex, null, 2));
          new Notice(`Memoir index exported to ${filePath}`);
        } catch (e) {
          console.error('Failed to export Memoir index', e);
          new Notice('Failed to export Memoir index. See console for details.');
        }
      }
    });

    // Command to log the current span index to the developer console for debugging.
    this.addCommand({
      id: 'memoir-log-index',
      name: 'Log Memoir Tag Index',
      callback: () => {
        console.log('Memoir Tag Index:', this.spanIndex);
        new Notice(`Logged ${this.spanIndex.length} spans to console.`);
      }
    });

    // Command to manually rebuild the span index by reading all files.
    this.addCommand({
      id: 'memoir-rebuild-index',
      name: 'Rebuild Memoir Tag Index',
      callback: async () => {
        await this.rebuildIndex();
        new Notice(`Rebuilt Memoir index. Found ${this.spanIndex.length} spans.`);
      }
    });

    // Add a settings tab to allow users to configure behaviour.
    this.addSettingTab(new MemoirSettingTab(this.app, this));
  }

  onunload() {
    // When the plugin unloads we could clear the index to free memory.
    this.spanIndex = [];
  }

  /**
   * Processes the rendered HTML of a note, removing tag markers and adding
   * badge decorations. Also updates the in memory index with details about
   * tagged spans found in this rendering.
   */
  private processRenderedMarkdown(element: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const currentFile = ctx.sourcePath;
    // Helper to record a span into the index. Using closure to capture file.
    const recordSpan = (kind: 'mark' | 'custom', targetEl: HTMLElement, text: string, tags: string[], attrs: Record<string, string>) => {
      const sectionInfo = ctx.getSectionInfo(targetEl);
      const line = sectionInfo ? sectionInfo.lineStart : 0;
      const rec: SpanRecord = {
        file: currentFile,
        line,
        from: 0,
        to: 0,
        text,
        tags,
        attrs,
        kind
      };
      this.spanIndex.push(rec);
    };

    // Process <mark> elements for emphasised spans.
    const marks = element.querySelectorAll('mark');
    marks.forEach((mark) => {
      let tags: string[] = [];
      let attrs: Record<string, string> = {};
      let cleanedText: string | null = null;
      let foundTags = false;

      // Check for inner tags at the end of the mark's own text.
      if (this.settings.enableInner) {
        const innerText = mark.textContent || '';
        // Match a colon followed by one or more space-separated #tags at end of string.
        const innerMatch = innerText.match(/(:\s*#[^\s:()]+(?:\([^)]*\))?(?:\s+#[^\s:()]+(?:\([^)]*\))?)*)\s*$/);
        if (innerMatch) {
          const tagSeq = innerMatch[0];
          cleanedText = innerText.substring(0, innerText.length - tagSeq.length).trimEnd();
          const parsed = parseTagSequence(tagSeq);
          tags = parsed.tags;
          attrs = parsed.attrs;
          foundTags = tags.length > 0;
        }
      }

      if (foundTags) {
        // If tags were inside the mark, strip them from the mark's text.
        if (cleanedText !== null) {
          mark.textContent = cleanedText;
        }
        // Add a subtle underline to denote tagging and insert badge container.
        mark.classList.add('itp-tagged');
        const badgeContainer = document.createElement('span');
        badgeContainer.className = 'itp-badges';
        badgeContainer.setAttribute('aria-label', `tags: ${tags.join(', ')}`);
        tags.forEach((tag) => {
          // Render each tag as an anchor with the class 'tag' so that Obsidian's
          // built‑in tag handler recognises it and enables click behaviour. We
          // still apply our itp-badge class for styling.
          const a = document.createElement('a');
          a.className = 'tag itp-badge';
          // Obsidian expects the href and data-tag to include the leading '#'.
          const tagName = tag.startsWith('#') ? tag : `#${tag}`;
          a.setAttribute('href', tagName);
          a.setAttribute('data-tag', tagName);
          a.textContent = tagName;
          badgeContainer.appendChild(a);
        });
        mark.appendChild(badgeContainer);
        // Record this span in the index.
        const text = (cleanedText !== null ? cleanedText : mark.textContent || '').trim();
        recordSpan('mark', mark, text, tags, attrs);

        // When badges are hidden by default, toggle a CSS class rather than using inline styles.
        if (!this.settings.showBadgesByDefault) {
          badgeContainer.classList.add('itp-badges-hidden');
          this.registerDomEvent(mark, 'click', (ev: Event) => {
            // Ignore clicks on tag badges themselves; let them trigger tag search.
            if ((ev.target as HTMLElement).classList.contains('tag')) {
              return;
            }
            badgeContainer.classList.toggle('itp-badges-hidden');
          });
        } else {
          // Ensure the hidden class is not present when badges should be shown.
          badgeContainer.classList.remove('itp-badges-hidden');
        }
      }
    });

    // Links do not participate in tagging.

    // Process custom spans {{ … :#tag }} inside plain text nodes.
    // We walk text nodes and replace matches with span elements + badges.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const parent = (n as Text).parentElement;
      if (!parent) continue;
      const tagName = parent.tagName.toLowerCase();
      // Skip within code, pre, existing marks and links.
      if (tagName === 'code' || tagName === 'pre' || tagName === 'mark' || tagName === 'a') continue;
      textNodes.push(n as Text);
    }

    textNodes.forEach((textNode) => {
      const text = textNode.nodeValue || '';
      // Simple non-greedy match for {{ ... }} that does not span across braces.
      const re = /\{\{\s*([^{}]*?)\s*\}\}/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      if (!re.test(text)) return; // quick check
      re.lastIndex = 0;

      const frag = document.createDocumentFragment();
      while ((match = re.exec(text)) !== null) {
        const before = text.slice(lastIndex, match.index);
        if (before) frag.appendChild(document.createTextNode(before));

        const inner = match[1];
        // Extract tag sequence from the end of inner content (inner tagging only).
        const innerMatch = inner.match(/(:\s*#[^\s:()]+(?:\([^)]*\))?(?:\s+#[^\s:()]+(?:\([^)]*\))?)*)\s*$/);
        let contentText = inner.trim();
        let tags: string[] = [];
        let attrs: Record<string, string> = {};
        if (innerMatch) {
          const tagSeq = innerMatch[0];
          contentText = inner.substring(0, inner.length - tagSeq.length).trimEnd();
          const parsed = parseTagSequence(tagSeq);
          tags = parsed.tags;
          attrs = parsed.attrs;
        }

        // Build span element
        const span = document.createElement('span');
        span.className = 'itp-tagged itp-custom';
        span.textContent = contentText;
        if (tags.length > 0) {
          const badgeContainer = document.createElement('span');
          badgeContainer.className = 'itp-badges';
          badgeContainer.setAttribute('aria-label', `tags: ${tags.join(', ')}`);
          tags.forEach((tag) => {
            const a = document.createElement('a');
            a.className = 'tag itp-badge';
            const tagName = tag.startsWith('#') ? tag : `#${tag}`;
            a.setAttribute('href', tagName);
            a.setAttribute('data-tag', tagName);
            a.textContent = tagName;
            badgeContainer.appendChild(a);
          });
          if (!this.settings.showBadgesByDefault) {
            badgeContainer.classList.add('itp-badges-hidden');
            this.registerDomEvent(span, 'click', (ev: Event) => {
              if ((ev.target as HTMLElement).classList.contains('tag')) return;
              badgeContainer.classList.toggle('itp-badges-hidden');
            });
          }
          span.appendChild(badgeContainer);
        }

        // Record index for custom span
        const textForIndex = contentText.trim();
        recordSpan('custom', span, textForIndex, tags, attrs);

        frag.appendChild(span);
        lastIndex = re.lastIndex;
      }

      // Append the remaining tail text
      const tail = text.slice(lastIndex);
      if (tail) frag.appendChild(document.createTextNode(tail));

      // Replace node in DOM
      textNode.parentNode?.replaceChild(frag, textNode);
    });
  }

  /**
   * Rebuilds the span index by scanning all Markdown files in the vault and
   * parsing their contents using the same tagging rules. This is a slower
   * operation but ensures a complete index across all files.
   */
  private async rebuildIndex() {
    this.spanIndex = [];
    const mdFiles = this.app.vault.getMarkdownFiles();
    for (const file of mdFiles) {
      const content = await this.app.vault.read(file);
      this.indexFileContent(file, content);
    }
  }

  /**
   * Parse a Markdown file's raw content to extract tagged spans for indexing.
   * Handles inner tagging for emphasised (==) spans and custom spans ({{…}}).
   */
  private indexFileContent(file: TFile, content: string) {
    const filePath = file.path;
    const lines = content.split(/\r?\n/);
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let pos = 0;
      while (pos < line.length) {
        // Search for an emphasised span starting at pos: ==...==
        const markStart = line.indexOf('==', pos);
        if (markStart === -1) break;
        const markEnd = line.indexOf('==', markStart + 2);
        if (markEnd === -1) break;
        const spanBody = line.substring(markStart + 2, markEnd);
        let tagSeq = '';
        let text = spanBody;
        let tags: string[] = [];
        let attrs: Record<string, string> = {};
        // Check for inner tags at the end of the span body
        // Allow optional whitespace after the colon before the hash when matching inner tags.
        const innerMatch = spanBody.match(/(:\s*#[^\s:()]+(?:\([^)]*\))?(?:\s+#[^\s:()]+(?:\([^)]*\))?)*)\s*$/);
        if (innerMatch) {
          tagSeq = innerMatch[0];
          text = spanBody.substring(0, spanBody.length - tagSeq.length).trimEnd();
          const parsed = parseTagSequence(tagSeq);
          tags = parsed.tags;
          attrs = parsed.attrs;
        }
        if (tags.length > 0) {
          const rec: SpanRecord = {
            file: filePath,
            line: lineIdx,
            from: markStart,
            to: markEnd + 2,
            text: text.trim(),
            tags,
            attrs,
            kind: 'mark'
          };
          this.spanIndex.push(rec);
        }
        // Move pos after this span to search for further spans on the same line.
        pos = markEnd + 2;
      }
      // Links are ignored for tagging in index.

      // Search for custom spans on this line: {{ ... }} (single-line only)
      let customPos = 0;
      while (customPos < line.length) {
        const cs = line.indexOf('{{', customPos);
        if (cs === -1) break;
        const ce = line.indexOf('}}', cs + 2);
        if (ce === -1) break;
        const inner = line.substring(cs + 2, ce).trim();
        const innerMatch = inner.match(/(:\s*#[^\s:()]+(?:\([^)]*\))?(?:\s+#[^\s:()]+(?:\([^)]*\))?)*)\s*$/);
        let textOnly = inner;
        let tags: string[] = [];
        let attrs: Record<string, string> = {};
        if (innerMatch) {
          const tagSeq = innerMatch[0];
          textOnly = inner.substring(0, inner.length - tagSeq.length).trimEnd();
          const parsed = parseTagSequence(tagSeq);
          tags = parsed.tags;
          attrs = parsed.attrs;
        }
        if (tags.length > 0) {
          const rec: SpanRecord = {
            file: filePath,
            line: lineIdx,
            from: cs,
            to: ce + 2,
            text: textOnly.trim(),
            tags,
            attrs,
            kind: 'custom'
          };
          this.spanIndex.push(rec);
        }
        customPos = ce + 2;
      }
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

/**
 * Settings tab for the Memoir Tagging Plugin. Allows the user to toggle optional
 * behaviours such as showing tags when clicking on tagged spans.
 */
class MemoirSettingTab extends PluginSettingTab {
  plugin: MemoirTaggingPlugin;

  constructor(app: App, plugin: MemoirTaggingPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Memoir Tagging Settings' });

    new Setting(containerEl)
      .setName('Show badges by default')
      .setDesc('If enabled, tag badges are always visible. When disabled, badges remain hidden until you click on the tagged span in reading mode.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showBadgesByDefault);
        toggle.onChange(async (value) => {
          this.plugin.settings.showBadgesByDefault = value;
          await this.plugin.saveSettings();
        });
      });
  }
}
