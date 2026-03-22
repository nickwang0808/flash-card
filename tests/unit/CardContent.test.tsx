import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CardContent } from '@/components/CardContent';

// Mock react-native
vi.mock('react-native', () => ({
  View: ({ children, style, ...props }: any) => {
    const flatStyle = Array.isArray(style) ? Object.assign({}, ...style) : style;
    return <div style={flatStyle} {...props}>{children}</div>;
  },
  Text: ({ children, style, ...props }: any) => {
    const flatStyle = Array.isArray(style) ? Object.assign({}, ...style) : style;
    return <span style={flatStyle} {...props}>{children}</span>;
  },
  useWindowDimensions: () => ({ width: 400, height: 800 }),
}));

// Mock react-native-render-html to actually render HTML content
vi.mock('react-native-render-html', () => {
  function parseHtml(html: string): string[] {
    // Simple extraction of visible text from HTML
    return html
      .replace(/<[^>]*>/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  const RenderHtml = ({ source }: { source: { html: string } }) => {
    // Render the HTML as dangerouslySetInnerHTML so we can query text content
    return <div data-testid="render-html" dangerouslySetInnerHTML={{ __html: source.html }} />;
  };

  return {
    default: RenderHtml,
    HTMLContentModel: { mixed: 'mixed', textual: 'textual' },
    HTMLElementModel: {
      fromCustomModel: (opts: any) => opts,
    },
  };
});

describe('CardContent', () => {
  it('renders markdown with bold and italic', () => {
    const { container } = render(
      <CardContent foregroundColor="#000">**hola** *mundo*</CardContent>,
    );
    const html = container.innerHTML;
    expect(html).toContain('<strong>hola</strong>');
    expect(html).toContain('<em>mundo</em>');
  });

  it('renders ruby HTML for Chinese characters', () => {
    const { container } = render(
      <CardContent foregroundColor="#000">
        {'<ruby>上<rt>shàng</rt></ruby><ruby>午<rt>wǔ</rt></ruby>'}
      </CardContent>,
    );
    const html = container.innerHTML;
    expect(html).toContain('上');
    expect(html).toContain('shàng');
    expect(html).toContain('午');
    expect(html).toContain('wǔ');
  });

  it('renders plain text as-is', () => {
    const { container } = render(
      <CardContent foregroundColor="#000">hello world</CardContent>,
    );
    expect(container.textContent).toContain('hello world');
  });

  it('renders mixed markdown and HTML', () => {
    const { container } = render(
      <CardContent foregroundColor="#000">
        {'**bold** and <ruby>字<rt>zì</rt></ruby>'}
      </CardContent>,
    );
    const html = container.innerHTML;
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('字');
    expect(html).toContain('zì');
  });

  it('renders blockquote from markdown', () => {
    const { container } = render(
      <CardContent foregroundColor="#000">{'> a note'}</CardContent>,
    );
    const html = container.innerHTML;
    expect(html).toContain('<blockquote>');
    expect(html).toContain('a note');
  });
});
