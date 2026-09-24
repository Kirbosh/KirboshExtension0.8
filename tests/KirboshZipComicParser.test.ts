import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import {
    absoluteHttpsUrl,
    hasNextPage,
    looksLikeCloudflareChallenge,
    parseCards,
    parseChapterId,
    parseChapters,
    parseDetails,
    parseMangaId,
    parsePages,
    zipComicSearchUrl,
} from '../src/KirboshZipComic/KirboshZipComicParser'

const fixture = (name: string): string =>
    readFileSync(join(process.cwd(), 'tests', 'fixtures', name), 'utf8')

test('ZipComic cards parse unique title entries and pagination', () => {
    const html = fixture('zipcomic-search.html')
    const cards = parseCards(html)

    assert.deepEqual(
        cards.map((card) => card.id),
        ['batman-1940', 'detective-comics-1937'],
    )
    assert.equal(cards[0]?.image, 'https://www.zipcomic.com/img/comic/cover/batman-1940.jpg')
    assert.equal(cards[1]?.image, 'https://cdn.zipcomic.com/img/comic/cover/detective-comics.jpg')
    assert.equal(hasNextPage(html, 1), true)
    assert.equal(hasNextPage(html, 2), false)
})

test('ZipComic details and issues parse from the maintained site structure', () => {
    const html = fixture('zipcomic-series.html')
    const details = parseDetails(html)
    const chapters = parseChapters(html)

    assert.equal(details.title, 'Batman (1940)')
    assert.equal(details.image, 'https://www.zipcomic.com/img/comic/cover/batman-1940.jpg')
    assert.equal(details.status, 'COMPLETED')
    assert.equal(details.author, 'Bill Finger')
    assert.equal(details.artist, 'Bob Kane')
    assert.deepEqual(details.genres, ['Action', 'Superhero'])
    assert.deepEqual(
        chapters.map((chapter) => [chapter.id, chapter.number]),
        [
            ['batman-1940-issue-2', 2],
            ['batman-1940-issue-1', 1],
        ],
    )
})

test('ZipComic reader pages normalize HTTPS and remove duplicates', () => {
    assert.deepEqual(parsePages(fixture('zipcomic-reader.html')), [
        'https://cdn.zipcomic.com/img/pages/batman-1-001.jpg',
        'https://cdn.zipcomic.com/img/pages/batman-1-002.jpg',
        'https://www.zipcomic.com/img/pages/batman-1-003.jpg',
    ])
})

test('ZipComic route helpers are safe for Paperback 0.8 JavaScriptCore', () => {
    assert.equal(parseMangaId('https://www.zipcomic.com/batman-1940/'), 'batman-1940')
    assert.equal(parseMangaId('/batman-1940-issue-1'), '')
    assert.equal(parseChapterId('/batman-1940-issue-1'), 'batman-1940-issue-1')
    assert.equal(parseChapterId('/genre/action'), '')
    assert.equal(absoluteHttpsUrl('javascript:alert(1)'), '')
    assert.equal(
        absoluteHttpsUrl('//cdn.zipcomic.com/page.jpg'),
        'https://cdn.zipcomic.com/page.jpg',
    )
    assert.equal(
        zipComicSearchUrl('Spider Man', 2),
        'https://www.zipcomic.com/search?kwd=Spider%20Man&p=2',
    )
})

test('ZipComic challenge detection recognizes its Cloudflare responses', () => {
    assert.equal(looksLikeCloudflareChallenge('<title>Just a moment...</title>'), true)
    assert.equal(
        looksLikeCloudflareChallenge(
            '<script src="https://challenges.cloudflare.com/a.js"></script>',
        ),
        true,
    )
    assert.equal(looksLikeCloudflareChallenge(fixture('zipcomic-search.html')), false)
})
