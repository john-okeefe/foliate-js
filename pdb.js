// Plain-text Palm database (.pdb) support: the "TEXt"/"REAd" PDB
// container (PalmDOC, also TealDoc/TealPaint-text databases) stores a
// text document as numbered records, each optionally compressed with
// the PalmDOC LZ77 variant (the same compression MOBI uses — the
// container machinery is shared with mobi.js). Records are decoded as
// Windows-1252 (Palm-era text predates UTF-8) and the resulting text is
// handed to the plain-text pipeline for paragraph splitting, joining,
// and sectioning.
//
// Limitations (by design, MVP): no HUFF/CDIC compression (record 0
// compression type 17480 — that is MOBI territory, handled by mobi.js),
// no TealDoc anchor/link extensions, Windows-1252 decoding only.

import { getString } from './mobi.js'
import { makeTextBook } from './text.js'

const PDB_MAGIC_OFFSET = 60 // type (4) + creator (4)

export const isPDB = async file => {
    const magic = getString(await file.slice(PDB_MAGIC_OFFSET, PDB_MAGIC_OFFSET + 8).arrayBuffer())
    return magic === 'TEXtREAd'
}

export const makePalmDocBook = async file => {
    const { PDB, decompressPalmDOC } = await import('./mobi.js')
    const pdb = new PDB()
    await pdb.open(file)
    // record 0 opens with the PalmDOC header: compression (2 bytes),
    // unused (2), text length (4), num text records (2), record size (2),
    // encryption (2) — followed by optional TealDoc data
    const r0 = new Uint8Array(await pdb.loadRecord(0))
    const compression = (r0[0] << 8) | r0[1]
    const numTextRecords = (r0[8] << 8) | r0[9]

    if (compression !== 1 && compression !== 2)
        throw new Error(`Unsupported PalmDOC compression type ${compression}`)
    const count = numTextRecords || pdb.pdb.numRecords - 1

    const parts = []
    for (let i = 1; i <= count; i++) {
        const buf = new Uint8Array(await pdb.loadRecord(i))
        parts.push(compression === 2 ? decompressPalmDOC(buf) : buf)
    }
    const total = parts.reduce((sum, p) => sum + p.length, 0)
    const bytes = new Uint8Array(total)
    for (let i = 0, offset = 0; i < parts.length; i++) {
        bytes.set(parts[i], offset)
        offset += parts[i].length
    }
    // Palm-era text is Windows-1252 (Latin-1 superset), not UTF-8
    const text = new TextDecoder('windows-1252').decode(bytes)
    const name = (pdb.pdb.name || '').replace(/\0/g, '').trim()
    const fileName = name || file.name.replace(/\.[^.]+$/, '')

    // reuse the plain-text pipeline: paragraph split, line join, sections
    return makeTextBook(new File([text], `${fileName}.txt`, { type: 'text/plain' }))
}
