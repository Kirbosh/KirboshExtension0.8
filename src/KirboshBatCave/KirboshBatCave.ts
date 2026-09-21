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
    BATCAVE_DOMAIN,
    batcaveSearchUrl,
    hasNextPage,
    looksLikeCloudflareChallenge,
    parseChapters,
    parseDetails,
    parseLatest,
    parsePopular,
    parseReaderData,
    parseSearchResults,
} from './KirboshBatCaveParser'

export const KirboshBatCaveInfo: SourceInfo = {
    version: '1.0.1',
    name: 'BatCave',
    description: 'Western comics from BatCave, maintained for Paperback 0.8.',
    author: 'Kirbosh & Karrot',
    icon: 'icon.png',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: BATCAVE_DOMAIN,
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

export class KirboshBatCave
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
                // Paperback 0.8 runs extensions in JavaScriptCore, where the browser URL
                // global is unavailable on older iOS versions. Keep this check string-only.
                const imageRequest = /^https:\/\/img\.batcave\.biz(?:[/:]|$)/i.test(request.url)
                request.headers = {
                    ...(request.headers ?? {}),
                    referer: imageRequest ? `${BATCAVE_DOMAIN}/` : BATCAVE_DOMAIN,
                    'user-agent': await this.requestManager.getDefaultUserAgent(),
                    accept: imageRequest
                        ? 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
                        : 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
                    'accept-language': 'en-US,en;q=0.8',
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
        if (response.status === 403 || response.status === 503) {
            throw new Error(
                'BatCave needs Cloudflare verification. Open the BatCave source, tap the cloud icon, complete the check, then retry.',
            )
        }
        if (response.status < 200 || response.status >= 400) {
            throw new Error(`BatCave returned HTTP ${response.status} for ${url}`)
        }
        if (!html.trim()) throw new Error(`BatCave returned an empty response for ${url}`)
        if (looksLikeCloudflareChallenge(html)) {
            throw new Error(
                'BatCave requires Cloudflare verification. Open the source in Paperback and retry.',
            )
        }
        return html
    }

    private partialManga(card: ReturnType<typeof parseSearchResults>[number]): PartialSourceManga {
        return App.createPartialSourceManga({
            mangaId: card.id,
            image: card.image,
            title: card.title,
            subtitle: card.subtitle,
        })
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const details = parseDetails(
            await this.requestHtml(`${BATCAVE_DOMAIN}/${encodeURIComponent(mangaId)}.html`),
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
        const additionalInfo: Record<string, string> = {}
        if (details.publishers.length) additionalInfo.Publisher = details.publishers.join(', ')

        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                titles: [details.title],
                image: details.image,
                desc: details.description,
                status: details.status,
                author: details.authors.join(', '),
                artist: details.artists.join(', '),
                rating: details.rating,
                tags,
                hentai: false,
                additionalInfo,
            }),
        })
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const [homeHtml, catalogueHtml] = await Promise.all([
            this.requestHtml(BATCAVE_DOMAIN),
            this.requestHtml(`${BATCAVE_DOMAIN}/comix/`),
        ])

        sectionCallback(
            App.createHomeSection({
                id: 'popular',
                title: 'Popular',
                containsMoreItems: false,
                type: HomeSectionType.singleRowLarge,
                items: parsePopular(homeHtml).map((card) => this.partialManga(card)),
            }),
        )
        sectionCallback(
            App.createHomeSection({
                id: 'latest',
                title: 'Latest',
                containsMoreItems: true,
                type: HomeSectionType.singleRowNormal,
                items: parseLatest(homeHtml).map((card) => this.partialManga(card)),
            }),
        )
        sectionCallback(
            App.createHomeSection({
                id: 'catalogue',
                title: 'Catalogue',
                containsMoreItems: true,
                type: HomeSectionType.singleRowNormal,
                items: parseSearchResults(catalogueHtml).map((card) => this.partialManga(card)),
            }),
        )
    }

    async getSearchResults(query: SearchRequest, metadata?: PageMetadata): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        const title = query.title?.trim() ?? ''
        const url = batcaveSearchUrl(title, page)
        return this.resultsPage(await this.requestHtml(url), page, metadata?.collectedIds)
    }

    async getViewMoreItems(sectionId: string, metadata?: PageMetadata): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        let url: string
        let latest = false
        if (sectionId === 'catalogue') {
            url = page === 1 ? `${BATCAVE_DOMAIN}/comix/` : `${BATCAVE_DOMAIN}/comix/page/${page}/`
        } else if (sectionId === 'latest') {
            latest = true
            url = page === 1 ? BATCAVE_DOMAIN : `${BATCAVE_DOMAIN}/page/${page}/`
        } else {
            throw new Error(`Unsupported BatCave section: ${sectionId}`)
        }

        const html = await this.requestHtml(url)
        const cards = latest ? parseLatest(html) : parseSearchResults(html)
        return this.resultsPage(html, page, metadata?.collectedIds, cards)
    }

    private resultsPage(
        html: string,
        page: number,
        collectedIds: string[] = [],
        parsedCards = parseSearchResults(html),
    ): PagedResults {
        const seen = new Set(collectedIds)
        const freshCards = parsedCards.filter((card) => {
            if (seen.has(card.id)) return false
            seen.add(card.id)
            return true
        })
        return App.createPagedResults({
            results: freshCards.map((card) => this.partialManga(card)),
            metadata: hasNextPage(html, page)
                ? { page: page + 1, collectedIds: Array.from(seen) }
                : undefined,
        })
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const chapters = parseChapters(
            await this.requestHtml(`${BATCAVE_DOMAIN}/${encodeURIComponent(mangaId)}.html`),
        )
        if (!chapters.length) throw new Error(`BatCave returned no issues for ${mangaId}`)

        return chapters.map((chapter) =>
            App.createChapter({
                id: chapter.id,
                chapNum: chapter.number,
                name: chapter.title,
                time: chapter.date,
                langCode: '🇬🇧',
            }),
        )
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const newsId = mangaId.match(/^\d+/)?.[0]
        if (!newsId) throw new Error(`BatCave title ID is invalid: ${mangaId}`)

        const readerUrl = `${BATCAVE_DOMAIN}/reader/${newsId}/${encodeURIComponent(chapterId)}`
        const readerData = parseReaderData(await this.requestHtml(readerUrl))
        let pages = readerData.images

        if (!pages.length && readerData.usesAjax) {
            const response = await this.requestManager.schedule(
                App.createRequest({
                    url: `${BATCAVE_DOMAIN}/engine/ajax/controller.php?mod=api&action=reader/getChapterData`,
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    data: `news_id=${encodeURIComponent(newsId)}&chapter_id=${encodeURIComponent(
                        chapterId,
                    )}`,
                }),
                1,
            )
            if (response.status < 200 || response.status >= 400) {
                throw new Error(`BatCave reader returned HTTP ${response.status}`)
            }
            try {
                const parsed = JSON.parse(response.data ?? '') as { data?: { images?: string[] } }
                pages = parsed.data?.images ?? []
            } catch {
                throw new Error('BatCave reader returned invalid JSON')
            }
        }

        pages = parseReaderData(
            `<script>window.__DATA__ = ${JSON.stringify({ images: pages })};</script>`,
        ).images
        if (!pages.length) throw new Error(`BatCave returned no pages for issue ${chapterId}`)

        return App.createChapterDetails({ id: chapterId, mangaId, pages })
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        return App.createRequest({
            url: BATCAVE_DOMAIN,
            method: 'GET',
            headers: {
                referer: BATCAVE_DOMAIN,
                'user-agent': await this.requestManager.getDefaultUserAgent(),
            },
        })
    }

    getMangaShareUrl(mangaId: string): string {
        return `${BATCAVE_DOMAIN}/${encodeURIComponent(mangaId)}.html`
    }
}
