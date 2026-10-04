// Shared by the list wiring recipes (src/pages/*/list-wiring.test-recipe.jsx).

/** Keys of the items a page draws, in DOM order, leaving out what a drawn-list bar has hidden. */
export const drawn = (selector, attr) => () => [...document.querySelectorAll(selector)]
    .filter(el => !el.closest('.list-hidden')).map(el => el.getAttribute(attr));

/** Keys of the drawn items a find has marked, in DOM order. */
export const marked = (selector, attr) => () => [...document.querySelectorAll(selector)]
    .filter(el => el.classList.contains('list-find-match')).map(el => el.getAttribute(attr));
