import { describe, it, expect } from 'vitest';
import { renderBroadcastHtml } from '../../src/engine/broadcast-template';

describe('renderBroadcastHtml', () => {
  it('renders a branded responsive email with header, accent line, content, and footer', () => {
    const html = renderBroadcastHtml({
      subject: 'Judging Schedule Update',
      category: 'IMPORTANT NOTICE',
      body: 'Please arrive at Pit Lane A by 09:00.\n\nBring your tablets charged.',
      buttonText: 'View Schedule',
      buttonUrl: 'https://stemracingindia-events.vercel.app/#/event/123/schedule',
    });

    // Outer table & styling
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('background-color:#05000b');
    expect(html).toContain('https://stemracingindia-events.vercel.app/brand/logo-india-colour-white.png');
    
    // Split accent bar (75% pink #e6007e, 25% orange #ed6d05)
    expect(html).toContain('#e6007e');
    expect(html).toContain('#ed6d05');

    // Category and subject
    expect(html).toContain('IMPORTANT NOTICE');
    expect(html).toContain('Judging Schedule Update');

    // Body text converted to HTML paragraphs
    expect(html).toContain('Please arrive at Pit Lane A by 09:00.');
    expect(html).toContain('Bring your tablets charged.');

    // Button
    expect(html).toContain('View Schedule');
    expect(html).toContain('https://stemracingindia-events.vercel.app/#/event/123/schedule');

    // Footer
    expect(html).toContain('STEM RACING INDIA');
    expect(html).toContain('EVENTS PLATFORM');
  });

  it('safely escapes HTML tags in subject, category, and body to prevent XSS', () => {
    const html = renderBroadcastHtml({
      subject: '<script>alert("xss")</script>Test Subject',
      category: '<b>BAD</b>',
      body: 'Check this <img src=x onerror=alert(1)> out',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x');
  });

  it('renders markdown formatting like bold, italics, links, and bullet points', () => {
    const html = renderBroadcastHtml({
      subject: 'Briefing',
      body: 'Welcome **Judges**!\n\nHere are the details:\n* Item one\n* Item two\n\nVisit [Platform](https://stemracingindia-events.vercel.app).',
    });

    expect(html).toContain('<strong>Judges</strong>');
    expect(html).toContain('>Item one</li>');
    expect(html).toContain('>Item two</li>');
    expect(html).toContain('<a href="https://stemracingindia-events.vercel.app"');
  });
});
