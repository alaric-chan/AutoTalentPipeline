import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';

function cleanText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanCandidateName(value = '') {
  return String(value || '')
    .replace(/^\s*(?:姓名|Name)\s*[:：]?\s*/i, '')
    .replace(/(个人)?简历|resume|cv|求职|应聘|候选人/gi, '')
    .replace(/[|｜,，;；/\\]+/g, ' ')
    .trim();
}

function looksLikeChineseName(value = '') {
  const text = cleanCandidateName(value).replace(/\s+/g, '');
  if (!/^[\u4e00-\u9fa5·]{2,6}$/.test(text)) return false;
  return !/(大学|学院|学校|专业|科技|工程|北京|上海|广州|深圳|实习|到岗|本科|硕士|博士)/.test(text);
}

function looksLikeEnglishName(value = '') {
  return /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(cleanCandidateName(value));
}

export async function extractResumeText(filePath, mimeType = '') {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx' || mimeType.includes('wordprocessingml')) {
    const result = await mammoth.extractRawText({ path: filePath });
    return cleanText(result.value);
  }

  if (ext === '.doc' || mimeType.includes('msword')) {
    try {
      const extractor = new WordExtractor();
      const document = await extractor.extract(filePath);
      return cleanText(document.getBody());
    } catch (error) {
      return cleanText(`Word解析失败：${error.message}`);
    }
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

export function parsePhoneNumber(value = '') {
  const text = String(value || '');
  const labeled = text.match(
    /(?:联系电话|联系方式|手机号|手机|电话|Phone|Tel)\s*[:：]?\s*((?:\+?86[-\s]?)?1[3-9]\d(?:[-\s]?\d){8}|(?:\+?\d[\d\s().-]{7,}\d))/i
  );
  const mobile = text.match(/(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d(?:[-\s]?\d){8}(?!\d)/);
  const match = labeled?.[1] || mobile?.[0] || '';
  return match.replace(/\s+/g, ' ').trim();
}

export function inferNameFromFile(filename = '') {
  const base = path.basename(filename, path.extname(filename));
  const tokens = base
    .split(/[-_（）()【】\[\]\s]+/)
    .map(cleanCandidateName)
    .filter(Boolean);
  const chineseName = tokens.find(looksLikeChineseName);
  if (chineseName) return chineseName.replace(/\s+/g, '');
  const englishName = tokens.find(looksLikeEnglishName);
  if (englishName) return englishName;
  return cleanCandidateName(base)
    .replace(/简历|resume|cv|超级智能体|实习申请|AI产品|产品经理/gi, '')
    .replace(/[-_（）()【】\[\]\s]+/g, ' ')
    .trim()
    .slice(0, 24);
}

export function inferNameFromText(text = '', filename = '') {
  const content = cleanText(text);
  const labeled = content.match(/(?:^|\n)\s*(?:姓名|Name)\s*[:：]\s*([^\n\r]{2,40})/i);
  const labeledName = cleanCandidateName(labeled?.[1] || '');
  if (looksLikeChineseName(labeledName)) return labeledName.replace(/\s+/g, '');
  if (looksLikeEnglishName(labeledName)) return labeledName;

  const lines = content
    .split(/\n/)
    .slice(0, 30)
    .map(cleanCandidateName)
    .filter((line) => line && !parseEmailAddress(line) && !parsePhoneNumber(line));
  const chineseLine = lines.find(looksLikeChineseName);
  if (chineseLine) return chineseLine.replace(/\s+/g, '');
  const englishLine = lines.find(looksLikeEnglishName);
  if (englishLine) return englishLine;
  return inferNameFromFile(filename);
}

export function extractResumeProfile({ text = '', filename = '' } = {}) {
  return {
    name: inferNameFromText(text, filename),
    email: parseEmailAddress(text),
    phone: parsePhoneNumber(text)
  };
}
