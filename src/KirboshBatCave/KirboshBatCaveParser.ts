import * as cheerio from 'cheerio'

export const BATCAVE_DOMAIN = 'https://batcave.biz'

export const SELECTORS = {
    challenge: '#challenge-running, #challenge-form, .cf-browser-verification',
    searchCard: '#dle-content .readed, .readed',
    searchTitle: '.readed__title a',
    searchImage: 'img',
    popularCard: 'a.poster.grid-item, .poster.grid-item',
    popularTitle: '.poster__title',
    popularImage: '.poster__img img',
    latestCard: '#content-load .latest.grid-item, .sect--latest .latest.grid-item',
    latestTitle: '.latest__title a, a .latest__title',
    latestImage: '.latest__img img, .latest-chapter__img img',
    title: 'h1',
    cover: '.page__poster img',
    description: '.page__text',
    rating: '.page__poster-rating-score, .page__rating-score',
    metadataRow: '.page__list li',
    genre: '.page__tags a',
} as const

export interface ParsedCard {
    id: string
    image: string
    title: string
    subtitle?: string
}

export interface ParsedDetails {
    title: string
    image: string
    description: string
    rating?: number
    status: string
    authors: string[]
    artists: string[]
    publishers: string[]
    genres: string[]
}

export interface ParsedChapter {
    id: string
    number: number
    title: string
    date?: Date
}

export interface ParsedReaderData {
    images: string[]
    usesAjax: boolean
}

interface BatCaveData {
    chapters?: Array<{
        id?: number | string
        posi?: number | string
        title?: string
        date?: string
    }>
    images?: string[]
    rdr_ajax?: boolean
}

export function absoluteHttpsUrl(rawUrl: string, baseUrl = BATCAVE_DOMAIN): string {
    const cleaned = rawUrl.replace(/\\\//g, '/').trim()
    if (!cleaned) return ''
    if (/^(?:data|javascript|file):/i.test(cleaned)) return ''
    if (/^\/\//.test(cleaned)) return `https:${cleaned}`
    if (/^https?:\/\//i.test(cleaned)) return cleaned.replace(/^http:/i, 'https:')

    const secureBase = baseUrl.replace(/^http:/i, 'https:').replace(/[?#].*$/, '')
    const origin = secureBase.match(/^https:\/\/[^/]+/i)?.[0]
    if (!origin) return ''
    if (cleaned.startsWith('/')) return `${origin}${cleaned}`

    const basePath = secureBase.slice(origin.length)
    const directory =
        !basePath || basePath === '/'
            ? `${origin}/`
            : secureBase.endsWith('/')
            ? secureBase
            : `${secureBase.slice(0, secureBase.lastIndexOf('/') + 1)}`
    return `${directory}${cleaned}`
}

export function parseMangaId(rawUrl: string): string {
    if (!rawUrl) return ''

    const encodedId = rawUrl
        .trim()
        .replace(/[?#].*$/, '')
        .replace(/\/+$/, '')
        .replace(/^.*\//, '')
        .replace(/\.html$/i, '')
    try {
        return decodeURIComponent(encodedId)
    } catch {
        return encodedId
    }
}

export function batcaveSearchUrl(title: string, page: number): string {
    const safePage = Number.isFinite(page) && page > 1 ? Math.floor(page) : 1
    const searchTerm = title.trim()
    if (!searchTerm) {
        return safePage === 1
            ? `${BATCAVE_DOMAIN}/comix/`
            : `${BATCAVE_DOMAIN}/comix/page/${safePage}/`
    }

    const searchRoot = `${BATCAVE_DOMAIN}/search/${encodeURIComponent(searchTerm)}/`
    return safePage === 1 ? searchRoot : `${searchRoot}page/${safePage}/`
}

function lazyImage(rawUrl: string): string {
    return absoluteHttpsUrl(rawUrl)
}

function uniqueCards(cards: ParsedCard[]): ParsedCard[] {
    const seen = new Set<string>()
    return cards.filter((card) => {
        if (!card.id || !card.title || !card.image || seen.has(card.id)) return false
        seen.add(card.id)
        return true
    })
}

export function parseSearchResults(html: string): ParsedCard[] {
    const $ = cheerio.load(html)
    const cards: ParsedCard[] = []

    $(SELECTORS.searchCard).each((_, element) => {
        const unit = $(element)
        const titleLink = unit.find(SELECTORS.searchTitle).first()
        cards.push({
            id: parseMangaId(titleLink.attr('href') ?? ''),
            image: lazyImage(
                unit.find(SELECTORS.searchImage).first().attr('data-src') ??
                    unit.find(SELECTORS.searchImage).first().attr('data-lazy-src') ??
                    unit.find(SELECTORS.searchImage).first().attr('data-original') ??
                    unit.find(SELECTORS.searchImage).first().attr('src') ??
                    '',
            ),
            title: titleLink.text().trim(),
            subtitle: unit
                .find('.readed__info li:last-child')
                .text()
                .replace(/last issue:\s*/i, '')
                .trim(),
        })
    })

    return uniqueCards(cards)
}

export function parsePopular(html: string): ParsedCard[] {
    const $ = cheerio.load(html)
    const cards: ParsedCard[] = []

    $(SELECTORS.popularCard).each((_, element) => {
        const unit = $(element)
        const link = unit.is('a') ? unit : unit.find('a').first()
        const rating = unit.find('.poster__label--rate').first().text().trim()
        cards.push({
            id: parseMangaId(link.attr('href') ?? unit.attr('href') ?? ''),
            image: lazyImage(
                unit.find(SELECTORS.popularImage).first().attr('data-src') ??
                    unit.find(SELECTORS.popularImage).first().attr('src') ??
                    '',
            ),
            title: unit.find(SELECTORS.popularTitle).first().text().trim(),
            subtitle: rating ? `Rating: ${rating}` : undefined,
        })
    })

    return uniqueCards(cards)
}

export function parseLatest(html: string): ParsedCard[] {
    const $ = cheerio.load(html)
    const cards: ParsedCard[] = []

    $(SELECTORS.latestCard).each((_, element) => {
        const unit = $(element)
        const titleLink = unit.find(SELECTORS.latestTitle).first()
        const title = titleLink.clone().children().remove().end().text().trim()
        cards.push({
            id: parseMangaId(titleLink.attr('href') ?? ''),
            image: lazyImage(
                unit.find(SELECTORS.latestImage).first().attr('data-src') ??
                    unit.find(SELECTORS.latestImage).first().attr('src') ??
                    '',
            ),
            title,
            subtitle: unit.find('.latest__chapter a').first().text().trim(),
        })
    })

    return uniqueCards(cards)
}

export function hasNextPage(html: string, currentPage: number): boolean {
    const $ = cheerio.load(html)
    return $('.pagination a, .pagination__pages a, .pagination__btn-loader a')
        .toArray()
        .some((element) => {
            const text = $(element).text().trim()
            const href = $(element).attr('href') ?? ''
            const pageFromText = Number.parseInt(text, 10)
            const pageFromHref = Number.parseInt(href.match(/\/page\/(\d+)/)?.[1] ?? '', 10)
            return (
                text.includes('»') ||
                (!Number.isNaN(pageFromText) && pageFromText > currentPage) ||
                (!Number.isNaN(pageFromHref) && pageFromHref > currentPage)
            )
        })
}

function metadataValues($: cheerio.CheerioAPI, labels: string[]): string[] {
    const row = $(SELECTORS.metadataRow)
        .filter((_, element) => {
            const text = $(element).text().toLowerCase()
            return labels.some((label) => text.includes(label.toLowerCase()))
        })
        .first()

    const linkedValues = row
        .find('a')
        .toArray()
        .map((element) => $(element).text().trim())
        .filter(Boolean)
    if (linkedValues.length > 0) return linkedValues

    const text = row
        .text()
        .replace(/^[^:]+:\s*/, '')
        .trim()
    return text
        ? text
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
        : []
}

export function parseDetails(html: string): ParsedDetails {
    const $ = cheerio.load(html)
    const title = $(SELECTORS.title).first().text().trim()
    if (!title) throw new Error('BatCave returned a title page without a comic title')

    const statusText = metadataValues($, ['release type', 'status']).join(' ').toLowerCase()
    const status = statusText.includes('completed')
        ? 'COMPLETED'
        : statusText.includes('ongoing')
        ? 'ONGOING'
        : 'UNKNOWN'
    const ratingText = $(SELECTORS.rating).first().text()
    const ratingValue = Number.parseFloat(ratingText.match(/\d+(?:\.\d+)?/)?.[0] ?? '')

    return {
        title,
        image: lazyImage(
            $(SELECTORS.cover).first().attr('data-src') ??
                $(SELECTORS.cover).first().attr('src') ??
                '',
        ),
        description: $(SELECTORS.description).first().text().trim(),
        rating: Number.isNaN(ratingValue) ? undefined : ratingValue,
        status,
        authors: metadataValues($, ['writer', 'author']),
        artists: metadataValues($, ['artist']),
        publishers: metadataValues($, ['publisher']),
        genres: $(SELECTORS.genre)
            .toArray()
            .map((element) => $(element).text().trim())
            .filter(Boolean),
    }
}

export function extractWindowData(html: string): BatCaveData {
    const markerIndex = html.indexOf('window.__DATA__')
    if (markerIndex < 0) throw new Error('BatCave response does not contain reader data')

    const start = html.indexOf('{', markerIndex)
    if (start < 0) throw new Error('BatCave reader data is malformed')

    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < html.length; index += 1) {
        const character = html[index]
        if (inString) {
            if (escaped) escaped = false
            else if (character === '\\') escaped = true
            else if (character === '"') inString = false
            continue
        }
        if (character === '"') inString = true
        else if (character === '{') depth += 1
        else if (character === '}') {
            depth -= 1
            if (depth === 0) {
                try {
                    return JSON.parse(html.slice(start, index + 1)) as BatCaveData
                } catch {
                    throw new Error('BatCave reader data is not valid JSON')
                }
            }
        }
    }

    throw new Error('BatCave reader data is incomplete')
}

function parseDate(rawDate?: string): Date | undefined {
    const parts = rawDate?.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
    if (!parts) return undefined
    return new Date(Date.UTC(Number(parts[3]), Number(parts[2]) - 1, Number(parts[1])))
}

export function parseChapters(html: string): ParsedChapter[] {
    const data = extractWindowData(html)
    const chapters = (data.chapters ?? [])
        .map((chapter): ParsedChapter | undefined => {
            const id = String(chapter.id ?? '').trim()
            const number = Number(chapter.posi)
            if (!id || !Number.isFinite(number)) return undefined
            return {
                id,
                number,
                title: chapter.title?.trim() || `Issue ${number}`,
                date: parseDate(chapter.date),
            }
        })
        .filter((chapter): chapter is ParsedChapter => chapter !== undefined)

    chapters.sort((left, right) => right.number - left.number)
    return chapters
}

export function parseReaderData(html: string): ParsedReaderData {
    const data = extractWindowData(html)
    const seen = new Set<string>()
    const images = (data.images ?? [])
        .map((image) => absoluteHttpsUrl(image))
        .filter((image) => {
            if (!image || seen.has(image)) return false
            seen.add(image)
            return true
        })

    return { images, usesAjax: data.rdr_ajax === true }
}

export function looksLikeCloudflareChallenge(html: string): boolean {
    const lower = html.toLowerCase()
    if (
        lower.includes('cf-chl-') ||
        lower.includes('just a moment...') ||
        lower.includes('challenges.cloudflare.com') ||
        (lower.includes('pow_nonce') && lower.includes('pow_hash')) ||
        /\.open\(\s*["']POST["']\s*,\s*["']\/_v["']/.test(html)
    ) {
        return true
    }
    const $ = cheerio.load(html)
    return $(SELECTORS.challenge).length > 0
}
