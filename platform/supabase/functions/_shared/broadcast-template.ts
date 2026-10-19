export interface BroadcastTemplateOptions {
  subject: string;
  category?: string;
  body: string;
  buttonText?: string;
  buttonUrl?: string;
  logoUrl?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:#961b81;text-decoration:underline;">$1</a>');
}

export function markdownToEmailHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const blocks: string[] = [];
  let currentList: string[] = [];

  const flushList = () => {
    if (currentList.length > 0) {
      blocks.push(
        `<ul style="margin:0 0 20px 20px;padding:0;color:#514a62;font-family:Arial,sans-serif;font-size:15px;line-height:25px;">${currentList.map((li) => `<li style="margin-bottom:6px;">${li}</li>`).join('')}</ul>`
      );
      currentList = [];
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushList();
      continue;
    }

    if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      currentList.push(formatInlineMarkdown(trimmed.slice(2)));
    } else {
      flushList();
      blocks.push(
        `<p style="margin:0 0 18px;font-family:Arial,sans-serif;font-size:15px;line-height:25px;color:#514a62;">${formatInlineMarkdown(trimmed)}</p>`
      );
    }
  }
  flushList();
  return blocks.join('\n');
}

export function renderBroadcastHtml(options: BroadcastTemplateOptions): string {
  const escapedSubject = escapeHtml(options.subject);
  const escapedCategory = options.category ? escapeHtml(options.category.toUpperCase()) : 'COMMUNICATION';
  const bodyHtml = markdownToEmailHtml(options.body);
  const logo = options.logoUrl || 'https://stemracingindia-events.vercel.app/brand/logo-india-colour-white.png';

  let buttonHtml = '';
  if (options.buttonText && options.buttonUrl) {
    const escapedText = escapeHtml(options.buttonText);
    const escapedUrl = escapeHtml(options.buttonUrl);
    buttonHtml = `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0;">
        <tr>
          <td bgcolor="#e6007e" style="background-color:#e6007e;border-radius:4px;mso-padding-alt:14px 24px;">
            <a href="${escapedUrl}" style="display:inline-block;padding:14px 24px;border:1px solid #e6007e;border-radius:4px;font-family:'Trebuchet MS',Arial,sans-serif;font-size:15px;line-height:20px;font-weight:bold;text-align:center;color:#ffffff;text-decoration:none;">
              ${escapedText} &nbsp;&rarr;
            </a>
          </td>
        </tr>
      </table>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapedSubject} | STEM Racing India</title>
  <style>
    @media only screen and (max-width: 480px) {
      .outer { padding: 16px 8px !important; }
      .content { padding: 32px 20px !important; }
      .header { padding: 24px !important; }
      .title { font-size: 28px !important; line-height: 34px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f3f3f7;-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;color:#f3f3f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapedSubject}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f3f3f7" style="background-color:#f3f3f7;">
    <tr>
      <td class="outer" align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
          <tr>
            <td class="header" bgcolor="#05000b" style="padding:28px 40px;background-color:#05000b;border-radius:12px 12px 0 0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td valign="middle">
                    <img src="${logo}" width="180" height="74" alt="STEM Racing India" style="display:block;width:180px;height:74px;border:0;color:#ffffff;font-family:Arial,sans-serif;font-size:20px;">
                  </td>
                  <td align="right" valign="middle" style="font-family:'Trebuchet MS',Arial,sans-serif;font-size:10px;line-height:16px;letter-spacing:2px;color:#d7d6e3;">
                    EVENTS<br>COMMUNICATIONS
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="75%" height="4" bgcolor="#e6007e" style="height:4px;background-color:#e6007e;font-size:0;line-height:0;">&nbsp;</td>
                  <td width="25%" height="4" bgcolor="#ed6d05" style="height:4px;background-color:#ed6d05;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="content" bgcolor="#ffffff" style="padding:40px;background-color:#ffffff;border-radius:0 0 12px 12px;">
              <p style="margin:0 0 14px;font-family:'Trebuchet MS',Arial,sans-serif;font-size:11px;line-height:16px;letter-spacing:2px;font-weight:bold;color:#961b81;">
                ${escapedCategory}
              </p>
              <h1 class="title" style="margin:0 0 20px;font-family:'Trebuchet MS',Arial,sans-serif;font-size:32px;line-height:38px;letter-spacing:-0.5px;font-weight:bold;font-style:italic;color:#05000b;">
                ${escapedSubject}
              </h1>
              ${bodyHtml}
              ${buttonHtml}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 16px 0;">
              <p style="margin:0;font-family:'Trebuchet MS',Arial,sans-serif;font-size:10px;line-height:18px;letter-spacing:1.5px;font-weight:bold;color:#514a62;">
                STEM RACING INDIA &nbsp;/&nbsp; EVENTS PLATFORM
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
