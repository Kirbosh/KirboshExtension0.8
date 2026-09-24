import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import type { ChapterDetails, Request, RequestManager } from '@paperback/types'

import {
    absoluteHttpsUrl,
    batcaveSearchUrl,
    extractWindowData,
    hasNextPage,
    looksLikeCloudflareChallenge,
    parseChapters,
    parseDetails,
    parseReaderData,
    parseSearchResults,
} from '../src/KirboshBatCave/KirboshBatCaveParser'

const fixture = (name: string): string =>
    readFileSync(join(process.cwd(), 'tests', 'fixtures', name), 'utf8')

test('search parser returns complete cards and detects page two', () => {
    const html = fixture('batman-search.html')
    const results = parseSearchResults(html)

    assert.equal(results.length, 2)
    assert.deepEqual(
        results.map((result) => result.id),
        ['6961-batman-1940', '9219-batman-the-long-halloween'],
    )
    assert.equal(
        results[0]?.image,
        'https://batcave.biz/uploads/posts/poster/a4/6961-batman-1940.jpg',
    )
    assert.equal(results[1]?.image, 'https://img.batcave.biz/covers/long-halloween.jpg')
    assert.equal(hasNextPage(html, 1), true)
    assert.equal(hasNextPage('<nav class="pagination__pages"><span>2</span></nav>', 2), false)
    assert.equal(
        hasNextPage('<div class="pagination__btn-loader"><a href="/page/2/">More</a></div>', 1),
        true,
    )
})

test('details parser returns current BatCave metadata and score selector', () => {
    const details = parseDetails(fixture('batman-series.html'))

    assert.equal(details.title, 'Batman (1940)')
    assert.equal(details.status, 'COMPLETED')
    assert.equal(details.rating, 8.7)
    assert.deepEqual(details.authors, ['Bill Finger', "Dennis O'Neil"])
    assert.deepEqual(details.artists, ['Bob Kane', 'Neal Adams'])
    assert.deepEqual(details.publishers, ['DC Comics'])
    assert.deepEqual(details.genres, ['Superhero', 'Action'])
})

test('chapter parser extracts the complete embedded list in newest-first order', () => {
    const chapters = parseChapters(fixture('batman-series.html'))

    assert.equal(chapters.length, 3)
    assert.deepEqual(
        chapters.map((chapter) => chapter.number),
        [713, 356, 1],
    )
    assert.equal(chapters.at(-1)?.id, '37775')
    assert.equal(chapters[0]?.date?.toISOString(), '2011-10-01T00:00:00.000Z')
})

test('reader parser returns absolute HTTPS pages with no blanks or duplicates', () => {
    const reader = parseReaderData(fixture('batman-reader.html'))

    assert.equal(reader.usesAjax, false)
    assert.deepEqual(reader.images, [
        'https://img.batcave.biz/uploads/pages/issue/001.jpg',
        'https://img.batcave.biz/uploads/pages/issue/002.jpg',
        'https://img.batcave.biz/uploads/pages/issue/003.jpg',
    ])
})

test('URL normalization is Paperback 0.8 safe and does not need the URL global', () => {
    assert.equal(absoluteHttpsUrl(''), '')
    assert.equal(absoluteHttpsUrl('http://img.batcave.biz/a.jpg'), 'https://img.batcave.biz/a.jpg')
    assert.equal(absoluteHttpsUrl('//img.batcave.biz/b.jpg'), 'https://img.batcave.biz/b.jpg')
    assert.equal(absoluteHttpsUrl('/uploads/c.jpg'), 'https://batcave.biz/uploads/c.jpg')
    assert.equal(absoluteHttpsUrl('uploads/d.jpg'), 'https://batcave.biz/uploads/d.jpg')
    assert.equal(
        absoluteHttpsUrl('e.jpg', 'http://batcave.biz/reader/1/2'),
        'https://batcave.biz/reader/1/e.jpg',
    )
    assert.equal(absoluteHttpsUrl('javascript:alert(1)'), '')
})

test('search routes use BatCave canonical page one and paginated later pages', () => {
    assert.equal(batcaveSearchUrl('Batman', 1), 'https://batcave.biz/search/Batman/')
    assert.equal(
        batcaveSearchUrl('Spider Man', 2),
        'https://batcave.biz/search/Spider%20Man/page/2/',
    )
    assert.equal(batcaveSearchUrl('', 1), 'https://batcave.biz/comix/')
})

test('invalid and challenge responses fail locally without poisoning other parses', () => {
    assert.equal(looksLikeCloudflareChallenge('<title>Just a moment...</title>'), true)
    assert.throws(
        () => extractWindowData('<html>ordinary error</html>'),
        /does not contain reader data/,
    )
    assert.equal(parseSearchResults(fixture('batman-search.html')).length, 2)
})

test('chapter details use the AJAX reader directly and normalize its pages', async () => {
    const scheduledRequests: Request[] = []
    const requestManager: RequestManager = {
        requestsPerSecond: 3,
        requestTimeout: 20000,
        getDefaultUserAgent: async () => 'Paperback test',
        schedule: async (request) => {
            scheduledRequests.push(request)
            return {
                status: 200,
                headers: {},
                request,
                data: JSON.stringify({
                    success: true,
                    data: {
                        images: [
                            '//img.batcave.biz/pages/1.jpg',
                            'http://img.batcave.biz/pages/2.jpg',
                        ],
                    },
                }),
            }
        },
    }

    interface AppMock {
        createRequestManager(): RequestManager
        createRequest(info: {
            url: string
            method: string
            headers?: Record<string, string>
            data?: unknown
        }): Request
        createChapterDetails(info: ChapterDetails): ChapterDetails
    }

    const testGlobal = globalThis as unknown as { App: AppMock }
    testGlobal.App = {
        createRequestManager: () => requestManager,
        createRequest: (info) => ({ ...info, headers: info.headers ?? {}, cookies: [] } as Request),
        createChapterDetails: (info) => info,
    }

    const { KirboshBatCave } = await import('../src/KirboshBatCave/KirboshBatCave')
    const details = await new KirboshBatCave().getChapterDetails(
        '33051-absolute-batman-2024',
        '233578',
    )

    assert.equal(scheduledRequests.length, 1)
    assert.match(scheduledRequests[0]?.url ?? '', /reader\/getChapterData$/)
    assert.equal(scheduledRequests[0]?.method, 'POST')
    assert.equal(scheduledRequests[0]?.data, 'news_id=33051&chapter_id=233578')
    assert.deepEqual(details.pages, [
        'https://img.batcave.biz/pages/1.jpg',
        'https://img.batcave.biz/pages/2.jpg',
    ])
})
