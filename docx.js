// Microsoft Word (.docx) support via mammoth (lazy npm dependency —
// loaded only when a DOCX actually opens; every other format never
// touches it). The converted HTML is escaped-safe (mammoth emits real
// elements), split into ~150KB sections at element boundaries (Part N
// TOC; avoids one giant DOM), images inlined as data URIs by mammoth's
// default converter.

export const isDocx = entries =>
    entries.some(entry => entry.filename === 'word/document.xml')

const SECTION_MAX = 150 * 1000

export const makeDocxBook = async file => {
    const mammoth = globalThis.mammoth ?? await import('mammoth')

    // mammoth unzips the docx itself: its node entry takes {buffer}, the
    // browser entry takes {arrayBuffer}
    // Buffer: present in node (mammoth's node entry wants {buffer});
    // undefined in browsers (the browser-field unzip takes {arrayBuffer})
    const input = typeof Buffer !== 'undefined'
        ? // eslint-disable-next-line no-undef
        { buffer: Buffer.from(await file.arrayBuffer()) }
        : { arrayBuffer: await file.arrayBuffer() }
    const { value: html } = await mammoth.convertToHtml(input)
    if (!html) throw new Error('DOCX conversion produced no content')

    // split the converted body into sections at block-element boundaries
    // (string-level — no DOMParser; complex nested structures may push a
    // chunk slightly over the cap, which the browser parser recovers)
    const boundaries = []
    const re = /<\/(?:p|h[1-6]|ul|ol|table|blockquote)>/g
    let m
    while ((m = re.exec(html))) boundaries.push(m.index + m[0].length)
    const chunks = []
    let start = 0
    for (const end of boundaries) {
        if (end - start >= SECTION_MAX) { chunks.push(html.slice(start, end)); start = end }
    }
    if (start < html.length) chunks.push(html.slice(start))

    const urls = new Map()
    const makeHTML = chunk => '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'
        + chunk + '</body></html>'
    const load = i => {
        if (!urls.has(i)) {
            const url = URL.createObjectURL(new Blob([makeHTML(chunks[i])], { type: 'text/html' }))
            urls.set(i, url)
        }
        return urls.get(i)
    }
    const createDocument = i => new DOMParser().parseFromString(makeHTML(chunks[i]), 'text/html')

    const book = {}
    book.metadata = { title: file.name.replace(/\.[^.]+$/, '') }
    book.sections = chunks.map((chunk, index) => ({
        id: index,
        load: () => load(index),
        createDocument: () => createDocument(index),
        size: chunk.length,
        linear: 'yes',
    }))
    book.toc = chunks.length > 1
        ? chunks.map((_, i) => ({ label: `Part ${i + 1}`, href: String(i) }))
        : []
    book.resolveHref = href => ({ index: parseInt(href, 10) || 0 })
    book.splitTOCHref = href => [href, null]
    book.getTOCFragment = doc => doc.documentElement
    book.format = 'docx'
    book.destroy = () => {
        for (const url of urls.values()) URL.revokeObjectURL(url)
        urls.clear()
    }
    return book
}
