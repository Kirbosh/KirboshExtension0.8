import {
    BadgeColor,
    Chapter,
    ChapterDetails,
    ChapterProviding,
    CloudflareBypassRequestProviding,
    ContentRating,
    HomePageSectionsProviding,
    HomeSection,
    HomeSectionType,
    MangaProviding,
    PagedResults,
    PartialSourceManga,
    Request,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga,
    TagSection,
} from '@paperback/types'

import {
    ZIPCOMIC_DOMAIN,
    hasNextPage,
    looksLikeCloudflareChallenge,
    parseCards,
    parseChapters,
    parseDetails,
    parsePages,
    zipComicSearchUrl,
} from './KirboshZipComicParser'

export const KirboshZipComicInfo: SourceInfo = {
    version: '1.0.0',
    name: 'ZipComic',
    description: 'Western comics from ZipComic, maintained for Paperback 0.8.',
    author: 'Kirbosh & Karrot',
    icon: 'icon.png',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: ZIPCOMIC_DOMAIN,
    language: 'English',
    intents:
        SourceIntents.MANGA_CHAPTERS |
        SourceIntents.HOMEPAGE_SECTIONS |
        SourceIntents.CLOUDFLARE_BYPASS_REQUIRED,
    sourceTags: [
        { text: 'Western comics', type: BadgeColor.BLUE },
        { text: 'English', type: BadgeColor.GREEN },
    ],
}

interface PageMetadata {
    page?: number
    collectedIds?: string[]
}

export class KirboshZipComic
    implements
        ChapterProviding,
        CloudflareBypassRequestProviding,
        HomePageSectionsProviding,
        MangaProviding,
        SearchResultsProviding
{
    requestManager = App.createRequestManager({
        requestsPerSecond: 3,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.url = request.url.replace(/^http:/i, 'https:')
                request.headers = {
                    ...(request.headers ?? {}),
                    origin: ZIPCOMIC_DOMAIN,
                    referer: `${ZIPCOMIC_DOMAIN}/`,
                    'user-agent': await this.requestManager.getDefaultUserAgent(),
                    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                    'accept-language': 'en-US,en;q=0.5',
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                if (typeof response.headers.location === 'string') {
                    response.headers.location = response.headers.location.replace(
                        /^http:/i,
                        'https:',
                    )
                }
                return response
            },
        },
    })

    private async requestHtml(url: string): Promise<string> {
        const response = await this.requestManager.schedule(
            App.createRequest({ url, method: 'GET' }),
            1,
        )
        const html = response.data ?? ''
        if (
            response.status === 403 ||
            response.status === 503 ||
            looksLikeCloudflareChallenge(html)
        ) {
            throw new Error(
                'ZipComic needs Cloudflare verification. Open the ZipComic source, tap the cloud icon, complete the check, then retry.',
            )
        }
        if (response.status === 404) throw new Error(`ZipComic content was not found: ${url}`)
        if (response.status < 200 || response.status >= 400) {
            throw new Error(`ZipComic returned HTTP ${response.status} for ${url}`)
        }
        if (!html.trim()) throw new Error(`ZipComic returned an empty response for ${url}`)
        return html
    }

    private partialManga(card: ReturnType<typeof parseCards>[number]): PartialSourceManga {
        return App.createPartialSourceManga({
            mangaId: card.id,
            image: card.image,
            title: card.title,
        })
    }

    private resultsPage(html: string, page: number, collectedIds: string[] = []): PagedResults {
        const seen = new Set(collectedIds)
        const cards = parseCards(html).filter((card) => {
            if (seen.has(card.id)) return false
            seen.add(card.id)
            return true
        })
        return App.createPagedResults({
            results: cards.map((card) => this.partialManga(card)),
            metadata: hasNextPage(html, page)
                ? { page: page + 1, collectedIds: Array.from(seen) }
                : undefined,
        })
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const items = parseCards(await this.requestHtml(`${ZIPCOMIC_DOMAIN}/`)).map((card) =>
            this.partialManga(card),
        )
        sectionCallback(
            App.createHomeSection({
                id: 'latest',
                title: 'Latest Updates',
                containsMoreItems: false,
                type: HomeSectionType.singleRowLarge,
                items,
            }),
        )
    }

    async getSearchResults(query: SearchRequest, metadata?: PageMetadata): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        const html = await this.requestHtml(zipComicSearchUrl(query.title ?? '', page))
        return this.resultsPage(html, page, metadata?.collectedIds)
    }

    async getViewMoreItems(sectionId: string): Promise<PagedResults> {
        throw new Error(`ZipComic section does not have additional pages: ${sectionId}`)
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const details = parseDetails(
            await this.requestHtml(`${ZIPCOMIC_DOMAIN}/${encodeURIComponent(mangaId)}`),
            mangaId,
        )
        const tags: TagSection[] = details.genres.length
            ? [
                  {
                      id: 'genres',
                      label: 'Genres',
                      tags: details.genres.map((genre) => ({
                          id: genre.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                          label: genre,
                      })),
                  },
              ]
            : []

        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                titles: [details.title],
                image: details.image,
                desc: '',
                status: details.status,
                author: details.author,
                artist: details.artist,
                rating: 0,
                tags,
                hentai: false,
            }),
        })
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const chapters = parseChapters(
            await this.requestHtml(`${ZIPCOMIC_DOMAIN}/${encodeURIComponent(mangaId)}`),
        )
        if (!chapters.length) throw new Error(`ZipComic returned no issues for ${mangaId}`)

        return chapters.map((chapter) =>
            App.createChapter({
                id: chapter.id,
                chapNum: chapter.number,
                sortingIndex: chapter.sortingIndex,
                name: chapter.title,
                langCode: '🇬🇧',
            }),
        )
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const pages = parsePages(
            await this.requestHtml(`${ZIPCOMIC_DOMAIN}/${encodeURIComponent(chapterId)}`),
        )
        if (!pages.length) throw new Error(`ZipComic returned no pages for issue ${chapterId}`)
        return App.createChapterDetails({ id: chapterId, mangaId, pages })
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        return App.createRequest({
            url: ZIPCOMIC_DOMAIN,
            method: 'GET',
            headers: {
                origin: ZIPCOMIC_DOMAIN,
                referer: `${ZIPCOMIC_DOMAIN}/`,
                'user-agent': await this.requestManager.getDefaultUserAgent(),
            },
        })
    }

    getMangaShareUrl(mangaId: string): string {
        return `${ZIPCOMIC_DOMAIN}/${encodeURIComponent(mangaId)}`
    }
}
