// Plain-text (.txt) support: the file is decoded as UTF-8, split into
// blank-line-separated paragraphs with hard-wrapped lines joined (so the
// text reflows naturally under font-size changes), and packed into
// sections of at most ~150KB at paragraph boundaries — one giant DOM
// would be memory-hungry, and the section cap yields a small
// "Part N" table of contents for free.
//
// Limitations (by design, MVP): UTF-8 only (no encoding sniffing), LTR,
// no chapter-title detection, no cover.

const escapeHTML = s => s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

export const isText = file =>
    file.type === 'text/plain' || /\.txt$/i.test(file.name)

const SECTION_MAX = 150 * 1000

export const makeTextBook = async file => {
    let text = await file.text()
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // BOM
    text = text.replace(/\r\n?/g, '\n')
    const paras = text.split(/\n[ \t]*\n+/)
        .map(p => p.replace(/\s+/g, ' ').trim())
        .filter(p => p)

    // pack paragraphs into sections at paragraph boundaries
    const chunks = []
    let cur = [], len = 0
    for (const p of paras) {
        if (len && len + p.length + 11 > SECTION_MAX) { chunks.push(cur); cur = []; len = 0 }
        cur.push(p); len += p.length + 11 // '<p></p>' overhead
    }
    if (cur.length) chunks.push(cur)

    const urls = new Map()
    const load = i => {
        if (!urls.has(i)) {
            const html = chunks[i].map(p => `<p>${escapeHTML(p)}</p>`).join('\n')
            const url = URL.createObjectURL(new Blob(
                [`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`],
                { type: 'text/html' }))
            urls.set(i, url)
        }
        return urls.get(i)
    }
    const createDocument = i => {
        const html = chunks[i].map(p => `<p>${escapeHTML(p)}</p>`).join('\n')
        return new DOMParser().parseFromString(
            `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`,
            'text/html')
    }

    const book = {}
    book.metadata = { title: file.name.replace(/\.[^.]+$/, '') }
    book.sections = chunks.map((_, index) => ({
        id: index,
        load: () => load(index),
        createDocument: () => createDocument(index),
        size: chunks[index].reduce((a, p) => a + p.length + 11, 0),
        linear: 'yes',
    }))
    book.toc = chunks.length > 1
        ? chunks.map((_, i) => ({ label: `Part ${i + 1}`, href: String(i) }))
        : []
    book.resolveHref = href => ({ index: parseInt(href, 10) || 0 })
    book.splitTOCHref = href => [href, null]
    book.getTOCFragment = doc => doc.documentElement
    book.format = 'text'
    book.destroy = () => {
        for (const url of urls.values()) URL.revokeObjectURL(url)
        urls.clear()
    }
    return book
}
