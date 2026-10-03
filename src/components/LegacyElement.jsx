import { createElement, memo, useCallback, useMemo } from 'react';

/*
 * One element of the source's markup, given as its outerHTML. React creates the
 * element once and never touches it again: the attributes (class, id, inline
 * onclick strings) are set on the DOM node directly, so React owns none of them
 * and a re-render cannot undo what the legacy code did with classList or
 * innerHTML. Children, when given, replace the markup's own content.
 */
function LegacyElement({ html, children }) {
    const source = useMemo(() => {
        const t = document.createElement('template');
        t.innerHTML = html.trim();
        return t.content.firstElementChild;
    }, [html]);
    const ref = useCallback((node) => {
        if (!node) return;
        for (const a of source.attributes) if (!node.hasAttribute(a.name)) node.setAttribute(a.name, a.value);
    }, [source]);
    const tag = source.tagName.toLowerCase();
    if (children) return createElement(tag, { ref }, children);
    return createElement(tag, { ref, dangerouslySetInnerHTML: { __html: source.innerHTML } });
}

export default memo(LegacyElement);
