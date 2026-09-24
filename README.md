# Kirbosh’s Extensions (0.8)

A focused, English-language Western comics repository for the App Store release of Paperback 0.8.

## Available sources

| Source   | Language | Rating | Features                                                                                               |
| -------- | -------- | ------ | ------------------------------------------------------------------------------------------------------ |
| BatCave  | English  | Mature | Search, pagination, popular/latest/catalogue sections, metadata, complete issue lists, and issue pages |
| ZipComic | English  | Mature | Search, pagination, latest updates, metadata, complete issue lists, and issue pages                    |

Both sources use Paperback 0.8's standard Cloudflare bypass flow. Before the first search, open the source in Paperback, tap the cloud icon in the source toolbar, complete the site's verification, close the verification view, and retry. Repeat this when the site expires its clearance cookie. No account, copied cookies, or credentials are required or included.

## Install in Paperback 0.8

1. On the iPad, open [the repository website](https://kirbosh.github.io/KirboshExtension0.8/0.8-stable) in Safari.
2. Tap **Add to Paperback** and approve the prompt in Paperback.
3. In Paperback, open the new repository and install **BatCave**, **ZipComic**, or both.

If the button is unavailable, copy this repository base URL into Paperback’s repository manager:

```text
https://kirbosh.github.io/KirboshExtension0.8/0.8-stable
```

This repository intentionally uses Paperback 0.8 types, manifests, tooling, and installation format. It is not compatible with Paperback 0.9.

## Source identities and migration

The source identifiers are `KirboshBatCave` and `KirboshZipComic`. These deliberately differ from Kakarot’s inherited identifiers so the repositories cannot silently replace or conflict with one another.

Existing entries saved with Kakarot’s old BatCave source therefore require migration:

1. Install this repository and its BatCave source without removing the old source first.
2. In Paperback, open **Settings → Source Migration**.
3. Select the old BatCave source as the origin and this repository’s BatCave source as the destination.
4. Review the matched titles and migrate them. Check library entries and reading progress before removing the old source or Kakarot repository.

## Development

The publishing branch is `0.8-stable`. The official Paperback 0.8 toolchain creates the standard repository site, `versioning.json`, source bundle, and icon under `bundles/0.8-stable`.

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run verify:bundle
```

`npm run test:device` invokes the 0.8 toolchain’s device tester and requires a reachable Paperback device configured for development.

## Credits and license

This fork is based on [KakarotExtension 0.8](https://github.com/karrot0/kakarotextension0.8). The original BatCave extension was written by Karrot and contributors; Kirbosh’s version is a substantially revised, independently identified source adapted to BatCave’s current site and reader behavior.

The repository continues the upstream `GPL-3.0-or-later` license declaration. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Paperback’s 0.8 toolchain and types retain their own upstream licenses.

Paperback is not affiliated with BatCave, ZipComic, or the publishers represented in their catalogues.
