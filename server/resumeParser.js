import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';

function cleanText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractResumeText(filePath, mimeType = '') {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx' || mimeType.includes('wordprocessingml')) {
    const result = await mammoth.extractRawText({ path: filePath });
    return cleanText(result.value);
  }

  if (ext === '.pdf' || mimeType.includes('pdf')) {
    try {
      const pdfParseModule = await import('pdf-parse');
      const buffer = await fs.readFile(filePath);
      let result;
      if (typeof pdfParseModule.PDFParse === 'function') {
        const parser = new pdfParseModule.PDFParse({ data: buffer });
        result = await parser.getText();
        await parser.destroy();
      } else {
        const pdfParse = pdfParseModule.default || pdfParseModule;
        result = await pdfParse(buffer);
      }
      return cleanText(result.text);
    } catch (error) {
      return cleanText(`PDF解析失败：${error.message}`);
    }
  }

  if (['.txt', '.md'].includes(ext) || mimeType.startsWith('text/')) {
    return cleanText(await fs.readFile(filePath, 'utf8'));
  }

  return cleanText(await fs.readFile(filePath, 'utf8').catch(() => ''));
}

export function parseEmailAddress(value = '') {
  const match = String(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : '';
}

export function inferNameFromFile(filename = '') {
  const base = path.basename(filename, path.extname(filename));
  return base
    .replace(/简历|resume|cv|超级智能体|实习申请|AI产品|产品经理/gi, '')
    .replace(/[-_（）()【】\[\]\s]+/g, ' ')
    .trim()
    .slice(0, 24);
}
