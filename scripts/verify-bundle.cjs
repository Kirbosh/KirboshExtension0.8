const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs')
const { join } = require('node:path')

const outputDirectory = process.argv[2]
if (!outputDirectory)
    throw new Error('Usage: node scripts/verify-bundle.cjs <repository-directory>')

const requiredFiles = [
    'index.html',
    'versioning.json',
    'KirboshBatCave/source.js',
    'KirboshBatCave/includes/icon.png',
    'KirboshZipComic/source.js',
    'KirboshZipComic/includes/icon.png',
]
for (const file of requiredFiles) {
    if (!existsSync(join(outputDirectory, file))) throw new Error(`Missing generated file: ${file}`)
}

const manifest = JSON.parse(readFileSync(join(outputDirectory, 'versioning.json'), 'utf8'))
if (manifest.builtWith.toolchain !== '0.8.7' || manifest.builtWith.types !== '0.8.7') {
    throw new Error('Generated repository does not use Paperback 0.8.7 tooling and types')
}
if (
    manifest.sources.length !== 2 ||
    !manifest.sources.some((source) => source.id === 'KirboshBatCave') ||
    !manifest.sources.some((source) => source.id === 'KirboshZipComic')
) {
    throw new Error('Published manifest must contain KirboshBatCave and KirboshZipComic')
}
const source = manifest.sources.find((entry) => entry.id === 'KirboshBatCave')
if (
    !source ||
    source.name !== 'BatCave' ||
    source.version !== '1.0.4' ||
    source.contentRating !== 'MATURE' ||
    source.websiteBaseURL !== 'https://batcave.biz'
) {
    throw new Error('BatCave metadata in versioning.json is incorrect')
}
const zipComic = manifest.sources.find((entry) => entry.id === 'KirboshZipComic')
if (
    !zipComic ||
    zipComic.name !== 'ZipComic' ||
    zipComic.version !== '1.0.0' ||
    zipComic.contentRating !== 'MATURE' ||
    zipComic.websiteBaseURL !== 'https://www.zipcomic.com'
) {
    throw new Error('ZipComic metadata in versioning.json is incorrect')
}

const index = readFileSync(join(outputDirectory, 'index.html'), 'utf8')
const expectedBaseUrl = 'https://kirbosh.github.io/KirboshExtension0.8/0.8-stable'
const expectedDeepLink =
    'paperback://addRepo?displayName=Kirbosh%E2%80%99s%20Extensions%20(0.8)&amp;url=' +
    encodeURIComponent(expectedBaseUrl)
for (const expected of [
    'Kirbosh’s Extensions (0.8)',
    expectedBaseUrl,
    expectedDeepLink,
    'name="viewport" content="width=device-width, initial-scale=1"',
    'KirboshBatCave/includes/icon.png',
    'Version 1.0.4',
    'Mature',
    'English',
    'KirboshZipComic/includes/icon.png',
    'Version 1.0.0',
    'ZipComic',
]) {
    if (!index.includes(expected)) throw new Error(`Landing page is missing: ${expected}`)
}

const generatedSource = readFileSync(join(outputDirectory, 'KirboshBatCave', 'source.js'), 'utf8')
for (const expected of [
    'reader/getChapterData',
    'window.__DATA__',
    'readcomicsonline',
    'pagination__btn-loader',
    'com.batcave.android',
    'pow_nonce',
    'HTTP 404',
]) {
    if (!generatedSource.includes(expected))
        throw new Error(`Source bundle is missing: ${expected}`)
}

const generatedZipComic = readFileSync(
    join(outputDirectory, 'KirboshZipComic', 'source.js'),
    'utf8',
)
for (const expected of [
    'www.zipcomic.com',
    'search?kwd=',
    'img.img-responsive',
    '-issue-',
    '#images img',
    'ZipComic needs Cloudflare verification',
]) {
    if (!generatedZipComic.includes(expected)) {
        throw new Error(`ZipComic source bundle is missing: ${expected}`)
    }
}
for (const incompatible of [
    'Application.executeInWebView',
    'const url = new URL(cleaned',
    'const pathname = new URL(rawUrl',
]) {
    if (generatedZipComic.includes(incompatible)) {
        throw new Error(`Paperback 0.8-incompatible code leaked into ZipComic: ${incompatible}`)
    }
}
for (const incompatible of [
    'const imageRequest = new URL',
    'const url = new URL(cleaned',
    'const pathname = new URL(rawUrl',
]) {
    if (generatedSource.includes(incompatible)) {
        throw new Error(`Paperback 0.8-incompatible URL global leaked into source: ${incompatible}`)
    }
}

const forbiddenNames = [
    'Atsumaru',
    'Elftoon',
    'GodaComic',
    'Mangaball',
    'Mangacloud',
    'Projectsuki',
    'Rawkuma',
    'ReadAllComics',
]
const walk = (directory) =>
    readdirSync(directory).flatMap((name) => {
        const path = join(directory, name)
        return statSync(path).isDirectory() ? walk(path) : [path]
    })
for (const path of walk(outputDirectory)) {
    const contents = path.endsWith('.png') ? '' : readFileSync(path, 'utf8')
    for (const forbidden of forbiddenNames) {
        if (path.includes(forbidden) || contents.includes(forbidden)) {
            throw new Error(`Removed source leaked into generated output: ${forbidden}`)
        }
    }
}

const png = readFileSync(join(outputDirectory, 'KirboshBatCave', 'includes', 'icon.png'))
if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('BatCave icon is not a valid PNG')
}
const zipPng = readFileSync(join(outputDirectory, 'KirboshZipComic', 'includes', 'icon.png'))
if (zipPng.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('ZipComic icon is not a valid PNG')
}

console.log('Verified Paperback 0.8 repository: BatCave 1.0.4 and ZipComic 1.0.0')
