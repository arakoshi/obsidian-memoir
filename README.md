# Obsidian Memoir – Inline Tagging

Inline tagging for emphasised (== … ==) and custom ({{ … }}) spans in Obsidian. Designed for use with Memoir sites, but works standalone.

## Features

- Inner tags on marks: `== 対象: #tag1 #tag2 ==`
- Custom spans: `{{ 対象 : #tag1 #tag2(note=メモ) }}`
- Unicode tag names (e.g. `#日本語タグ`)
- Tag badges in reading view; toggle visibility on click
- JSON index export command (optional)

## Install (Release)

1. Download the following files from GitHub Releases (versioned):
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Place them into your Obsidian vault plugin folder: `.obsidian/plugins/obsidian-memoir/`
3. Enable the plugin in Obsidian.

## Build (Local)

```
npm install
npm run build
```

Outputs `main.js` in the repo root.

## Usage Syntax

- Mark inner tags: `== テキスト: #気分 #外出 ==`
- Mark inner tags (no extra spaces): `==テキスト: #気分 #外出==`
- Custom span: `{{ テキスト : #気分 #外出(note=朝) }}`

Notes:

- Spaces around `==` and before/after the colon are optional. Both `==テキスト: #t1 #t2==` and `== テキスト: #t1 #t2 ==` work.
- Only inner tagging is supported. Post-span/link outer tags are not parsed.
- Colon-chained tags (`: #t1: #t2`) are not supported; use spaces between tags: `: #t1 #t2`.
- Link spans `[[…]]` do not carry tags.

## Release Process

Tag a version `vX.Y.Z` on `main`.

GitHub Actions will:

- Install deps and build `main.js`
- Verify the tag matches `manifest.json` `version`
- Attach `main.js`, `manifest.json`, and `styles.css` to the GitHub Release

## License

MIT

## Contributors

- @sacher-arakoshi
- @waonme
- @gaon-arakoshi
