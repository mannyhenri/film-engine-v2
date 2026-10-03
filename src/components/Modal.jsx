import { createPortal } from 'react-dom';
import { legacy } from '../lib/legacy.js';

/*
 * A modal a React page owns, on the SAME stack as every legacy modal.
 *
 * The legacy showModal(id) gives an overlay its depth and restacks everything
 * open, so a confirmation opened over a sheet paints on top of it. A React modal
 * that managed its own z-index would be a second stack, and the two would
 * disagree about what is on top. So this renders the same `.modal-overlay`
 * markup with an id, and opening and closing go through legacy.showModal /
 * legacy.closeModal by that id (openModal / closeModal below).
 *
 * The legacy stack adds `open` and a z-index to the node. React leaves both
 * alone: it only rewrites an attribute whose prop CHANGED between renders, and
 * className here is a constant. Never make it depend on state, or a re-render
 * would strip the `open` class and the modal would vanish while still on the stack.
 */
export default function Modal({ id, title, children }) {
    const overlay = (
        <div id={id} className="modal-overlay">
            <div className="modal">
                <div className="modal-header"><h3>{title}</h3><button className="modal-close" onClick={() => closeModal(id)}>&times;</button></div>
                <div className="modal-body">{children}</div>
            </div>
        </div>
    );
    // Rendered to static HTML (tools/assemble-page.js, no document): inline, where it would be portaled.
    return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body);
}

export const openModal = (id) => legacy.showModal(id);
export const closeModal = (id) => legacy.closeModal(id);
