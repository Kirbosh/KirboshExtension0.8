const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const outputDirectory = process.argv[2]
if (!outputDirectory) throw new Error('Usage: node scripts/enhance-site.cjs <repository-directory>')

const manifest = JSON.parse(readFileSync(join(outputDirectory, 'versioning.json'), 'utf8'))
if (manifest.sources.length !== 2) {
    throw new Error(`Expected exactly two published sources, found ${manifest.sources.length}`)
}

const indexPath = join(outputDirectory, 'index.html')
let html = readFileSync(indexPath, 'utf8')
html = html.replace(
    '<meta charset="utf-8">',
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
)
for (const source of manifest.sources) {
    const sourceListItem = new RegExp(`<li>${source.name}([\\s\\S]*?)<\\/li>`)
    if (!sourceListItem.test(html)) {
        throw new Error(`The standard source list was not found for ${source.name}`)
    }

    const rating = source.contentRating.charAt(0) + source.contentRating.slice(1).toLowerCase()
    html = html.replace(
        sourceListItem,
        `<li class="sourceCard"><img class="sourceIcon" src="${source.id}/includes/${
            source.icon
        }" alt="${source.name} icon"><span class="sourceIdentity"><strong>${
            source.name
        }</strong><small>Version ${source.version} · ${rating} · ${
            source.language ?? 'English'
        }</small></span>$1</li>`,
    )
}
html = html.replace(
    '</style>',
    '.sourceCard{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.sourceIcon{width:52px;height:52px;border-radius:10px}.sourceIdentity{display:flex;flex-direction:column;margin-right:auto}.sourceIdentity small{margin-top:4px;color:#666}</style>',
)

writeFileSync(indexPath, html)
