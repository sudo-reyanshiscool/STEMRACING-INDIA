// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { h } from '../../src/ui/dom';

describe('h', () => {
  it('builds elements with props, listeners and nested children', () => {
    let clicked = 0;
    const el = h('button', { class: 'btn', type: 'button', onclick: () => clicked++ }, 'Go', null, false, h('span', null, '!'));
    expect(el.className).toBe('btn');
    expect(el.textContent).toBe('Go!');
    el.click();
    expect(clicked).toBe(1);
  });
  it('renders hostile text as text, never markup', () => {
    const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const el = h('p', null, evil);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toBe(evil);
  });
  it('sets boolean attributes and skips nullish props', () => {
    const el = h('input', { disabled: true, hidden: false, title: undefined, value: '47.2' });
    expect(el.hasAttribute('disabled')).toBe(true);
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.value).toBe('47.2');
  });
});
