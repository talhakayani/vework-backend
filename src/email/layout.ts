import { emailConfig } from './config';

export interface EmailLayoutOptions {
  /** Main heading inside the card */
  title: string;
  /** Optional short preview text (some clients show this) */
  preheader?: string;
  /** HTML fragment for the body (paragraphs, etc.) */
  bodyHtml: string;
  /** Primary button label; if set, buttonUrl is required */
  buttonText?: string;
  /** Primary button URL */
  buttonUrl?: string;
  /** Optional footer line (e.g. "This link expires in 24 hours.") */
  footerLine?: string;
}

/**
 * Builds a single responsive HTML email matching the frontend UI (card, primary green, rounded).
 * All styling is inline for email client compatibility.
 */
export function buildEmailHtml(options: EmailLayoutOptions): string {
  const {
    title,
    preheader,
    bodyHtml,
    buttonText,
    buttonUrl,
    footerLine,
  } = options;

  const {
    appName,
    primaryColor,
    primaryHover,
    bgLight,
    white,
    textDark,
    textMuted,
    textLight,
    border,
    borderRadius,
  } = emailConfig;

  const buttonHtml =
    buttonText && buttonUrl
      ? `
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td align="center">
          <a href="${buttonUrl}" style="display: inline-block; padding: 12px 24px; background-color: ${primaryColor}; color: #ffffff; text-decoration: none; font-weight: 500; border-radius: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px;">${buttonText}</a>
        </td>
      </tr>
    </table>
  `
      : '';

  const footerHtml = footerLine
    ? `<p style="margin: 24px 0 0; font-size: 13px; color: ${textLight}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${footerLine}</p>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${preheader ? `<meta name="description" content="${preheader.replace(/"/g, '&quot;')}">` : ''}
  <title>${title}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: ${bgLight}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;">
  ${preheader ? `<div style="display: none; max-height: 0; overflow: hidden;">${preheader}</div>` : ''}
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: ${bgLight}; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 480px;">
          <tr>
            <td style="text-align: center; padding-bottom: 24px;">
              <a href="${emailConfig.frontendUrl}" style="font-size: 24px; font-weight: 700; color: ${primaryColor}; text-decoration: none;">${appName}</a>
            </td>
          </tr>
          <tr>
            <td style="background-color: ${white}; border: 1px solid ${border}; border-radius: ${borderRadius}; padding: 32px 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 700; color: ${textDark}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${title}</h1>
              <div style="font-size: 16px; line-height: 1.6; color: ${textMuted}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                ${bodyHtml}
              </div>
              ${buttonHtml}
              ${footerHtml}
            </td>
          </tr>
          <tr>
            <td style="padding-top: 24px; text-align: center; font-size: 12px; color: ${textLight};">
              &copy; ${new Date().getFullYear()} ${appName}. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();
}
