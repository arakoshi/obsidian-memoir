"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => MemoirTaggingPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  enableInner: true,
  enableOuter: true,
  showBadgesByDefault: false
};
function parseTagSequence(seq) {
  const tags = [];
  const attrs = {};
  const normalized = seq.replace(/:\s*#/g, ":#");
  const tagPattern = /:#([^\s:()]+)(?:\(([^)]*)\))?/g;
  let match;
  while ((match = tagPattern.exec(normalized)) !== null) {
    const tagName = match[1];
    tags.push(tagName);
    const attrString = match[2];
    if (attrString) {
      const parts = attrString.split(/[;,]/).map((p) => p.trim()).filter((p) => p.length > 0);
      for (const part of parts) {
        const [key, value] = part.split(/\s*=\s*/);
        if (key && value) {
          attrs[key] = value;
        }
      }
    }
  }
  return { tags, attrs };
}
var MemoirTaggingPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    /**
     * In memory index of all spans tagged across the vault. The index is built
     * opportunistically as pages are rendered. In a future version this could be
     * persisted and keyed by file.
     */
    this.spanIndex = [];
  }
  async onload() {
    await this.loadSettings();
    this.spanIndex = [];
    this.registerMarkdownPostProcessor((element, ctx) => {
      this.processRenderedMarkdown(element, ctx);
    });
    this.addCommand({
      id: "memoir-export-index",
      name: "Export Memoir Tag Index",
      callback: async () => {
        const adapter = this.app.vault.adapter;
        const metaDir = "meta";
        try {
          if (!await adapter.exists(metaDir)) {
            await adapter.mkdir(metaDir);
          }
          const filePath = `${metaDir}/index.json`;
          await adapter.write(filePath, JSON.stringify(this.spanIndex, null, 2));
          new import_obsidian.Notice(`Memoir index exported to ${filePath}`);
        } catch (e) {
          console.error("Failed to export Memoir index", e);
          new import_obsidian.Notice("Failed to export Memoir index. See console for details.");
        }
      }
    });
    this.addCommand({
      id: "memoir-log-index",
      name: "Log Memoir Tag Index",
      callback: () => {
        console.log("Memoir Tag Index:", this.spanIndex);
        new import_obsidian.Notice(`Logged ${this.spanIndex.length} spans to console.`);
      }
    });
    this.addCommand({
      id: "memoir-rebuild-index",
      name: "Rebuild Memoir Tag Index",
      callback: async () => {
        await this.rebuildIndex();
        new import_obsidian.Notice(`Rebuilt Memoir index. Found ${this.spanIndex.length} spans.`);
      }
    });
    this.addSettingTab(new MemoirSettingTab(this.app, this));
  }
  onunload() {
    this.spanIndex = [];
  }
  /**
   * Processes the rendered HTML of a note, removing tag markers and adding
   * badge decorations. Also updates the in memory index with details about
   * tagged spans found in this rendering.
   */
  processRenderedMarkdown(element, ctx) {
    const currentFile = ctx.sourcePath;
    const recordSpan = (kind, targetEl, text, tags, attrs) => {
      const sectionInfo = ctx.getSectionInfo(targetEl);
      const line = sectionInfo ? sectionInfo.lineStart : 0;
      const rec = {
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
    const marks = element.querySelectorAll("mark");
    marks.forEach((mark) => {
      let tags = [];
      let attrs = {};
      let cleanedText = null;
      let foundTags = false;
      if (this.settings.enableInner) {
        const innerText = mark.textContent || "";
        const innerMatch = innerText.match(/((?:\s*:\s*#[^\s:()]+(?:\([^)]*\))?)+)\s*$/);
        if (innerMatch) {
          const tagSeq = innerMatch[0];
          cleanedText = innerText.substring(0, innerText.length - tagSeq.length).trimEnd();
          const parsed = parseTagSequence(tagSeq);
          tags = parsed.tags;
          attrs = parsed.attrs;
          foundTags = tags.length > 0;
        }
      }
      if (!foundTags && this.settings.enableOuter) {
        const next = mark.nextSibling;
        if (next && next.nodeType === Node.TEXT_NODE) {
          const textContent = next.textContent || "";
          const outerMatch = textContent.match(/^((?:\s*:\s*#[^\s:()]+(?:\([^)]*\))?)+)/);
          if (outerMatch) {
            const tagSeq = outerMatch[0];
            const parsed = parseTagSequence(tagSeq);
            tags = parsed.tags;
            attrs = parsed.attrs;
            foundTags = tags.length > 0;
            next.textContent = textContent.substring(tagSeq.length);
          }
        }
      }
      if (foundTags) {
        if (cleanedText !== null) {
          mark.textContent = cleanedText;
        }
        mark.classList.add("itp-tagged");
        const badgeContainer = document.createElement("span");
        badgeContainer.className = "itp-badges";
        badgeContainer.setAttribute("aria-label", `tags: ${tags.join(", ")}`);
        tags.forEach((tag) => {
          const a = document.createElement("a");
          a.className = "tag itp-badge";
          const tagName = tag.startsWith("#") ? tag : `#${tag}`;
          a.setAttribute("href", tagName);
          a.setAttribute("data-tag", tagName);
          a.textContent = tagName;
          badgeContainer.appendChild(a);
        });
        mark.appendChild(badgeContainer);
        const text = (cleanedText !== null ? cleanedText : mark.textContent || "").trim();
        recordSpan("mark", mark, text, tags, attrs);
        if (!this.settings.showBadgesByDefault) {
          badgeContainer.classList.add("itp-badges-hidden");
          this.registerDomEvent(mark, "click", (ev) => {
            if (ev.target.classList.contains("tag")) {
              return;
            }
            badgeContainer.classList.toggle("itp-badges-hidden");
          });
        } else {
          badgeContainer.classList.remove("itp-badges-hidden");
        }
      }
    });
    const links = element.querySelectorAll("a.internal-link");
    links.forEach((anchor) => {
      let tags = [];
      let attrs = {};
      if (this.settings.enableOuter) {
        const next = anchor.nextSibling;
        if (next && next.nodeType === Node.TEXT_NODE) {
          const textContent = next.textContent || "";
          const outerMatch = textContent.match(/^((?:\s*:\s*#[^\s:()]+(?:\([^)]*\))?)+)/);
          if (outerMatch) {
            const tagSeq = outerMatch[0];
            const parsed = parseTagSequence(tagSeq);
            tags = parsed.tags;
            attrs = parsed.attrs;
            next.textContent = textContent.substring(tagSeq.length);
          }
        }
      }
      if (tags.length > 0) {
        anchor.classList.add("itp-tagged");
        const badgeContainer = document.createElement("span");
        badgeContainer.className = "itp-badges";
        badgeContainer.setAttribute("aria-label", `tags: ${tags.join(", ")}`);
        tags.forEach((tag) => {
          const a = document.createElement("a");
          a.className = "tag itp-badge";
          const tagName = tag.startsWith("#") ? tag : `#${tag}`;
          a.setAttribute("href", tagName);
          a.setAttribute("data-tag", tagName);
          a.textContent = tagName;
          badgeContainer.appendChild(a);
        });
        if (anchor.parentElement) {
          anchor.parentElement.insertBefore(badgeContainer, anchor.nextSibling);
        }
        const spanText = anchor.getAttribute("data-href") || anchor.textContent || "";
        recordSpan("link", anchor, spanText.trim(), tags, attrs);
        if (!this.settings.showBadgesByDefault) {
          badgeContainer.classList.add("itp-badges-hidden");
          this.registerDomEvent(anchor, "click", (ev) => {
            if (ev.target.classList.contains("tag")) {
              return;
            }
            badgeContainer.classList.toggle("itp-badges-hidden");
          });
        } else {
          badgeContainer.classList.remove("itp-badges-hidden");
        }
      }
    });
  }
  /**
   * Rebuilds the span index by scanning all Markdown files in the vault and
   * parsing their contents using the same tagging rules. This is a slower
   * operation but ensures a complete index across all files.
   */
  async rebuildIndex() {
    this.spanIndex = [];
    const mdFiles = this.app.vault.getMarkdownFiles();
    for (const file of mdFiles) {
      const content = await this.app.vault.read(file);
      this.indexFileContent(file, content);
    }
  }
  /**
   * Parse a Markdown file's raw content to extract tagged spans. This parser
   * implements only a minimal subset of the full rendering logic: it handles
   * inner and outer tagging for emphasised (==) spans and outer tagging for
   * links ([[…]]). Custom spans ({{…}}) are not parsed here. Index entries are
   * appended to the spanIndex.
   */
  indexFileContent(file, content) {
    const filePath = file.path;
    const lines = content.split(/\r?\n/);
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let pos = 0;
      while (pos < line.length) {
        const markStart = line.indexOf("==", pos);
        if (markStart === -1)
          break;
        const markEnd = line.indexOf("==", markStart + 2);
        if (markEnd === -1)
          break;
        const spanBody = line.substring(markStart + 2, markEnd);
        let tagSeq = "";
        let text = spanBody;
        let tags = [];
        let attrs = {};
        const innerMatch = spanBody.match(/((?:\s*:\s*#[^\s:()]+(?:\([^)]*\))?)+)\s*$/);
        if (innerMatch) {
          tagSeq = innerMatch[0];
          text = spanBody.substring(0, spanBody.length - tagSeq.length).trimEnd();
          const parsed = parseTagSequence(tagSeq);
          tags = parsed.tags;
          attrs = parsed.attrs;
        }
        if (tags.length === 0) {
          const rest = line.substring(markEnd + 2);
          const outerMatch = rest.match(/^((?:\s*:\s*#[^\s:()]+(?:\([^)]*\))?)+)/);
          if (outerMatch) {
            tagSeq = outerMatch[0];
            const parsed = parseTagSequence(tagSeq);
            tags = parsed.tags;
            attrs = parsed.attrs;
          }
        }
        if (tags.length > 0) {
          const rec = {
            file: filePath,
            line: lineIdx,
            from: markStart,
            to: markEnd + 2,
            text: text.trim(),
            tags,
            attrs,
            kind: "mark"
          };
          this.spanIndex.push(rec);
        }
        pos = markEnd + 2;
      }
      let linkPos = 0;
      while (linkPos < line.length) {
        const start = line.indexOf("[[", linkPos);
        if (start === -1)
          break;
        const end = line.indexOf("]]", start + 2);
        if (end === -1)
          break;
        const linkText = line.substring(start + 2, end);
        const rest = line.substring(end + 2);
        const outerMatch = rest.match(/^((?:\s*:\s*#[^\s:()]+(?:\([^)]*\))?)+)/);
        if (outerMatch) {
          const tagSeq = outerMatch[0];
          const parsed = parseTagSequence(tagSeq);
          const rec = {
            file: filePath,
            line: lineIdx,
            from: start,
            to: end + 2,
            text: linkText.trim(),
            tags: parsed.tags,
            attrs: parsed.attrs,
            kind: "link"
          };
          this.spanIndex.push(rec);
        }
        linkPos = end + 2;
      }
    }
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var MemoirSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Memoir Tagging Settings" });
    new import_obsidian.Setting(containerEl).setName("Show badges by default").setDesc("If enabled, tag badges are always visible. When disabled, badges remain hidden until you click on the tagged span or link in reading mode.").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.showBadgesByDefault);
      toggle.onChange(async (value) => {
        this.plugin.settings.showBadgesByDefault = value;
        await this.plugin.saveSettings();
      });
    });
  }
};
