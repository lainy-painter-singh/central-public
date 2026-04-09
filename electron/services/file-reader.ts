/**
 * File Reader
 *
 * Extracts text content from various file types for use in AI prompts.
 * Supports: PDF, Excel, CSV, text, markdown, JSON.
 */
import fs from 'fs'
import path from 'path'

export async function extractFileText(filePath: string): Promise<{ content: string; filename: string }> {
  const ext = path.extname(filePath).toLowerCase()
  const filename = path.basename(filePath)

  switch (ext) {
    case '.pdf': {
      // pdf-parse v2 uses PDFParse class with { data: Uint8Array }
      const { PDFParse } = require('pdf-parse')
      const buffer = fs.readFileSync(filePath)
      const parser = new PDFParse({ data: new Uint8Array(buffer) })
      const result = await parser.getText()
      await parser.destroy()
      return { content: result.text, filename }
    }
    case '.xlsx':
    case '.xls': {
      const XLSX = require('xlsx')
      const workbook = XLSX.readFile(filePath)
      const sheets = workbook.SheetNames.map((name: string) => {
        const sheet = workbook.Sheets[name]
        return `## Sheet: ${name}\n${XLSX.utils.sheet_to_csv(sheet)}`
      })
      return { content: sheets.join('\n\n'), filename }
    }
    case '.csv': {
      const content = fs.readFileSync(filePath, 'utf-8')
      return { content, filename }
    }
    case '.txt':
    case '.md':
    case '.json':
    case '.tsv': {
      const content = fs.readFileSync(filePath, 'utf-8')
      return { content, filename }
    }
    default: {
      // Try reading as UTF-8 text
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        if (content.includes('\0')) {
          throw new Error(`Unsupported binary file type: ${ext}`)
        }
        return { content, filename }
      } catch (err: any) {
        if (err.message.includes('Unsupported')) throw err
        throw new Error(`Cannot read file type: ${ext}`)
      }
    }
  }
}
