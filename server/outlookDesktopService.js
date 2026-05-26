import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const desktopScript = [
  'on makeDate(isoText)',
  '  set y to text 1 thru 4 of isoText as integer',
  '  set mo to text 6 thru 7 of isoText as integer',
  '  set d to text 9 thru 10 of isoText as integer',
  '  set h to text 12 thru 13 of isoText as integer',
  '  set mi to text 15 thru 16 of isoText as integer',
  '  set monthList to {January, February, March, April, May, June, July, August, September, October, November, December}',
  '  set outputDate to current date',
  '  set day of outputDate to 1',
  '  set year of outputDate to y',
  '  set month of outputDate to item mo of monthList',
  '  set day of outputDate to d',
  '  set time of outputDate to (h * hours + mi * minutes)',
  '  return outputDate',
  'end makeDate',
  '',
  'on normalizeBody(rawText)',
  '  set oldDelimiters to AppleScript\'s text item delimiters',
  '  set AppleScript\'s text item delimiters to (ASCII character 13)',
  '  set rawParts to text items of rawText',
  '  set AppleScript\'s text item delimiters to ""',
  '  set rawText to rawParts as text',
  '  set AppleScript\'s text item delimiters to (ASCII character 10)',
  '  set bodyParts to text items of rawText',
  '  set AppleScript\'s text item delimiters to return',
  '  set outputText to bodyParts as text',
  '  set AppleScript\'s text item delimiters to oldDelimiters',
  '  return outputText',
  'end normalizeBody',
  '',
  'on run argv',
  '  set recipientAddress to item 1 of argv',
  '  set subjectText to item 2 of argv',
  '  set bodyText to item 3 of argv',
  '  set htmlBody to item 4 of argv',
  '  set attachmentPath to item 5 of argv',
  '  set startIso to item 6 of argv',
  '  set endIso to item 7 of argv',
  '  set locationText to item 8 of argv',
  '  set shouldCreateCalendar to item 9 of argv',
  '  set normalizedBody to my normalizeBody(bodyText)',
  '  tell application "Microsoft Outlook"',
  '    activate',
  '    if shouldCreateCalendar is "true" then',
  '      set startDate to my makeDate(startIso)',
  '      set endDate to my makeDate(endIso)',
  '      make new calendar event with properties {subject:subjectText, start time:startDate, end time:endDate, location:locationText, content:normalizedBody}',
  '    end if',
  '    set newMessage to make new outgoing message with properties {subject:subjectText, plain text content:htmlBody}',
  '    make new recipient at newMessage with properties {email address:{address:recipientAddress}}',
  '    if attachmentPath is not "" then',
  '      make new attachment at newMessage with properties {file:POSIX file attachmentPath}',
  '    end if',
  '    open newMessage',
  '    return "opened"',
  '  end tell',
  'end run'
];

export async function createOutlookDraftAndCalendar({ candidate, interview, email, icsPath, createCalendar = true }) {
  const recipientAddress = candidate.email || '';
  if (!recipientAddress) {
    const error = new Error('候选人缺少邮箱，无法打开 Outlook 草稿。');
    error.status = 400;
    throw error;
  }

  const args = [
    ...desktopScript.flatMap((line) => ['-e', line]),
    recipientAddress,
    email.subject,
    email.bodyText,
    `<html><body>${email.bodyHtml}</body></html>`,
    icsPath || '',
    interview.start,
    interview.end,
    interview.locationOrLink || '线上面试',
    createCalendar ? 'true' : 'false'
  ];
  const result = await execFileAsync('osascript', args, { timeout: 15000 });
  return {
    mode: createCalendar ? 'draft-and-calendar' : 'draft',
    stdout: result.stdout.trim()
  };
}
