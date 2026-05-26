import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths, config } from './config.js';

function foldIcsLine(line) {
  if (line.length <= 74) return line;
  const chunks = [];
  let rest = line;
  while (rest.length > 74) {
    chunks.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  chunks.push(rest);
  return chunks.join('\r\n');
}

function escapeIcs(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatIcsDate(value) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function safeSlug(value = '') {
  return String(value || 'candidate')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export async function exportInterviewArtifacts({ candidate, interview, email }) {
  const outboxDir = path.join(paths.data, 'outbox');
  await fs.mkdir(outboxDir, { recursive: true });

  const name = candidate.name || candidate.screening?.candidate_name || '候选人';
  const emailAddress = candidate.email || '';
  const uid = `${crypto.randomUUID()}@leai-recruiting.local`;
  const organizer = config.recruiting.contactEmail;
  const description = email.bodyText;
  const attendeeLines = emailAddress
    ? [`ATTENDEE;CN=${escapeIcs(name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${emailAddress}`]
    : [];
  const icsLines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Lenovo LeAI//Recruiting Interview//CN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(interview.start)}`,
    `DTEND:${formatIcsDate(interview.end)}`,
    `SUMMARY:${escapeIcs(`面试：${name} - ${config.recruiting.position}`)}`,
    `LOCATION:${escapeIcs(interview.locationOrLink || '线上面试')}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `ORGANIZER;CN=${escapeIcs(config.recruiting.contactName)}:mailto:${organizer}`,
    ...attendeeLines,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR'
  ].map(foldIcsLine);

  const slug = `${safeSlug(name)}-${Date.now()}`;
  const icsPath = path.join(outboxDir, `${slug}.ics`);
  const emlPath = path.join(outboxDir, `${slug}.eml`);
  const icsContent = `${icsLines.join('\r\n')}\r\n`;
  await fs.writeFile(icsPath, icsContent, 'utf8');

  const boundary = `----leai-${crypto.randomUUID()}`;
  const eml = [
    emailAddress ? `To: ${name} <${emailAddress}>` : 'To:',
    `From: ${config.recruiting.contactName} <${organizer}>`,
    `Subject: ${email.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    email.bodyHtml,
    '',
    `--${boundary}`,
    'Content-Type: text/calendar; method=REQUEST; charset="UTF-8"; name="interview.ics"',
    'Content-Transfer-Encoding: 8bit',
    'Content-Disposition: attachment; filename="interview.ics"',
    '',
    icsContent,
    `--${boundary}--`,
    ''
  ].join('\r\n');
  await fs.writeFile(emlPath, eml, 'utf8');

  return {
    icsPath,
    emlPath,
    uid,
    missingEmail: !emailAddress
  };
}
