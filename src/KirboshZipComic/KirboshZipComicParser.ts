import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'

export const ZIPCOMIC_DOMAIN = 'https://www.zipcomic.com'

export interface ZipComicCard {
    id: string
    image: string
    title: string
}

export interface ZipComicDetails {
    title: string
    image: string
    status: string
    author: string
    artist: string
    genres: string[]
}

export interface ZipComicChapter {
    id: string
    number: number
    title: string
    sortingIndex: number
}

export function absoluteHttpsUrl(rawUrl: string): string {
    const cleaned = rawUrl.replace(/\\\//g, '/').trim()
    if (!cleaned || /^(?:data|javascript|file):/i.test(cleaned)) return ''
    if (cleaned.startsWith('//')) return `https:${cleaned}`
    if (/^https?:\/\//i.test(cleaned)) return cleaned.replace(/^http:/i, 'https:')
    return `${ZIPCOMIC_DOMAIN}${cleaned.startsWith('/') ? '' : '/'}${cleaned}`
}

function pathFromUrl(rawUrl: string): string {
    return rawUrl
        .trim()
        .replace(/^https?:\/\/[^/]+/i, '')
        .replace(/[?#].*$/, '')
        .replace(/^\/+|\/+$/g, '')
}

export function parseMangaId(rawUrl: string): string {
    const path = pathFromUrl(rawUrl)
    if (!path || path.includes('/') || path.includes('-issue-')) return ''
    if (/^(?:genre|search|comic|privacy|contact|dmca)$/i.test(path)) return ''
    try {
        return decodeURIComponent(path)
    } catch {
        return path
    }
}

export function parseChapterId(rawUrl: string): string {
    const path = pathFromUrl(rawUrl)
    if (!path.includes('-issue-') || path.includes('/')) return ''
    try {
        return decodeURIComponent(path)
    } catch {
        return path
    }
}

function imageFrom(element: cheerio.Cheerio<AnyNode>): string {
    return absoluteHttpsUrl(
        element.attr('data-src') ??
            element.attr('data-lazy-src') ??
            element.attr('data-original') ??
            element.attr('src') ??
            '',
    )
}

export function parseCards(html: string): ZipComicCard[] {
    const $ = cheerio.load(html)
    const results: ZipComicCard[] = []
    const seen = new Set<string>()

    $('img.img-responsive').each((_, element) => {
        const imageElement = $(element)
        const image = imageFrom(imageElement)
        if (!image || !image.includes('/img/')) return

        const anchor = imageElement.closest('a')
        const id = parseMangaId(anchor.attr('href') ?? '')
        const title = (imageElement.attr('alt') ?? anchor.attr('title') ?? '').trim()
        if (!id || !title || seen.has(id)) return

        seen.add(id)
        results.push({ id, image, title })
    })

    return results
}

export function zipComicSearchUrl(title: string, page: number): string {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
    return `${ZIPCOMIC_DOMAIN}/search?kwd=${encodeURIComponent(title.trim())}&p=${safePage}`
}

export function hasNextPage(html: string, currentPage: number): boolean {
    const $ = cheerio.load(html)
    return $('.pagination a')
        .toArray()
        .some((element) => {
            const href = $(element).attr('href') ?? ''
            const page = Number.parseInt(href.match(/[?&]p=(\d+)/)?.[1] ?? '', 10)
            return !Number.isNaN(page) && page > currentPage
        })
}

function labelledValue($: cheerio.CheerioAPI, names: string[]): { text: string; links: string[] } {
    let result = { text: '', links: [] as string[] }
    $('strong.text-success').each((_, element) => {
        if (result.text || result.links.length) return
        const label = $(element).text().replace(':', '').trim().toLowerCase()
        if (!names.includes(label)) return

        const container = $(element).parent()
        result = {
            text: container.text().replace($(element).text(), '').replace(/\s+/g, ' ').trim(),
            links: container
                .find('a')
                .toArray()
                .map((link) => $(link).text().trim())
                .filter(Boolean),
        }
    })
    return result
}

export function parseDetails(html: string, fallbackTitle = ''): ZipComicDetails {
    const $ = cheerio.load(html)
    const title = $('h1').first().text().trim() || fallbackTitle
    if (!title) throw new Error('ZipComic returned a title page without a comic title')

    const statusText = labelledValue($, ['status']).text.toLowerCase()
    const status = statusText.includes('ongoing')
        ? 'ONGOING'
        : statusText.includes('complete')
        ? 'COMPLETED'
        : 'UNKNOWN'
    const genres = labelledValue($, ['genre', 'genres']).links

    return {
        title,
        image: imageFrom($('img[src*="cover"], img[data-src*="cover"]').first()),
        status,
        author: labelledValue($, ['author', 'writer']).text,
        artist: labelledValue($, ['artist', 'artis']).text,
        genres,
    }
}

export function parseChapters(html: string): ZipComicChapter[] {
    const $ = cheerio.load(html)
    const chapters: ZipComicChapter[] = []
    const seen = new Set<string>()

    $('table tr').each((index, element) => {
        const row = $(element)
        const link = row.find('a[href*="-issue-"]').first()
        const id = parseChapterId(link.attr('href') ?? '')
        if (!id || seen.has(id)) return

        const title = link.text().replace(/\s+/g, ' ').trim()
        const order = Number.parseInt(row.find('td').first().text().trim(), 10)
        const numberText = title.match(/#\s*([\d.]+)/)?.[1] ?? title.match(/([\d.]+)\s*$/)?.[1]
        const number = Number.parseFloat(numberText ?? '')

        seen.add(id)
        chapters.push({
            id,
            title: title || `Issue ${Number.isNaN(number) ? index + 1 : number}`,
            number: Number.isNaN(number) ? (Number.isNaN(order) ? index + 1 : order) : number,
            sortingIndex: Number.isNaN(order) ? index : order,
        })
    })

    return chapters
}

export function parsePages(html: string): string[] {
    const $ = cheerio.load(html)
    const pages: string[] = []
    const seen = new Set<string>()

    $('#images img').each((_, element) => {
        const page = imageFrom($(element))
        if (!page || seen.has(page)) return
        seen.add(page)
        pages.push(page)
    })

    return pages
}

export function looksLikeCloudflareChallenge(html: string): boolean {
    const lower = html.toLowerCase()
    return (
        lower.includes('cf-chl-') ||
        lower.includes('just a moment') ||
        lower.includes('challenges.cloudflare.com') ||
        (lower.includes('window.performance') && lower.includes('crypto.subtle'))
    )
}
