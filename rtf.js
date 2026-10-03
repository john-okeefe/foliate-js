// Rich Text Format (.rtf) support: a minimal RTF tokenizer that
// extracts the document text (with paragraph structure) and hands it to
// the plain-text pipeline. Format runs (bold/italic/fonts/colors) are
// intentionally NOT converted — RTF is read here as styled text, the
// same treatment .txt gets.
//
// What is handled: groups, control words with optional signed numeric
// parameters, \'hh hex escapes (Windows-1252), \uN unicode with \ucN
// fallback skipping, \par/\line/\tab/page/section breaks, dashes,
// quotes, spaces, \\ \{ \} escapes, and destination groups that carry
// no readable text (fonttbl, colortbl, stylesheet, info, pict, object,
// field/fldinst, generator, list tables, rsid tables, headers/footers,
// index entries, bookmarks). Unknown control words are ignored (the
// spec's required behavior); unknown `\*` optional destinations are
// kept and their text read.
//
// Limitations (by design, MVP): tables flatten to plain text, no
// images, no list numbering, footnotes inline after their reference.

import { makeTextBook } from './text.js'

export const isRTF = async file => {
    // `{\rtf` magic — content-based, like every makeBook dispatch
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer())
    const magic = String.fromCharCode(...head)
    return magic === '{\\rtf'
}

const DESTINATIONS = new Set([
    'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object',
    'thicket', 'field', 'fldinst', 'fldalt', 'generator', 'xmlnstbl',
    'listtable', 'listoverridetable', 'rsidtbl', 'latentstyles',
    'datastore', 'themedata', 'colorschememapping', 'pgdsctbl',
    'header', 'footer', 'headerl', 'headerr', 'headerf',
    'footerl', 'footerr', 'footerf', 'ftnsep', 'ftnsepc',
    'aftnsep', 'aftnsepc', 'xe', 'tc', 'bkmkstart', 'bkmkend',
    'nonshppict', 'mmathPr',
])

const CP1252_EXTRA = {
    128: '€', 129: '\uFFFD', 130: '‚', 131: 'ƒ', 132: '„', 133: '…',
    134: '†', 135: '‡', 136: 'ˆ', 137: '‰', 138: 'Š', 139: '‹',
    140: 'Œ', 142: 'Ž', 145: '‘', 146: '’', 147: '“', 148: '”',
    149: '•', 150: '–', 151: '—', 152: '˜', 153: '™', 154: 'š',
    155: '›', 156: 'œ', 158: 'ž', 159: 'Ÿ',
}

const decodeByte = code => CP1252_EXTRA[code] ?? String.fromCharCode(code)

const WORD_PARAMS = {
    par: '\n\n',
    line: '\n',
    tab: '\t',
    page: '\n\n',
    sect: '\n\n',
    emdash: '—',
    endash: '–',
    emspace: ' ',
    enspace: ' ',
    qmspace: ' ',
    bullet: '•',
    lquote: '‘',
    rquote: '’',
    ldblquote: '“',
    rdblquote: '”',
    zwnj: '',
    zwj: '',
}

export const rtfToText = input => {
    const text = typeof input === 'string' ? input : new TextDecoder('windows-1252').decode(input)
    const n = text.length
    let out = ''
    let unicodeSkip = 1
    // per-group skipping flags; a group skips if it or any ancestor is
    // a text destination
    const skipStack = []

    const skipping = () => skipStack.some(Boolean)

    let i = 0
    while (i < n) {
        const ch = text[i]
        if (ch === '\\') {
            const next = text[i + 1] ?? ''
            if (next === '\\' || next === '{' || next === '}') {
                if (!skipping()) out += next
                i += 2
                continue
            }
            if (next === "'") {
                const hex = text.slice(i + 2, i + 4)
                if (!skipping() && /^[0-9a-fA-F]{2}$/.test(hex))
                    out += decodeByte(parseInt(hex, 16))
                i += 4
                continue
            }
            if (/[a-zA-Z]/.test(next)) {
                // control word: letters, then an optional signed integer,
                // terminated by a (consumed) space or any other character
                let j = i + 1
                let word = ''
                while (j < n && /[a-zA-Z]/.test(text[j])) word += text[j++]
                let param = null
                if (/[0-9-]/.test(text[j] ?? '')) {
                    let digits = ''
                    if (text[j] === '-') { digits = '-'; j++ }
                    while (j < n && /[0-9]/.test(text[j])) digits += text[j++]
                    param = parseInt(digits)
                }
                if (text[j] === ' ') j++
                i = j
                // process
                if (word === 'uc' && param != null) {
                    unicodeSkip = param
                } else if (word === 'u' && param != null) {
                    let code = param < 0 ? param + 65536 : param
                    if (!skipping()) out += String.fromCharCode(code)
                    // skip the \ucN fallback characters after the escape
                    for (let k = 0; k < unicodeSkip; k++) {
                        if (text[i] === ' ') i++
                        else if (text[i] === '\\' && text[i + 1] === "'") i += 4
                        else i++
                    }
                } else if (DESTINATIONS.has(word)) {
                    if (skipStack.length) skipStack[skipStack.length - 1] = true
                } else if (!skipping() && WORD_PARAMS[word]) {
                    out += WORD_PARAMS[word]
                }
                continue
            }
            // any other control symbol (\*, \~, \|-…) — ignored
            i += 2
            continue
        }
        if (ch === '{') { skipStack.push(false); i++; continue }
        if (ch === '}') { skipStack.pop(); i++; continue }
        if (ch === '\r' || ch === '\n') { i++; continue }
        if (!skipping()) out += ch
        i++
    }
    return out
}

export const makeRTFBook = async file => {
    const text = rtfToText(new Uint8Array(await file.arrayBuffer()))
    if (!text.trim()) throw new Error('No extractable text in RTF')
    return makeTextBook(new File([text], file.name.replace(/\.[^.]+$/, '') + '.txt', { type: 'text/plain' }))
}
