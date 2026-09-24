import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import type {
    Chapter,
    ChapterDetails,
    HomeSection,
    MangaInfo,
    PagedResults,
    PartialSourceManga,
    Request,
    RequestManager,
    Response,
    SearchRequest,
    SourceManga,
} from '@paperback/types'

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

test('ZipComic implements the complete Paperback 0.8 source contract', async () => {
    const scheduledRequests: Request[] = []
    const responseControl: { forcedStatus?: number } = {}
    let requestManagerOptions:
        | {
              interceptor: {
                  interceptRequest(request: Request): Promise<Request>
                  interceptResponse(response: Response): Promise<Response>
              }
          }
        | undefined

    const requestManager: RequestManager = {
        requestsPerSecond: 3,
        requestTimeout: 20000,
        getDefaultUserAgent: async () => 'Paperback 0.8 test agent',
        schedule: async (request) => {
            scheduledRequests.push(request)
            const url = request.url
            const data = url.includes('-issue-')
                ? fixture('zipcomic-reader.html')
                : url.includes('/search?') || url === 'https://www.zipcomic.com/'
                ? fixture('zipcomic-search.html')
                : fixture('zipcomic-series.html')
            return {
                status: responseControl.forcedStatus ?? 200,
                headers: {},
                request,
                data,
            }
        },
    }

    interface RequestManagerOptions {
        interceptor: {
            interceptRequest(request: Request): Promise<Request>
            interceptResponse(response: Response): Promise<Response>
        }
    }

    interface AppMock {
        createRequestManager(options: RequestManagerOptions): RequestManager
        createRequest(info: {
            url: string
            method: string
            headers?: Record<string, string>
            data?: unknown
        }): Request
        createPartialSourceManga(info: PartialSourceManga): PartialSourceManga
        createPagedResults(info: {
            results?: PartialSourceManga[]
            metadata?: unknown
        }): PagedResults
        createHomeSection(info: {
            id: string
            title: string
            type: string
            items?: PartialSourceManga[]
            containsMoreItems: boolean
        }): HomeSection
        createMangaInfo(info: {
            image: string
            artist?: string
            author?: string
            desc: string
            status: string
            hentai?: boolean
            titles: string[]
            rating?: number
            tags?: MangaInfo['tags']
        }): MangaInfo
        createSourceManga(info: SourceManga): SourceManga
        createChapter(info: {
            id: string
            chapNum: number
            volume?: number
            name?: string
            group?: string
            time?: Date
            langCode?: string
            sortingIndex?: number
        }): Chapter
        createChapterDetails(info: ChapterDetails): ChapterDetails
    }

    const testGlobal = globalThis as unknown as { App: AppMock }
    testGlobal.App = {
        createRequestManager: (options) => {
            requestManagerOptions = options
            return requestManager
        },
        createRequest: (info) => ({ ...info, headers: info.headers ?? {}, cookies: [] } as Request),
        createPartialSourceManga: (info) => info,
        createPagedResults: (info) => ({ results: info.results ?? [], metadata: info.metadata }),
        createHomeSection: (info) => ({
            id: info.id,
            title: info.title,
            items: info.items ?? [],
            containsMoreItems: info.containsMoreItems,
        }),
        createMangaInfo: (info) => ({
            image: info.image,
            artist: info.artist ?? '',
            author: info.author ?? '',
            desc: info.desc,
            status: info.status,
            hentai: info.hentai ?? false,
            titles: info.titles,
            rating: info.rating,
            tags: info.tags ?? [],
            covers: [],
            avgRating: 0,
            follows: 0,
            langFlag: '',
            langName: '',
            users: 0,
            views: 0,
        }),
        createSourceManga: (info) => info,
        createChapter: (info) => ({
            id: info.id,
            chapNum: info.chapNum,
            langCode: info.langCode ?? '',
            name: info.name ?? '',
            volume: info.volume ?? 0,
            group: info.group ?? '',
            time: info.time ?? new Date(0),
            sortingIndex: info.sortingIndex ?? 0,
        }),
        createChapterDetails: (info) => info,
    }

    const { KirboshZipComic } = await import('../src/KirboshZipComic/KirboshZipComic')
    const source = new KirboshZipComic()

    const sections: HomeSection[] = []
    await source.getHomePageSections((section) => sections.push(section))
    assert.equal(sections.length, 1)
    assert.equal(sections[0]?.title, 'Latest Updates')
    assert.equal(sections[0]?.items.length, 2)

    const search = await source.getSearchResults({ title: 'Spider Man' } as SearchRequest)
    assert.equal(search.results.length, 2)
    assert.deepEqual(search.metadata, {
        page: 2,
        collectedIds: ['batman-1940', 'detective-comics-1937'],
    })
    assert.match(scheduledRequests.at(-1)?.url ?? '', /kwd=Spider%20Man&p=1$/)

    const details = await source.getMangaDetails('batman-1940')
    assert.equal(details.mangaInfo.titles[0], 'Batman (1940)')
    assert.equal(details.mangaInfo.status, 'COMPLETED')
    assert.deepEqual(
        details.mangaInfo.tags[0]?.tags.map((tag) => tag.label),
        ['Action', 'Superhero'],
    )

    const chapters = await source.getChapters('batman-1940')
    assert.equal(chapters.length, 2)
    assert.equal(chapters[0]?.id, 'batman-1940-issue-2')
    assert.equal(chapters[0]?.sortingIndex, 2)

    const chapter = await source.getChapterDetails('batman-1940', 'batman-1940-issue-1')
    assert.equal(chapter.pages.length, 3)
    assert.equal(chapter.pages[0], 'https://cdn.zipcomic.com/img/pages/batman-1-001.jpg')

    const bypass = await source.getCloudflareBypassRequestAsync()
    assert.equal(bypass.url, 'https://www.zipcomic.com')
    assert.equal(bypass.headers.referer, 'https://www.zipcomic.com/')
    assert.equal(bypass.headers['user-agent'], 'Paperback 0.8 test agent')

    const interceptedRequest = await requestManagerOptions?.interceptor.interceptRequest({
        url: 'http://cdn.zipcomic.com/page.jpg',
        method: 'GET',
        headers: {},
        cookies: [],
    })
    assert.equal(interceptedRequest?.url, 'https://cdn.zipcomic.com/page.jpg')
    assert.equal(interceptedRequest?.headers.origin, 'https://www.zipcomic.com')
    assert.equal(interceptedRequest?.headers.referer, 'https://www.zipcomic.com/')
    assert.equal(interceptedRequest?.headers['user-agent'], 'Paperback 0.8 test agent')

    const interceptedResponse = await requestManagerOptions?.interceptor.interceptResponse({
        status: 302,
        data: '',
        request: interceptedRequest as Request,
        headers: { location: 'http://www.zipcomic.com/batman-1940' },
    })
    assert.equal(interceptedResponse?.headers.location, 'https://www.zipcomic.com/batman-1940')

    responseControl.forcedStatus = 403
    await assert.rejects(
        source.getSearchResults({ title: 'Batman' } as SearchRequest),
        /Cloudflare verification/,
    )
})
