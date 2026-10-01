import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The type scale documented at the top of styles.css. Anything else is a new size creeping in.
// 10 is only for tags, which are in capitals (capitals read a size larger).
const SCALE = [10, 11, 12, 13, 14, 15, 17, 18, 20, 26, 30]
const here = __dirname

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [join(dir, e.name)] : [],
  )
}

describe('type scale', () => {
  it('components use only the scale’s sizes', () => {
    const off = sources(here).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/text-\[([\d.]+)px\]/g)].filter((m) => !SCALE.includes(Number(m[1]))).map((m) => `${file.slice(here.length + 1)}: ${m[0]}`),
    )
    expect(off).toEqual([])
  })

  it('the stylesheet uses only the scale’s sizes (in px)', () => {
    const css = readFileSync(join(here, 'styles.css'), 'utf8')
    const sizes = [...css.matchAll(/(?:font-size|--text|--read-size|--title-size):\s*([\d.]+)px/g)].map((m) => Number(m[1]))
    expect(sizes.filter((s) => !SCALE.includes(s))).toEqual([])
  })
})
