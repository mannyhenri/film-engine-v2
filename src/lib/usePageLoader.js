import { useLayoutEffect, useRef } from 'react';

/*
 * A React page answers to the legacy loader name navigateTo already calls.
 *
 * navigateTo runs `loaders[page]()` on every visit and keeps it as PAGE_RELOAD,
 * which the live channel (another process wrote) and api()'s refresh-after-write
 * call again. Registering the same global name makes all three reach the React
 * page with nothing in the legacy code changed.
 *
 * useLayoutEffect, not useEffect: main.jsx renders with flushSync before the
 * deferred core script runs, and the route restored at boot can navigate at
 * once. A layout effect is in place by the end of that synchronous render; core's
 * `var loadNotesPage;` placeholder then leaves the value alone.
 */
export function usePageLoader(loaderName, load) {
    const ref = useRef(load);
    ref.current = load;
    useLayoutEffect(() => {
        const fn = (...args) => ref.current(...args);
        window[loaderName] = fn;
        return () => { if (window[loaderName] === fn) window[loaderName] = undefined; };
    }, [loaderName]);
}
