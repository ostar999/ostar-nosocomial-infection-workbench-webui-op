/**
 * Report exports: Markdown, HTML, plain text and Word.
 *
 * PDF is intentionally not generated on the server. The browser print dialog
 * is used to produce PDF from the HTML report, avoiding a LibreOffice dependency.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { markdownToText, reportHtml } from './markdown.js'
import { markdownToDocx } from './docx.js'

export const REPORT_BASENAME = '院感分析报告'
export const REPORT_FORMATS = ['md', 'html', 'txt', 'docx']
export const REPORT_CONTENT_TYPES = {
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export function reportFile (dir, format) {
  return path.join(dir, `${REPORT_BASENAME}.${format}`)
}

/**
 * Write every requested report format into the task directory.
 * @returns {Promise<{files: Record<string, {path: string, bytes: number}>, warnings: string[]}>}
 */
export async function writeReportFiles ({
  dir,
  markdown,
  title,
  subtitle,
  formats = REPORT_FORMATS,
}) {
  await fs.mkdir(dir, { recursive: true })
  const files = {}
  const write = async (format, contents) => {
    const file = reportFile(dir, format)
    await fs.writeFile(file, contents)
    files[format] = { path: file, bytes: Buffer.byteLength(contents) }
  }

  const wanted = new Set(formats.filter(format => REPORT_FORMATS.includes(format)))
  if (wanted.has('md')) await write('md', markdown)
  if (wanted.has('html')) await write('html', reportHtml({ markdown, title, subtitle }))
  if (wanted.has('txt')) await write('txt', markdownToText(markdown))
  if (wanted.has('docx')) await write('docx', markdownToDocx(markdown, { title }))

  return { files, warnings: [] }
}
